import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";

import fs from "fs";
import path from "path";
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ========================= GET USER PROFILE =========================
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: "User tidak ditemukan" });
    }
  } catch (error) {
    console.error("Get Profile Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= REGISTER =========================
export const registerUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email sudah digunakan" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      role: role === "admin" ? "admin" : "user",
    });

    const userObject = newUser.toObject();
    delete userObject.password;

    res.status(201).json({
      message: "Registrasi berhasil",
      user: { ...userObject, hasPassword: true }, // User yang register pasti punya password
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= UPDATE USER PROFILE =========================
export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    // Cek jika email baru sudah digunakan oleh user lain
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: "Email sudah digunakan" });
      }
      user.email = email;
    }

    user.name = name || user.name;

    // Handle upload avatar baru
    if (req.file) {
      // Hapus avatar lama jika ada dan bukan URL dari Google
      if (user.avatar && !user.avatar.startsWith("http")) {
        const __dirname = path.dirname(new URL(import.meta.url).pathname.substring(1));
        const oldPath = path.join(__dirname, "..", "..", "public", "uploads", user.avatar);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      user.avatar = req.file.filename;
    }

    await user.save();

    const userObject = user.toObject();
    delete userObject.password;

    res.status(200).json({
      message: "Profil berhasil diperbarui",
      user: { ...userObject, hasPassword: !!user.password },
    });
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= CHANGE PASSWORD =========================
export const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    // User yang login via Google tidak memiliki password
    if (!user.password) {
      return res.status(400).json({ message: "Tidak dapat mengubah password untuk akun Google" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Password saat ini salah" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.status(200).json({ message: "Password berhasil diubah" });
  } catch (error) {
    console.error("Change Password Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= LOGIN MANUAL =========================
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Email tidak ditemukan" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Password salah" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userObject = user.toObject();
    delete userObject.password;

    console.log(`[Login] Mengirim token untuk user: ${user.email}.`);

    res.status(200).json({
      message: "Login berhasil",
      user: { ...userObject, hasPassword: true }, // User login manual pasti punya password
      token: token, // Kirim token di body respons
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= LOGIN GOOGLE =========================
export const googleLogin = async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      return res.status(403).json({
        message: "Akses ditolak. Akun Anda belum terdaftar oleh admin.",
      });
    }

    const role =
      email.endsWith("@students.unnes.ac.id") || email === "admin@example.com"
        ? "admin"
        : "user";

    // Hanya update jika ada perubahan, dan JANGAN hapus password jika sudah ada.
    // Password hanya di-set null jika user pertama kali dibuat via Google atau memang belum punya password.
    const updateData = { name, avatar: picture, role };
    if (!user.password) {
      updateData.password = null;
    }

    // Cek apakah ada data yang perlu diupdate
    if (user.name !== name || user.avatar !== picture || user.role !== role) {
      user.set(updateData);
      await user.save();
    }

    const jwtToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userObject = user.toObject();
    delete userObject.password;

    console.log(`[Google Login] Mengirim token untuk user: ${user.email}.`);

    res.status(200).json({
      message: "Login Google berhasil",
      user: { ...userObject, hasPassword: !!user.password },
      token: jwtToken, // Kirim token di body respons
    });
  } catch (error) {
    console.error("Google Login Error:", error);
    res.status(500).json({ message: "Login Google gagal. Silakan coba lagi." });
  }
};

// ========================= LOGOUT =========================
export const logoutUser = (req, res) => {
  // Dengan Bearer Token, logout ditangani oleh client dengan menghapus token.
  res.status(200).json({ message: "Logout berhasil" });
};

// ========================= COMPLETE TOPIK =========================
export const completeTopic = async (req, res) => {
  try {
    const { topikId } = req.body;
    const userId = req.user._id;

    if (!topikId) {
      return res.status(400).json({ message: "topikId diperlukan" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    // Tambahkan topikId ke array jika belum ada (mencegah duplikat)
    await User.updateOne({ _id: userId }, { $addToSet: { topicCompletions: topikId } });

    res.status(200).json({ message: "Topik berhasil ditandai selesai" });
  } catch (error) {
    console.error("Error completing topic:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};
