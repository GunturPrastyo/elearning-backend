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
    modulId: { 
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Modul',
      required: false,
    },
    score: {
      type: Number,
      required: true,
      default: 0,
    },
    _id: false 
  }],
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  dailyStreak: { type: Number, default: 0 },
  lastActiveAt: Date, 
  lastIp: String, 
  hasSeenModulTour: { type: Boolean, default: false },
  hasSeenProfileTour: { type: Boolean, default: false },
  hasSeenModuleDetailTour: { type: Boolean, default: false },
  hasSeenAnalyticsTour: { type: Boolean, default: false },
  lastStreakShownDate: { type: Date, default: null },
}, { timestamps: true });


userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
