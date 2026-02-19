import mongoose from "mongoose";

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
      unique: true,
    },
    subMateris: [subMateriSchema], 
    youtube: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true, 
  }
);

const Materi = mongoose.model("Materi", materiSchema);
export default Materi;