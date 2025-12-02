import mongoose from "mongoose";

// Skema untuk menyimpan bobot setiap fitur dalam sebuah modul
const featureWeightSchema = new mongoose.Schema(
  {
    featureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Feature",
    },
    weight: { type: Number, default: 0, min: 0, max: 1 },
  },
  { _id: false } // Tidak perlu _id untuk setiap item dalam array
);

const modulSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    icon: { type: String, default: null },
    category: { type: String, required: true },
    overview: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    order: { type: Number, default: 0, index: true },
    featureWeights: { type: [featureWeightSchema], default: [] }, // Mengganti 'features'
  },
  { timestamps: true }
);

export default mongoose.model("Modul", modulSchema);
