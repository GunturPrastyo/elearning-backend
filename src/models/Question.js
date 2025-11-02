import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [{ type: String, required: true }],
  answer: { type: String, required: true },
  modulId: { type: mongoose.Schema.Types.ObjectId, ref: "Modul" },
  topikId: { type: mongoose.Schema.Types.ObjectId, ref: "Topik" },
  testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test" },
  testType: {
    type: String,
    enum: [
      "pre-test-global",   // 🔹 Pre-test awal (personalized)
      "pre-test-topik",    // 🔹 Pre-test per topik (opsional)
      "post-test-modul",   // 🔹 Post-test tiap modul
      "post-test-topik"    // 🔹 Post-test tiap topik
    ],
    required: true
  }
}, { timestamps: true });

export default mongoose.model("Question", questionSchema);
