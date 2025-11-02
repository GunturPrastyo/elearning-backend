import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const modulStatusSchema = new mongoose.Schema(
  {
    modulId: { type: mongoose.Schema.Types.ObjectId, ref: "Modul", required: true },
    status: { type: String, enum: ["terkunci", "selesai"], default: "terkunci" },
    progress: { type: Number, default: 0 }, // persenan progress 0-100
  },
  { _id: false }
);



const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, default: null },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  avatar: { type: String, default: "" },
  topicCompletions: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Topik" }
  ],

}, { timestamps: true });




// Method untuk memeriksa password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
