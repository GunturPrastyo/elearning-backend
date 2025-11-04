import mongoose from "mongoose";

const topikSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    modulId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Modul",
      required: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const Topik = mongoose.model("Topik", topikSchema);
export default Topik;
