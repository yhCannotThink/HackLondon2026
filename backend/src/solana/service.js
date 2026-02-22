const fs = require("fs");
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function createSolanaService(config) {
  let connection = null;
  let payer = null;

  function parseSecretKeyMaterial(keyMaterial) {
    let parsedSecret;

    try {
      parsedSecret = JSON.parse(keyMaterial);
    } catch (_error) {
      throw new Error("Solana key material must be a valid JSON array");
    }

    if (!Array.isArray(parsedSecret) || parsedSecret.length !== 64) {
      throw new Error("Solana key material must be an array of exactly 64 numbers");
    }

    const hasInvalidByte = parsedSecret.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 255
    );

    if (hasInvalidByte) {
      throw new Error("Solana key material must contain byte values between 0 and 255");
    }

    return Uint8Array.from(parsedSecret);
  }

  function loadKeyMaterial() {
    if (config.privateKeyJson) {
      return config.privateKeyJson;
    }

    return fs.readFileSync(config.keypairPath, "utf8").trim();
  }

  function initialize() {
    let keyMaterial;

    try {
      keyMaterial = loadKeyMaterial();
    } catch (_error) {
      if (config.required) {
        throw new Error(
          "Set SOLANA_PRIVATE_KEY_JSON or provide a readable SOLANA_KEYPAIR_PATH when SOLANA_REQUIRED=true"
        );
      }
      console.warn(
        "Solana integration disabled: neither SOLANA_PRIVATE_KEY_JSON nor a readable keypair file is available"
      );
      return false;
    }

    let secretKey;
    try {
      secretKey = parseSecretKeyMaterial(keyMaterial);
    } catch (error) {
      if (config.required) {
        throw error;
      }
      console.warn(`Solana integration disabled: ${error.message}`);
      return false;
    }

    try {
      payer = Keypair.fromSecretKey(secretKey);
    } catch (error) {
      if (config.required) {
        throw error;
      }
      console.warn(`Solana integration disabled: ${error.message}`);
      return false;
    }

    connection = new Connection(config.rpcUrl, "confirmed");
    console.log("Solana devnet integration enabled");
    return true;
  }

  async function anchorHash({ mediaType, videoHash, requestClientId, timestamp, nonce }) {
    if (!connection || !payer) {
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

    return sendAndConfirmTransaction(connection, transaction, [payer], {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }

  function instructionProgramIdString(instruction) {
    if (!instruction) {
      return "";
    }

    if (instruction.programId && typeof instruction.programId.toBase58 === "function") {
      return instruction.programId.toBase58();
    }

    if (instruction.programId && typeof instruction.programId.toString === "function") {
      return instruction.programId.toString();
    }

    return "";
  }

  function extractMemoTextFromInstruction(instruction) {
    if (!instruction) {
      return null;
    }

    if (instruction.program === "spl-memo") {
      if (typeof instruction.parsed === "string") {
        return instruction.parsed;
      }

      if (instruction.parsed && typeof instruction.parsed.memo === "string") {
        return instruction.parsed.memo;
      }
    }

    const programIdText = instructionProgramIdString(instruction);
    if (programIdText === MEMO_PROGRAM_ID.toBase58()) {
      if (typeof instruction.parsed === "string") {
        return instruction.parsed;
      }

      if (instruction.parsed && typeof instruction.parsed.memo === "string") {
        return instruction.parsed.memo;
      }
    }

    return null;
  }

  function hasMatchingMemoPayload(instructions, expected) {
    for (const instruction of instructions || []) {
      const memoText = extractMemoTextFromInstruction(instruction);
      if (!memoText) {
        continue;
      }

      try {
        const payload = JSON.parse(memoText);
        const isMatch =
          payload &&
          payload.m === expected.mediaType &&
          payload.h === expected.videoHash &&
          payload.c === expected.requestClientId;

        if (isMatch) {
          return true;
        }
      } catch (_error) {
        continue;
      }
    }

    return false;
  }

  async function verifyAnchoredHash({ txId, mediaType, videoHash, requestClientId }) {
    if (!connection || !payer) {
      throw new Error("Solana verification is unavailable");
    }

    const parsedTransaction = await connection.getParsedTransaction(txId, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!parsedTransaction) {
      return false;
    }

    const accountKeys = parsedTransaction.transaction?.message?.accountKeys || [];
    const payerPublicKey = payer.publicKey.toBase58();
    const payerPresent = accountKeys.some((keyEntry) => {
      if (typeof keyEntry === "string") {
        return keyEntry === payerPublicKey;
      }

      const keyText =
        keyEntry && keyEntry.pubkey && typeof keyEntry.pubkey.toString === "function"
          ? keyEntry.pubkey.toString()
          : "";
      return keyText === payerPublicKey;
    });

    if (!payerPresent) {
      return false;
    }

    const instructions = parsedTransaction.transaction?.message?.instructions || [];
    return hasMatchingMemoPayload(instructions, {
      mediaType,
      videoHash,
      requestClientId,
    });
  }

  return {
    initialize,
    anchorHash,
    verifyAnchoredHash,
  };
}

module.exports = {
  createSolanaService,
};
