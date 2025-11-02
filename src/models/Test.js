import mongoose from "mongoose";

const testSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  type: { 
    type: String, 
    enum: ["pre", "post-topik", "post-modul"], 
    required: true 
  },
  modulId: { type: mongoose.Schema.Types.ObjectId, ref: "Modul" },
  topikId: { type: mongoose.Schema.Types.ObjectId, ref: "Topik" },
  questions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
}, { timestamps: true });

export default mongoose.model("Test", testSchema);
