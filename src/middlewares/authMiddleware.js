import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  let token;

  try {
    // 1. Baca header kustom 'X-Authorization'
    const authHeader = req.headers['x-authorization'];

    if (authHeader && authHeader.startsWith('Bearer')) {
      // 2. Ambil token dari "Bearer <token>"
      token = authHeader.split(' ')[1];

      // 3. Verifikasi token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 4. Dapatkan user dan lampirkan ke request
      req.user = await User.findById(decoded.id).select("-password");

      // --- UPDATE STATUS ONLINE ---
      // Perbarui lastActiveAt setiap kali user melakukan request yang terautentikasi
      if (req.user) {
        await User.findByIdAndUpdate(decoded.id, { lastActiveAt: new Date() });
      }

      next();
    } else {
      return res.status(401).json({ message: "Tidak ada token atau format header salah, akses ditolak" });
    }
  } catch (error) {
    res.status(401).json({ message: "Token tidak valid atau telah kedaluwarsa" });
  }
};

export const admin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Akses ditolak, hanya untuk admin" });
  }
};
