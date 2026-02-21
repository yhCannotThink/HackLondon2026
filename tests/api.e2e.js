const assert = require("assert");
const crypto = require("crypto");
const { spawn } = require("child_process");

if (typeof fetch !== "function") {
  throw new Error("Global fetch is not available. Use Node.js 18+.");
}

const CLIENT_ID = "android-app";
const CLIENT_SECRET = "dev-client-secret";
const SERVER_SIGNING_SECRET = "dev-server-signing-secret";

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

function buildClientSignTarget(videoHash, metadata, timestamp, nonce) {
  return [videoHash, stableStringify(metadata || {}), String(timestamp), nonce].join(".");
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

function createSignedBody({
  videoHash,
  metadata,
  timestamp = Date.now(),
  nonce = crypto.randomBytes(12).toString("hex"),
  clientId = CLIENT_ID,
}) {
  const normalizedHash = videoHash.trim().toLowerCase();
  const signTarget = buildClientSignTarget(normalizedHash, metadata, timestamp, nonce);
  const requestSignature = signPayload(signTarget, CLIENT_SECRET);

  return {
    videoHash,
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

  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      CLIENT_ID,
      CLIENT_SECRET,
      SERVER_SIGNING_SECRET,
      MAX_CLOCK_SKEW_MS: "300000",
    },
    stdio: "inherit",
  });

  try {
    await waitForServer(`${baseUrl}/health`);

    const healthResponse = await fetch(`${baseUrl}/health`);
    const healthBody = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(healthBody, { status: "ok" });
    console.log("✓ health endpoint");

    const metadata = { source: "android", durationMs: 1234, tags: ["demo"] };
    const validPayload = createSignedBody({
      videoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      metadata,
    });

    const validResult = await postJson(`${baseUrl}/api/v1/videos/submit`, validPayload);
    assert.equal(validResult.response.status, 200);
    assert.equal(validResult.body.status, "accepted");
    assert.equal(validResult.body.authVerified, true);
    assert.equal(typeof validResult.body.serverSignature, "string");
    assert.equal(validResult.body.data.videoHash, validPayload.videoHash);

    const expectedServerSignature = signPayload(
      stableStringify(validResult.body.data),
      SERVER_SIGNING_SECRET
    );
    assert.equal(validResult.body.serverSignature, expectedServerSignature);
    console.log("✓ valid submit request");

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
      videoHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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

    console.log("\nAll API checks passed.");
  } catch (error) {
    console.error("\nAPI test failed:", error.message);
    process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
})();
