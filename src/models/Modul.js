import mongoose from "mongoose";

const modulSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    icon: { type: String, default: null },
    category: { type: String, required: true },
    overview: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    order: { type: Number, default: 0, index: true },
    features: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Feature",
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Modul", modulSchema);
