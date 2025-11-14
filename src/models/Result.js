import mongoose from "mongoose";

const answerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
  selectedOption: String,
  subMateriId: { type: mongoose.Schema.Types.ObjectId }
}, { _id: false });

const weakSubTopicSchema = new mongoose.Schema({
  subMateriId: { type: mongoose.Schema.Types.ObjectId },
  title: String,
  score: Number
}, { _id: false });

const weakTopicSchema = new mongoose.Schema({
  topikId: { type: mongoose.Schema.Types.ObjectId, ref: "Topik" },
  title: String,
  slug: String,
  score: Number,
}, { _id: false });

const scoreDetailsSchema = new mongoose.Schema({
  accuracy: { type: Number },
  time: { type: Number },
  stability: { type: Number },
  focus: { type: Number },
}, { _id: false });

const progressAnswerSchema = new mongoose.Schema({
  questionId: String, selectedOption: String
}, { _id: false });

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
        "study-session",
        "post-test-topik-progress", // Tambahkan tipe untuk progress
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
    // --- Field Baru yang Ditambahkan ---
    answers: {
      type: [answerSchema], // Skema untuk jawaban tes yang sudah disubmit
      default: undefined, 
    },
    weakSubTopics: {
      type: [weakSubTopicSchema],
      default: undefined,
    },
    weakTopics: {
      type: [weakTopicSchema],
      default: undefined,
    },
    scoreDetails: {
      type: scoreDetailsSchema,
      default: undefined,
    },
    currentIndex: { // Untuk menyimpan progress nomor soal
      type: Number,
    },
    progressAnswers: { // Field terpisah untuk progress
      type: [progressAnswerSchema],
      default: undefined,
    }
  },
  { timestamps: true }
); // timestamps akan menambahkan createdAt dan updatedAt

const Result = mongoose.model("Result", resultSchema);

export default Result;