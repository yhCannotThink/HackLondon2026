require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
const os = require("os");
const path = require("path");
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const app = express();
const port = process.env.PORT || 3000;
const maxClockSkewMs = Number(process.env.MAX_CLOCK_SKEW_MS || 5 * 60 * 1000);
const clientId = process.env.CLIENT_ID || "android-app";
const clientSecret = process.env.CLIENT_SECRET || "dev-client-secret";
const solanaRpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const solanaPrivateKeyJson = process.env.SOLANA_PRIVATE_KEY_JSON;
const solanaKeypairPath =
  process.env.SOLANA_KEYPAIR_PATH || path.join(os.homedir(), ".config", "solana", "devnet.json");
const solanaRequired = process.env.SOLANA_REQUIRED === "true";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

let solanaConnection = null;
let solanaPayer = null;

const mediaSubmissionSchema = new mongoose.Schema(
  {
    videoHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    mediaType: {
      type: String,
      required: true,
      enum: ["video", "audio"],
      default: "video",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    txId: {
      type: String,
      default: null,
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

const MediaSubmission = mongoose.model("MediaSubmission", mediaSubmissionSchema);

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

function buildClientSignTarget(videoHash, mediaType, metadata, timestamp, nonce) {
  return [videoHash, mediaType, stableStringify(metadata || {}), String(timestamp), nonce].join(".");
}

function initializeSolana() {
  let keyMaterial = solanaPrivateKeyJson;

  if (!keyMaterial) {
    try {
      keyMaterial = fs.readFileSync(solanaKeypairPath, "utf8").trim();
    } catch (_error) {
      console.warn(
        "Solana integration disabled: neither SOLANA_PRIVATE_KEY_JSON nor a readable keypair file is available"
      );
      if (solanaRequired) {
        throw new Error(
          "Set SOLANA_PRIVATE_KEY_JSON or provide a readable SOLANA_KEYPAIR_PATH when SOLANA_REQUIRED=true"
        );
      }
      return false;
    }
  }

  let parsedSecret;

  try {
    parsedSecret = JSON.parse(keyMaterial);
  } catch (error) {
    if (solanaRequired) {
      throw new Error("Solana key material must be a valid JSON array");
    }
    console.warn("Solana integration disabled: Solana key material is not valid JSON");
    return false;
  }

  if (!Array.isArray(parsedSecret) || parsedSecret.length !== 64) {
    if (solanaRequired) {
      throw new Error("Solana key material must be an array of exactly 64 numbers");
    }
    console.warn("Solana integration disabled: secret key must be an array of 64 numbers");
    return false;
  }

  const hasInvalidByte = parsedSecret.some(
    (value) => !Number.isInteger(value) || value < 0 || value > 255
  );

  if (hasInvalidByte) {
    if (solanaRequired) {
      throw new Error("Solana key material must contain byte values between 0 and 255");
    }
    console.warn("Solana integration disabled: secret key contains invalid byte values");
    return false;
  }

  try {
    solanaPayer = Keypair.fromSecretKey(Uint8Array.from(parsedSecret));
  } catch (error) {
    if (solanaRequired) {
      throw error;
    }
    console.warn(`Solana integration disabled: ${error.message}`);
    return false;
  }

  solanaConnection = new Connection(solanaRpcUrl, "confirmed");
  console.log("Solana devnet integration enabled");
  return true;
}

async function anchorHashOnSolana({ mediaType, videoHash, requestClientId, timestamp, nonce }) {
  if (!solanaConnection || !solanaPayer) {
    return null;
  }

  const memo = JSON.stringify({
    m: mediaType,
    h: videoHash,
    c: requestClientId,
    t: timestamp,
    n: nonce.slice(0, 16),
  });

  const memoInstruction = new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf8"),
  });

  const transaction = new Transaction().add(memoInstruction);

  const txId = await sendAndConfirmTransaction(solanaConnection, transaction, [solanaPayer], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  return txId;
}

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/api/v1/videos/submit", async (req, res) => {
  const { videoHash, metadata, mediaType = "video", auth } = req.body || {};

  if (!videoHash || typeof videoHash !== "string") {
    return res.status(400).json({ error: "videoHash is required and must be a string" });
  }

  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return res.status(400).json({ error: "metadata is required and must be an object" });
  }

  if (!["video", "audio"].includes(mediaType)) {
    return res.status(400).json({ error: "mediaType must be either 'video' or 'audio'" });
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

  const signTarget = buildClientSignTarget(normalizedHash, mediaType, metadata, timestamp, nonce);
  const expectedSignature = signPayload(signTarget, clientSecret);

  if (!safeEqualHex(requestSignature, expectedSignature)) {
    return res.status(401).json({ error: "Invalid requestSignature" });
  }

  let alreadyExists = false;
  let txId = null;

  try {
    const existing = await MediaSubmission.findOne({ videoHash: normalizedHash }).lean();
    alreadyExists = Boolean(existing);
    txId = existing?.txId || null;

    if (!txId) {
      try {
        txId = await anchorHashOnSolana({
          mediaType,
          videoHash: normalizedHash,
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
        videoHash: normalizedHash,
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
      const existing = await MediaSubmission.findOne({ videoHash: normalizedHash }).lean();
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

async function startServer() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB Atlas");
  initializeSolana();

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
