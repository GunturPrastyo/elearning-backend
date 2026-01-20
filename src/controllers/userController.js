import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import validator from "validator";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import Feature from "../models/Feature.js"; // Diperlukan untuk kalkulasi

import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import sendEmail from "../utils/sendEmail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- FUNGSI HELPER BARU UNTUK MENGHITUNG & UPDATE LEVEL BELAJAR ---
export const recalculateUserLearningLevel = async (userId) => {
  const user = await User.findById(userId).populate({
    path: 'competencyProfile.featureId',
    model: 'Feature',
    select: 'group'
  }).lean();

  if (!user || !user.competencyProfile || user.competencyProfile.length === 0) {
    return "Dasar"; // Default level jika tidak ada profil kompetensi
  }

  // 1. Agregasi skor: Ambil skor tertinggi untuk setiap fitur unik.
  const aggregatedScores = {}; // { featureId: { score: number, group: string } }
  user.competencyProfile.forEach(comp => {
    if (comp.featureId) {
      const featureIdStr = comp.featureId._id.toString();
      if (!aggregatedScores[featureIdStr] || comp.score > aggregatedScores[featureIdStr].score) {
        aggregatedScores[featureIdStr] = {
          score: comp.score,
          group: comp.featureId.group
        };
      }
    }
  });

  // 2. Kelompokkan skor agregat berdasarkan grupnya
  const groupScores = { Dasar: [], Menengah: [], Lanjutan: [] };
  Object.values(aggregatedScores).forEach(aggScore => {
    const groupName = aggScore.group ? aggScore.group.charAt(0).toUpperCase() + aggScore.group.slice(1).toLowerCase() : 'Dasar';
    if (groupScores[groupName]) groupScores[groupName].push(aggScore.score);
  });

  const calculateAverage = (scores) => scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const avgScoreDasar = calculateAverage(groupScores.Dasar);
  const avgScoreMenengah = calculateAverage(groupScores.Menengah);

  // 3. Terapkan aturan penentuan level
  if (avgScoreDasar >= 85 && avgScoreMenengah >= 75) return "Lanjutan";
  if (avgScoreDasar >= 75) return "Menengah";
  return "Dasar";
};

// --- FUNGSI HELPER BARU UNTUK MENENTUKAN STATUS PENGUNCIAN MODUL ---
export const isModuleLockedForUser = (moduleCategory, userLearningLevel) => {
  if (!userLearningLevel) return true;

  const level = userLearningLevel.charAt(0).toUpperCase() + userLearningLevel.slice(1).toLowerCase();
  const category = moduleCategory ? moduleCategory.toLowerCase() : '';

  // Normalisasi kategori modul agar mendukung 'mudah'/'dasar', 'sedang'/'menengah', dll.
  const isDasar = ['dasar', 'mudah'].includes(category);
  const isMenengah = ['menengah', 'sedang'].includes(category);

  // Aturan 1: Jika level pengguna 'Lanjutan', semua modul terbuka.
  if (level === 'Lanjutan' || level === 'Lanjut') {
    return false;
  }

  // Aturan 2: Jika level pengguna 'Menengah', modul 'mudah' dan 'sedang' terbuka.
  if (level === 'Menengah') {
    // Modul terbuka jika kategorinya Dasar atau Menengah. Terkunci jika Lanjutan/Sulit.
    return !(isDasar || isMenengah);
  }

  // Aturan 3 (Default): Jika level pengguna 'Dasar' (atau belum ditentukan),
  // hanya modul 'mudah' yang terbuka.
  if (level === 'Dasar') {
    // Modul terkunci jika kategorinya BUKAN Dasar.
    return !isDasar;
  }

  return true; // Defaultnya, kunci modul jika ada level yang tidak dikenal.
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
      message: "Registrasi berhasil. Silakan login.",
      user: { ...userObject, hasPassword: true }, // User yang register pasti punya password
      // Mengirimkan kembali kredensial untuk pre-fill form login di frontend
      loginCredentials: {
        email: email,
        password: password, // Mengirim password asli yang diinput user
      },
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
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    let user = await User.findOne({ email });

    // Jika user tidak ditemukan, buat user baru
    if (!user) {
      user = await User.create({
        email,
        name,
        avatar: picture,
        role: 'user', // Default role untuk pengguna baru dari Google
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
    const logoUrl = `${frontendUrl}/logo1.png`; // Mengambil logo dari folder public frontend

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
            <img src="${logoUrl}" alt="Logo" style="width: 80px; height: auto; margin-bottom: 10px; display: inline-block;" />
            <h1>KELAS</h1>
          </div>
          <div class="content">
            <div class="hero-icon">🔐</div>
            <h2 style="margin-top: 0; color: #111827;">Reset Password</h2>
            <p style="text-align: left;">Halo <strong>${user.name}</strong>,</p>
            <p style="text-align: left;">Kami menerima permintaan untuk mereset password akunmu. Klik tombol di bawah ini untuk membuat password baru:</p>
            
            <a href="${resetUrl}" class="button">Reset Password Saya</a>

            <p style="text-align: left;">Link ini akan kedaluwarsa dalam <strong>15 menit</strong>.</p>
            <p style="text-align: left;">Jika Anda tidak meminta ini, abaikan saja email ini. Akun Anda tetap aman.</p>
            
            <div class="link-fallback">
              <p>Jika tombol di atas tidak berfungsi, salin dan tempel link berikut ke browser Anda:</p>
              <a href="${resetUrl}" style="color: #2563eb;">${resetUrl}</a>
            </div>
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
    
    // Agregasi skor: Ambil skor tertinggi untuk setiap fitur unik
    const scoreMap = new Map();
    if (user && user.competencyProfile) {
      user.competencyProfile.forEach(comp => {
        const featureId = comp.featureId.toString();
        const currentScore = scoreMap.get(featureId) || 0;
        if (comp.score > currentScore) {
          scoreMap.set(featureId, comp.score);
        }
      });
    }

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
      const featureData = {
        name: feature.name,
        score: scoreMap.get(feature._id.toString()) || 0,
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
    const { name, email, password, role } = req.body;

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
