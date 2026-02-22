const os = require("os");
const path = require("path");

const config = {
  port: process.env.PORT || 3000,
  maxClockSkewMs: Number(process.env.MAX_CLOCK_SKEW_MS || 5 * 60 * 1000),
  clientId: process.env.CLIENT_ID || "android-app",
  clientSecret: process.env.CLIENT_SECRET || "dev-client-secret",
  mongoUri: process.env.MONGODB_URI,
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    privateKeyJson: process.env.SOLANA_PRIVATE_KEY_JSON,
    keypairPath:
      process.env.SOLANA_KEYPAIR_PATH ||
      path.join(os.homedir(), ".config", "solana", "devnet.json"),
    required: process.env.SOLANA_REQUIRED === "true",
    verifyOnRead: process.env.SOLANA_VERIFY_ON_READ !== "false",
  },
};

module.exports = config;
