import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import validator from "validator";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import Feature from "../models/Feature.js"; // Diperlukan untuk kalkulasi
import Modul from "../models/Modul.js";

import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import sendEmail from "../utils/sendEmail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ========================= VERIFY EMAIL =========================
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ message: "Token verifikasi diperlukan." });
    }

    // 1. Verifikasi token JWT yang berisi data registrasi sementara
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: "Link verifikasi tidak valid atau sudah kadaluwarsa." });
    }

    const { name, email, password, role } = decoded;

    // 2. Cek apakah email sudah terdaftar (mencegah duplikasi jika user mendaftar ulang saat link dikirim)
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email sudah terdaftar." });
    }

    // 3. Buat user baru di database SEKARANG (setelah verifikasi berhasil)
    await User.create({ name, email, password, role, isVerified: true });
    
    res.status(200).json({ message: "Email berhasil diverifikasi. Silakan login.", email });
  } catch (error) {
    console.error("Verify Email Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

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
    const { name, email, password, confirmPassword, role } = req.body;

    // Validasi input dasar
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "Nama, email, password, dan konfirmasi password wajib diisi." });
    }

    // Validasi format email
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: "Format email tidak valid." });
    }

    // Validasi panjang password (contoh: min 8 karakter)
    if (password.length < 8) {
      return res.status(400).json({ message: "Password harus memiliki minimal 8 karakter." });
    }

    // Validasi konfirmasi password
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Konfirmasi password tidak cocok." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email sudah digunakan" });

    // Hash password sebelum dimasukkan ke token (agar aman saat dikirim)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Buat payload token berisi data user sementara (Stateless Registration)
    const userPayload = {
      name, email, password: hashedPassword, role: role === "admin" ? "admin" : "user"
    };

    // Generate JWT Token (berlaku 1 jam)
    const verificationToken = jwt.sign(userPayload, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Kirim Email Verifikasi
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Menggunakan path /verif-email sesuai file yang ada di frontend
    const verifyUrl = `${frontendUrl}/verif-email?token=${verificationToken}`;
    const logoUrl = `${frontendUrl}/logo2.webp`;

    const message = `Verifikasi email Anda: ${verifyUrl}`;
    const htmlMessage = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; line-height: 1.6; }
          .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #e5e7eb; }
          .header { background-color: #2563eb; padding: 30px 20px; text-align: center; }
          .content { padding: 20px 30px 40px; color: #374151; text-align: center; }
          .button { background-color: #2563eb; color: #ffffff !important; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 600; display: inline-block; margin: 25px 0; }
          .footer { background-color: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
          
          </div>
          <div class="content">
            <h2 style="margin-top: 0; color: #111827;">Verifikasi Email</h2>
            <p>Halo <strong>${name}</strong>,</p>
            <p>Terima kasih telah mendaftar. Silakan klik tombol di bawah ini untuk memverifikasi email Anda dan mengaktifkan akun:</p>
            <a href="${verifyUrl}" class="button">Verifikasi Email Saya</a>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} E-Learning Personalisasi.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await sendEmail({
        email: email,
        subject: 'Verifikasi Email - E-Learning Personalisasi',
        message,
        html: htmlMessage
      });
    } catch (err) {
      console.error("Email verification send error:", err);
      // Opsional: Hapus user jika email gagal dikirim agar bisa daftar ulang
      return res.status(500).json({ message: "Gagal mengirim email verifikasi." });
    }

    res.status(200).json({
      message: "Registrasi berhasil. Silakan cek email Anda untuk verifikasi.",
      // Tidak mengirim loginCredentials agar user tidak bisa auto-login sebelum verifikasi
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
      if (user.avatar && !user.avatar.startsWith("http") && !user.avatar.includes("placeholder")) {
        const avatarFileName = path.basename(user.avatar);
        const oldPath = path.join(__dirname, "..", "..", "public", "uploads", avatarFileName);
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch (err) {
            console.error("Gagal menghapus avatar lama:", err);
          }
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

    // Validasi format email sebelum query ke database
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: "Format email tidak valid." });
    }

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Email tidak ditemukan" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Password salah" });

    // Cek apakah email sudah diverifikasi
    if (user.isVerified === false) {
      return res.status(401).json({ message: "Email belum diverifikasi. Silakan cek inbox email Anda." });
    }

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

// ========================= REGISTER/LOGIN GOOGLE =========================
export const googleAuth = async (req, res) => {
  try {
    const { token } = req.body;
    let email, name, picture;

    try {
      // Percobaan 1: Verifikasi sebagai ID Token (Cara Lama/Standard Component)
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      email = payload.email;
      name = payload.name;
      picture = payload.picture;
    } catch (idTokenError) {
      // Percobaan 2: Verifikasi sebagai Access Token (Cara Baru/Custom Button)
      client.setCredentials({ access_token: token });
      const userinfo = await client.request({
        url: "https://www.googleapis.com/oauth2/v3/userinfo",
      });
      email = userinfo.data.email;
      name = userinfo.data.name;
      picture = userinfo.data.picture;
    }

    let user = await User.findOne({ email });

    // Jika user tidak ditemukan, buat user baru
    if (!user) {
      user = await User.create({
        email,
        name,
        avatar: picture,
        role: 'user', // Default role untuk pengguna baru dari Google
        isVerified: true, // User Google otomatis terverifikasi
        password: null // Akun Google tidak memiliki password
      });
    } else {
      // Jika user sudah ada, update nama dan avatar jika belum ada atau berbeda
      user.name = user.name || name;
      user.avatar = user.avatar || picture;
      await user.save({ validateModifiedOnly: true });
    }

    const jwtToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userObject = user.toObject();
    delete userObject.password;

    res.status(200).json({
      message: "Autentikasi Google berhasil",
      user: { ...userObject, hasPassword: !!user.password },
      token: jwtToken,
    });
  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(500).json({ message: "Autentikasi Google gagal. Silakan coba lagi." });
  }
};

// ========================= FORGOT PASSWORD =========================
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      console.log("[ForgotPassword] Gagal: Email tidak disertakan dalam request.");
      return res.status(400).json({ message: 'Email wajib diisi.' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      console.log(`[ForgotPassword] Gagal: Email ${email} tidak ditemukan.`);
      return res.status(404).json({ message: 'Email tidak terdaftar.' });
    }

    // Cek jika user login menggunakan Google (tidak punya password)
    if (!user.password) {
      console.log(`[ForgotPassword] Gagal: User ${email} adalah akun Google (tanpa password).`);
      // Gunakan status 200 agar tidak muncul error merah di console browser, tapi kirim flag success: false
      return res.status(200).json({ success: false, message: 'Akun ini menggunakan login Google. Silakan login dengan Google.' });
    }

    // 1. Generate Token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // 2. Hash token sebelum disimpan ke DB
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // 3. Set Expiration (15 menit)
    const resetPasswordExpire = Date.now() + 15 * 60 * 1000;

    user.resetPasswordToken = resetPasswordToken;
    user.resetPasswordExpire = resetPasswordExpire;
    await user.save({ validateBeforeSave: false });

    // 4. Buat Reset URL (Arahkan ke Frontend)
    // Pastikan FRONTEND_URL ada di .env, atau fallback ke localhost:3000
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
    const logoUrl = `${frontendUrl}/logo2.webp`; // Mengambil logo dari folder public frontend

    // 5. Buat Template Email HTML
    const message = `Anda meminta reset password. Silakan klik link berikut: ${resetUrl}`; // Fallback untuk klien email teks biasa
    
    const htmlMessage = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f3f4f6;
            margin: 0;
            padding: 0;
            line-height: 1.6;
          }
          .container {
            max-width: 600px;
            margin: 30px auto;
            background-color: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            border: 1px solid #e5e7eb;
          }
          .header {
            background-color: #2563eb; /* Warna biru tema */
            padding: 30px 20px;
            text-align: center;
          }
          .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 24px;
            font-weight: 700;
          }
          .hero-icon {
            font-size: 64px;
            text-align: center;
            margin: 20px 0;
            display: block;
          }
          .content {
            padding: 20px 30px 40px;
            color: #374151;
            text-align: center;
          }
          .button {
            background-color: #2563eb;
            color: #ffffff !important;
            padding: 14px 28px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            display: inline-block;
            margin: 25px 0;
            box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
            transition: background-color 0.3s;
          }
          .button:hover {
            background-color: #1d4ed8;
          }
          .footer {
            background-color: #f9fafb;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #6b7280;
            border-top: 1px solid #e5e7eb;
          }
          .link-fallback {
            font-size: 12px;
            color: #6b7280;
            word-break: break-all;
            margin-top: 20px;
            text-align: left;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            
          </div>
          <div class="content">
            <h2 style="margin-top: 0; color: #111827;">Reset Password</h2>
            <p style="text-align: left;">Halo <strong>${user.name}</strong>,</p>
            <p style="text-align: left;">Kami menerima permintaan untuk mereset password akunmu. Klik tombol di bawah ini untuk membuat password baru:</p>
            
            <a href="${resetUrl}" class="button">Reset Password Saya</a>

            <p style="text-align: left;">Link ini akan kedaluwarsa dalam <strong>15 menit</strong>.</p>
            <p style="text-align: left;">Jika Anda tidak meminta ini, abaikan saja email ini. Akun Anda tetap aman.</p>
            
       
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} E-Learning Personalisasi. All rights reserved.</p>
            <p>Email ini dikirim secara otomatis, mohon jangan dibalas.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    try {
      await sendEmail({
        email: user.email,
        subject: 'Reset Password Token',
        message,
        html: htmlMessage, // Kirim versi HTML
      });

      res.status(200).json({ success: true, message: 'Jika email terdaftar, link reset telah dikirim.' });
    } catch (error) {
      console.error("Email send error:", error);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: 'Email tidak dapat dikirim.' });
    }
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= RESET PASSWORD =========================
export const resetPassword = async (req, res) => {
  try {
    // 1. Hash token dari URL agar cocok dengan yang di DB
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    // 2. Cari user dengan token valid dan belum expired
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Token tidak valid atau telah kedaluwarsa" });
    }

    // 3. Set password baru
    if (req.body.password !== req.body.confirmPassword) {
       return res.status(400).json({ message: "Password tidak cocok" });
    }
    user.password = await bcrypt.hash(req.body.password, 10);
    
    // 4. Hapus token reset
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    res.status(200).json({ message: "Password berhasil diubah. Silakan login." });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= LOGOUT =========================
export const logoutUser = async (req, res) => {
  try {
    // Pastikan kita mendapatkan ID user, baik dari _id (mongoose doc) atau id (jwt payload)
    const userId = req.user?._id || req.user?.id;

    if (userId) {
      // Reset lastActiveAt ke masa lalu (Epoch) agar user langsung dianggap offline
      await User.findByIdAndUpdate(userId, { lastActiveAt: new Date(0) });
      console.log(`[Logout] User ${userId} status set to offline.`);
    }
    res.status(200).json({ message: "Logout berhasil" });
  } catch (error) {
    console.error("Logout Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
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

// ========================= GET COMPETENCY PROFILE =========================
export const getCompetencyProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Ambil profil kompetensi pengguna dan buat peta skor
    const user = await User.findById(userId).select('competencyProfile').lean();
    
    // --- REVISI: Hitung Skor Berbobot (Weighted Average) ---
    // Menggunakan logika yang sama dengan resultController agar skor akurat sesuai bobot modul
    const allModules = await Modul.find().select('featureWeights').lean();
    const userFeatureScores = {}; // Map: FeatureId -> Score

    if (user && user.competencyProfile) {
      const featureMap = {}; // FeatureId -> { weightedSum: 0, totalWeight: 0 }

      user.competencyProfile.forEach(cp => {
        if (!cp.modulId || !cp.featureId) return;
        
        const fid = cp.featureId.toString();
        const mid = cp.modulId.toString();
        const rawScore = cp.score;

        const module = allModules.find(m => m._id.toString() === mid);
        if (module && module.featureWeights) {
          const fw = module.featureWeights.find(f => f.featureId.toString() === fid);
          if (fw) {
            const weight = fw.weight || 0;
            if (!featureMap[fid]) featureMap[fid] = { weightedSum: 0, totalWeight: 0 };
            featureMap[fid].weightedSum += rawScore * weight;
            featureMap[fid].totalWeight += weight;
          }
        }
      });

      Object.keys(featureMap).forEach(fid => {
        const data = featureMap[fid];
        userFeatureScores[fid] = data.totalWeight > 0 ? data.weightedSum / data.totalWeight : 0;
      });
    }
    // -------------------------------------------------------
    
    // --- Calculate Class Averages ---
    const featureStats = await User.aggregate([
      { $unwind: "$competencyProfile" },
      {
        $group: {
          _id: { userId: "$_id", featureId: "$competencyProfile.featureId" },
          avgScore: { $avg: "$competencyProfile.score" }
        }
      },
      {
        $group: {
          _id: "$_id.featureId",
          averageScore: { $avg: "$avgScore" }
        }
      }
    ]);

    const averageScoreMap = new Map();
    featureStats.forEach(stat => {
      if (stat._id) {
        averageScoreMap.set(stat._id.toString(), stat.averageScore);
      }
    });

    // 2. Ambil semua fitur yang ada di database
    const allFeatures = await Feature.find({}).sort({ name: 1 }).lean();

    // 3. Inisialisasi struktur data untuk pengelompokan
    const groupedFeatures = {
      Dasar: [],
      Menengah: [],
      Lanjutan: [],
    };

    // 4. Kelompokkan fitur dan tambahkan skor pengguna
    allFeatures.forEach(feature => {
      const featureIdStr = feature._id.toString();
      const featureData = {
        name: feature.name,
        score: userFeatureScores[featureIdStr] || 0,
        average: Math.round(averageScoreMap.get(featureIdStr) || 0),
      };
      if (groupedFeatures[feature.group]) {
        groupedFeatures[feature.group].push(featureData);
      }
    });

    res.status(200).json({ competencyProfile: groupedFeatures });
  } catch (error) {
    console.error("Error fetching competency profile:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= ADMIN: GET ALL USERS =========================
export const getAllUsers = async (req, res) => {
  try {
    // Ambil semua user, jangan tampilkan password, urutkan berdasarkan nama
    const users = await User.find({}).select("-password").sort({ name: 1 });
    res.status(200).json(users);
  } catch (error) {
    console.error("Error getting all users:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= ADMIN: CREATE USER =========================
export const createUser = async (req, res) => {
  try {
    const { name, email, password, role, kelas } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Nama dan email wajib diisi." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email sudah digunakan." });
    }

    // Gunakan password yang diberikan atau default 'password123'
    const passwordToHash = password || 'password123';
    const hashedPassword = await bcrypt.hash(passwordToHash, 10);

    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      role: role || "user", // Default role adalah 'user'
      kelas,
    });

    const userObject = newUser.toObject();
    delete userObject.password;

    res.status(201).json({
      message: "Pengguna berhasil dibuat.",
      user: userObject,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= ADMIN: UPDATE USER =========================
export const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, role, kelas } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "Pengguna tidak ditemukan." });
    }

    // Cek jika email baru sudah digunakan oleh user lain
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: "Email sudah digunakan." });
      }
    }

    user.name = name || user.name;
    user.email = email || user.email;
    user.role = role || user.role;
    if (kelas !== undefined) user.kelas = kelas;

    const updatedUser = await user.save();
    const userObject = updatedUser.toObject();
    delete userObject.password;

    res.status(200).json(userObject);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// ========================= ADMIN: DELETE USER =========================
export const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Jangan biarkan admin menghapus akunnya sendiri dari sini
    if (userId === req.user.id) {
      return res.status(400).json({ message: "Tidak dapat menghapus akun sendiri." });
    }

    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({ message: "Pengguna tidak ditemukan." });
    }

    res.status(200).json({ message: "Pengguna berhasil dihapus." });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};
