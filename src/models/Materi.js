// models/Materi.js
import mongoose from "mongoose";

const MateriSchema = new mongoose.Schema(
  {
    topikId: { type: mongoose.Schema.Types.ObjectId, ref: "Topik", required: true },
    modulId: { type: mongoose.Schema.Types.ObjectId, ref: "Modul", required: true },
    content: { type: String, required: true },
    youtube: { type: String },
  },
  { timestamps: true }
);

// Pastikan setiap topik hanya punya satu materi
MateriSchema.index({ modulId: 1, topikId: 1 }, { unique: true });

export default mongoose.models.Materi || mongoose.model("Materi", MateriSchema);
