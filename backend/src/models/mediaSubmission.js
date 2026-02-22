const mongoose = require("mongoose");

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

module.exports = mongoose.model("MediaSubmission", mediaSubmissionSchema);
