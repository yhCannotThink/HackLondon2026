require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const config = require("./config");
const MediaSubmission = require("./models/mediaSubmission");
const { buildClientSignTarget, signPayload, safeEqualHex } = require("./utils/signing");
const { createSolanaService } = require("./solana/service");

const app = express();
const solanaService = createSolanaService(config.solana);

app.use(express.json({ limit: config.requestBodyLimit }));

app.use((error, _req, res, next) => {
  if (!error) {
    return next();
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  if (error.type === "request.aborted") {
    return res.status(400).json({ error: "Request was aborted before completion" });
  }

  return next(error);
});

function validateSubmitPayload(payload) {
  const { videoHash, metadata, mediaType = "video", auth } = payload || {};

  if (!videoHash || typeof videoHash !== "string") {
    return { status: 400, body: { error: "videoHash is required and must be a string" } };
  }

  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return { status: 400, body: { error: "metadata is required and must be an object" } };
  }

  if (!["video", "audio"].includes(mediaType)) {
    return { status: 400, body: { error: "mediaType must be either 'video' or 'audio'" } };
  }

  if (!auth || typeof auth !== "object") {
    return { status: 400, body: { error: "auth is required" } };
  }

  const { clientId: requestClientId, timestamp, nonce, requestSignature } = auth;

  if (!requestClientId || typeof requestClientId !== "string") {
    return { status: 400, body: { error: "auth.clientId is required" } };
  }

  if (requestClientId !== config.clientId) {
    return { status: 401, body: { error: "Unknown clientId" } };
  }

  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return {
      status: 400,
      body: { error: "auth.timestamp must be a unix time in milliseconds" },
    };
  }

  if (!nonce || typeof nonce !== "string") {
    return { status: 400, body: { error: "auth.nonce is required" } };
  }

  if (!requestSignature || typeof requestSignature !== "string") {
    return { status: 400, body: { error: "auth.requestSignature is required" } };
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > config.maxClockSkewMs) {
    return {
      status: 401,
      body: { error: "Request timestamp is outside allowed clock skew" },
    };
  }

  const normalizedHash = videoHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
    return { status: 400, body: { error: "videoHash must be a valid SHA-256 hex string" } };
  }

  const signTarget = buildClientSignTarget(normalizedHash, mediaType, metadata, timestamp, nonce);
  const expectedSignature = signPayload(signTarget, config.clientSecret);

  if (!safeEqualHex(requestSignature, expectedSignature)) {
    return { status: 401, body: { error: "Invalid requestSignature" } };
  }

  return {
    normalized: {
      videoHash: normalizedHash,
      mediaType,
      metadata,
      requestClientId,
      timestamp,
      nonce,
    },
  };
}

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/api/v1/videos/submit", async (req, res) => {
  const validation = validateSubmitPayload(req.body);
  if (!validation.normalized) {
    return res.status(validation.status).json(validation.body);
  }

  const { videoHash, mediaType, metadata, requestClientId, timestamp, nonce } = validation.normalized;

  let alreadyExists = false;
  let txId = null;

  try {
    const existing = await MediaSubmission.findOne({ videoHash }).lean();
    alreadyExists = Boolean(existing);
    txId = existing?.txId || null;

    if (alreadyExists && txId && config.solana.verifyOnRead) {
      try {
        const isVerifiedOnChain = await solanaService.verifyAnchoredHash({
          txId,
          mediaType: existing.mediaType || mediaType,
          videoHash,
          requestClientId,
        });

        if (!isVerifiedOnChain) {
          return res.status(409).json({ error: "Stored txId failed on-chain verification" });
        }
      } catch (error) {
        console.error("Solana verify-on-read error:", error);
        return res.status(502).json({ error: "Failed to verify existing txId on Solana devnet" });
      }
    }

    if (!txId) {
      try {
        txId = await solanaService.anchorHash({
          mediaType,
          videoHash,
          requestClientId,
          timestamp,
          nonce,
        });
      } catch (error) {
        console.error("Solana transaction error:", error);
        return res.status(502).json({ error: "Failed to anchor hash on Solana devnet" });
      }
    }

    if (!alreadyExists) {
      await MediaSubmission.create({
        videoHash,
        mediaType,
        metadata,
        txId,
        authContext: {
          clientId: requestClientId,
          timestamp,
          nonce,
        },
      });
    } else if (existing && (existing.txId !== txId || existing.mediaType !== mediaType)) {
      await MediaSubmission.updateOne(
        { _id: existing._id },
        {
          $set: {
            txId,
            mediaType,
          },
        }
      );
    }
  } catch (error) {
    if (error && error.code === 11000) {
      alreadyExists = true;
      const existing = await MediaSubmission.findOne({ videoHash }).lean();
      txId = existing?.txId || null;
    } else {
      console.error("MongoDB write/read error:", error);
      return res.status(500).json({ error: "Database operation failed" });
    }
  }

  const responseData = {
    status: "verified",
    alreadyExists,
    txId,
  };

  return res.status(200).json(responseData);
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled server error:", error);
  return res.status(500).json({ error: "Internal server error" });
});

async function startServer() {
  if (!config.mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(config.mongoUri);
  console.log("Connected to MongoDB Atlas");
  solanaService.initialize();

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
