require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");

const app = express();
const port = process.env.PORT || 3000;
const maxClockSkewMs = Number(process.env.MAX_CLOCK_SKEW_MS || 5 * 60 * 1000);
const clientId = process.env.CLIENT_ID || "android-app";
const clientSecret = process.env.CLIENT_SECRET || "dev-client-secret";

const videoSubmissionSchema = new mongoose.Schema(
  {
    videoHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    authContext: {
      clientId: { type: String, required: true },
      timestamp: { type: Number, required: true },
      nonce: { type: String, required: true },
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

const VideoSubmission = mongoose.model("VideoSubmission", videoSubmissionSchema);

app.use(express.json({ limit: "1mb" }));

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const serialized = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${serialized.join(",")}}`;
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function buildClientSignTarget(videoHash, metadata, timestamp, nonce) {
  return [videoHash, stableStringify(metadata || {}), String(timestamp), nonce].join(".");
}

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/api/v1/videos/submit", async (req, res) => {
  const { videoHash, metadata, auth } = req.body || {};

  if (!videoHash || typeof videoHash !== "string") {
    return res.status(400).json({ error: "videoHash is required and must be a string" });
  }

  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return res.status(400).json({ error: "metadata is required and must be an object" });
  }

  if (!auth || typeof auth !== "object") {
    return res.status(400).json({ error: "auth is required" });
  }

  const { clientId: requestClientId, timestamp, nonce, requestSignature } = auth;

  if (!requestClientId || typeof requestClientId !== "string") {
    return res.status(400).json({ error: "auth.clientId is required" });
  }

  if (requestClientId !== clientId) {
    return res.status(401).json({ error: "Unknown clientId" });
  }

  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return res.status(400).json({ error: "auth.timestamp must be a unix time in milliseconds" });
  }

  if (!nonce || typeof nonce !== "string") {
    return res.status(400).json({ error: "auth.nonce is required" });
  }

  if (!requestSignature || typeof requestSignature !== "string") {
    return res.status(400).json({ error: "auth.requestSignature is required" });
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > maxClockSkewMs) {
    return res.status(401).json({ error: "Request timestamp is outside allowed clock skew" });
  }

  const normalizedHash = videoHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
    return res.status(400).json({ error: "videoHash must be a valid SHA-256 hex string" });
  }

  const signTarget = buildClientSignTarget(normalizedHash, metadata, timestamp, nonce);
  const expectedSignature = signPayload(signTarget, clientSecret);

  if (!safeEqualHex(requestSignature, expectedSignature)) {
    return res.status(401).json({ error: "Invalid requestSignature" });
  }

  let alreadyExists = false;

  try {
    const existing = await VideoSubmission.findOne({ videoHash: normalizedHash }).lean();
    alreadyExists = Boolean(existing);

    if (!alreadyExists) {
      await VideoSubmission.create({
        videoHash: normalizedHash,
        metadata,
        authContext: {
          clientId: requestClientId,
          timestamp,
          nonce,
        },
      });
    }
  } catch (error) {
    if (error && error.code === 11000) {
      alreadyExists = true;
    } else {
      console.error("MongoDB write/read error:", error);
      return res.status(500).json({ error: "Database operation failed" });
    }
  }

  const responseData = {
    status: "verified",
    alreadyExists,
    txId: null,
  };

  return res.status(200).json(responseData);
});

async function startServer() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB Atlas");

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
