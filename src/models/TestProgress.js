import mongoose from "mongoose";

const TestProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    testType: {
      type: String,
      required: true,
      enum: ["pre-test-global", "post-test-modul", "post-test-topik"],
    },
    answers: { type: Map, of: String },
    currentIndex: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const TestProgress = mongoose.model("TestProgress", TestProgressSchema);
export default TestProgress;