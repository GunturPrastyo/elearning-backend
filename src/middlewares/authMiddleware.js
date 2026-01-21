import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  let token;

  try {
    // 1. Baca header Authorization (standar) atau X-Authorization (fallback)
    const authHeader = req.headers.authorization || req.headers['x-authorization'];

    if (authHeader && authHeader.startsWith('Bearer')) {
      // 2. Ambil token dari "Bearer <token>"
      token = authHeader.split(' ')[1];

      // 3. Verifikasi token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 4. Dapatkan user dan lampirkan ke request
      req.user = await User.findById(decoded.id).select("-password");
      next();
    } else {
      return res.status(401).json({ message: "Tidak ada token atau format header salah, akses ditolak" });
    }
  } catch (error) {
    res.status(401).json({ message: "Token tidak valid atau telah kedaluwarsa" });
  }
};

export const admin = (req, res, next) => {
  // req.user is set by the `protect` middleware
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403).json({ message: "Akses ditolak, hanya untuk admin" });
  }
};
