import mongoose from "mongoose";

const featureSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Nama fitur tidak boleh kosong."],
      unique: true,
      trim: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Feature", featureSchema);