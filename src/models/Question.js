import mongoose from "mongoose";

const featureWeightSchema = new mongoose.Schema(
  {
    featureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feature",
    },
    weight: { type: Number, default: 0 },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    questionText: {
      type: String,
      required: [true, "Teks pertanyaan tidak boleh kosong."],
    },
    options: {
      type: [String],
      required: true,
      validate: [
        (val) => val.length > 0,
        "Harus ada setidaknya satu opsi jawaban.",
      ],
    },
    answer: {
      type: String,
      required: [true, "Jawaban yang benar harus ditentukan."],
      select: false, 
    },
    testType: {
      type: String,
      required: true,
      enum: ["pre-test-global", "post-test-modul", "post-test-topik"],
    },
    modulId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Modul",
      default: null,
    },
    topikId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topik",
      default: null,
    },
    durationPerQuestion: {
      type: Number,
      default: 60, 
    },
    subMateriId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Materi.subMateris", 
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Question = mongoose.model("Question", questionSchema);
export default Question;