import mongoose from "mongoose";

const featureSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Nama fitur tidak boleh kosong."],
      unique: true,
      trim: true,
    },
    group: {
      type: String,
      required: [true, "Grup fitur tidak boleh kosong."],
      enum: ["Dasar", "Menengah", "Lanjutan"],
      default: "Dasar",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Feature", featureSchema);