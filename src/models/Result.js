import mongoose from "mongoose";

const resultSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    testType: {
      type: String,
      required: true,
      enum: [
        "pre-test-global",
        "post-test-modul",
        "post-test-topik",
        "study-session", // Tambahkan ini
      ],
    },
    score: {
      type: Number,
      required: true,
    },
    correct: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
    timeTaken: {
      type: Number, // dalam detik
      required: true,
    },
    modulId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Modul",
    },
    topikId: { // Tambahkan field ini
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topik",
    },
  },
  { timestamps: true }
); // timestamps akan menambahkan createdAt dan updatedAt

const Result = mongoose.model("Result", resultSchema);

export default Result;