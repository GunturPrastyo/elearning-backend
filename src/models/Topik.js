import mongoose from "mongoose";

const TopikSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    modulId: { type: mongoose.Schema.Types.ObjectId, ref: "Modul", required: true }

  },
  { timestamps: true }
);

export default mongoose.models.Topik || mongoose.model("Topik", TopikSchema);
