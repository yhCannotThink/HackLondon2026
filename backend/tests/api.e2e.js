require("dotenv").config();

const assert = require("assert");
const crypto = require("crypto");
const { spawn } = require("child_process");

if (typeof fetch !== "function") {
  throw new Error("Global fetch is not available. Use Node.js 18+.");
}

const CLIENT_ID = "android-app";
const CLIENT_SECRET = "dev-client-secret";
const MONGODB_URI = process.env.MONGODB_URI;
const SOLANA_PRIVATE_KEY_JSON = process.env.SOLANA_PRIVATE_KEY_JSON;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is required to run API tests.");
  console.error("Set it in .env or run: MONGODB_URI='mongodb+srv://...' npm run test:api");
  process.exit(1);
}

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

function buildClientSignTarget(videoHash, mediaType, metadata, timestamp, nonce) {
  return [videoHash, mediaType, stableStringify(metadata || {}), String(timestamp), nonce].join(".");
}

function randomSha256Hex() {
  return crypto.randomBytes(32).toString("hex");
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 8000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      await sleep(250);
    }
  }

  throw new Error("Server did not become ready in time");
}

async function waitForLog(logBufferRef, expectedText, timeoutMs = 8000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (logBufferRef.current.includes(expectedText)) {
      return;
    }

    await sleep(100);
  }

  throw new Error(`Expected startup log not found: ${expectedText}`);
}

function createSignedBody({
  videoHash,
  mediaType = "video",
  metadata,
  timestamp = Date.now(),
  nonce = crypto.randomBytes(12).toString("hex"),
  clientId = CLIENT_ID,
}) {
  const normalizedHash = videoHash.trim().toLowerCase();
  const signTarget = buildClientSignTarget(normalizedHash, mediaType, metadata, timestamp, nonce);
  const requestSignature = signPayload(signTarget, CLIENT_SECRET);

  return {
    videoHash,
    mediaType,
    metadata,
    auth: {
      clientId,
      timestamp,
      nonce,
      requestSignature,
    },
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  return { response, body };
}

(async () => {
  const port = 3300 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverLogs = { current: "" };

  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI,
      CLIENT_ID,
      CLIENT_SECRET,
      MAX_CLOCK_SKEW_MS: "300000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    serverLogs.current += text;
    process.stdout.write(text);
  });

  server.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    serverLogs.current += text;
    process.stderr.write(text);
  });

  try {
    await waitForLog(serverLogs, "Connected to MongoDB Atlas");
    console.log("✓ MongoDB connection startup log");

    await waitForServer(`${baseUrl}/health`);

    const healthResponse = await fetch(`${baseUrl}/health`);
    const healthBody = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(healthBody, { status: "ok" });
    console.log("✓ health endpoint");

    const metadata = { source: "android", durationMs: 1234, tags: ["demo"] };
    const uniqueVideoHash = randomSha256Hex();
    const validPayload = createSignedBody({
      videoHash: uniqueVideoHash,
      metadata,
    });

    const validResult = await postJson(`${baseUrl}/api/v1/videos/submit`, validPayload);
    assert.equal(validResult.response.status, 200);
    assert.equal(validResult.body.status, "verified");
    assert.equal(validResult.body.alreadyExists, false);
    if (SOLANA_PRIVATE_KEY_JSON) {
      assert.equal(typeof validResult.body.txId, "string");
      assert.ok(validResult.body.txId.length > 0);
    } else {
      assert.equal(validResult.body.txId, null);
    }
    console.log("✓ valid submit request");

    const duplicateResult = await postJson(`${baseUrl}/api/v1/videos/submit`, validPayload);
    assert.equal(duplicateResult.response.status, 200);
    assert.equal(duplicateResult.body.status, "verified");
    assert.equal(duplicateResult.body.alreadyExists, true);
    assert.equal(duplicateResult.body.txId, validResult.body.txId);
    console.log("✓ duplicate hash marked as alreadyExists");

    const badSignaturePayload = {
      ...validPayload,
      auth: {
        ...validPayload.auth,
        nonce: crypto.randomBytes(12).toString("hex"),
        requestSignature: "deadbeef",
      },
    };
    const badSignatureResult = await postJson(
      `${baseUrl}/api/v1/videos/submit`,
      badSignaturePayload
    );
    assert.equal(badSignatureResult.response.status, 401);
    assert.equal(badSignatureResult.body.error, "Invalid requestSignature");
    console.log("✓ invalid signature rejected");

    const invalidHashPayload = createSignedBody({
      videoHash: "not-a-valid-hash",
      metadata,
    });
    const invalidHashResult = await postJson(`${baseUrl}/api/v1/videos/submit`, invalidHashPayload);
    assert.equal(invalidHashResult.response.status, 400);
    assert.equal(invalidHashResult.body.error, "videoHash must be a valid SHA-256 hex string");
    console.log("✓ invalid hash rejected");

    const staleTimestampPayload = createSignedBody({
      videoHash: randomSha256Hex(),
      metadata,
      timestamp: Date.now() - 10 * 60 * 1000,
    });
    const staleTimestampResult = await postJson(
      `${baseUrl}/api/v1/videos/submit`,
      staleTimestampPayload
    );
    assert.equal(staleTimestampResult.response.status, 401);
    assert.equal(staleTimestampResult.body.error, "Request timestamp is outside allowed clock skew");
    console.log("✓ stale timestamp rejected");

    const unknownClientPayload = createSignedBody({
      videoHash: randomSha256Hex(),
      metadata,
      clientId: "wrong-client",
    });
    const unknownClientResult = await postJson(
      `${baseUrl}/api/v1/videos/submit`,
      unknownClientPayload
    );
    assert.equal(unknownClientResult.response.status, 401);
    assert.equal(unknownClientResult.body.error, "Unknown clientId");
    console.log("✓ unknown client rejected");

    const invalidMediaTypePayload = createSignedBody({
      videoHash: randomSha256Hex(),
      mediaType: "image",
      metadata,
    });
    const invalidMediaTypeResult = await postJson(
      `${baseUrl}/api/v1/videos/submit`,
      invalidMediaTypePayload
    );
    assert.equal(invalidMediaTypeResult.response.status, 400);
    assert.equal(
      invalidMediaTypeResult.body.error,
      "mediaType must be either 'video' or 'audio'"
    );
    console.log("✓ invalid mediaType rejected");

    console.log("\nAll API checks passed.");
  } catch (error) {
    console.error("\nAPI test failed:", error.message);
    process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
})();
