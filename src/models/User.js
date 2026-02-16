import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, default: null },
  role: { type: String, enum: ["user", "admin", "super_admin"], default: "user" },
  avatar: { type: String, default: "" },
  kelas: { type: String, default: null },
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
      required: false,
    },
    score: {
      type: Number,
      required: true,
      default: 0,
    },
    _id: false // Tidak perlu _id untuk setiap item array
  }],
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  dailyStreak: { type: Number, default: 0 },
  lastActiveAt: Date, // Field baru untuk melacak kapan terakhir user online
  lastIp: String, // Menyimpan IP terakhir user

}, { timestamps: true });




// Method untuk memeriksa password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
