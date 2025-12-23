import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, default: null },
  role: { type: String, enum: ["user", "admin", "super_admin"], default: "user" },
  avatar: { type: String, default: "" },
  topicCompletions: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Topik" }
  ],
  learningLevel: {
    type: String,
    enum: ["Dasar", "Menengah", "Lanjutan"],
    default: "Dasar",
  },
  competencyProfile: [{
    featureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Feature',
      required: true,
    },
    modulId: { // Tambahkan field ini untuk melacak asal skor
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Modul',
      required: true,
    },
    score: {
      type: Number,
      required: true,
      default: 0,
    },
    _id: false // Tidak perlu _id untuk setiap item array
  }],

}, { timestamps: true });




// Method untuk memeriksa password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
