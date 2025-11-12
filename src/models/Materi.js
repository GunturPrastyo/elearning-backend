import mongoose from "mongoose";

// Definisikan skema untuk setiap bagian sub-materi
const subMateriSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, "Judul sub-materi tidak boleh kosong."],
    trim: true,
  },
  content: {
    type: String,
    required: [true, "Konten sub-materi tidak boleh kosong."],
  },
});

const materiSchema = new mongoose.Schema(
  {
    modulId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Modul",
    },
    topikId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Topik",
      unique: true, // Pastikan setiap topik hanya memiliki satu dokumen materi
    },
    subMateris: [subMateriSchema], // Gunakan array dari skema sub-materi di atas
    youtube: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true, // Otomatis menambahkan createdAt dan updatedAt
  }
);

const Materi = mongoose.model("Materi", materiSchema);
export default Materi;