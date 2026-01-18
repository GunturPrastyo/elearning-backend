import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";

// Import Routes
import modulRoutes from "./src/routes/modulRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import topikRoutes from "./src/routes/topikRoutes.js";
import materiRoutes from "./src/routes/materiRoutes.js";
import questionRoutes from "./src/routes/questionRoutes.js";
import testRoutes from "./src/routes/testRoutes.js";
import resultRoutes from "./src/routes/resultRoutes.js";
import uploadRoutes from "./src/routes/uploadRoutes.js";
import featureRoutes from "./src/routes/featureRoutes.js";
import notificationRoutes from './src/routes/notificationRoutes.js';
import analiticRoutes from './src/routes/analiticRoutes.js'; // Pastikan file ini ada
dotenv.config();
const app = express();

// ====================== CORS CONFIG ======================
const allowedOrigins = [
  process.env.FRONTEND_URL || "https://kelas-smk.vercel.app",
  "http://localhost:3000", // Untuk development lokal
  "https://localhost:3000", // Untuk development lokal dengan HTTPS
];

const corsOptions = {
  origin: function (origin, callback) {
    // Izinkan request jika origin ada di dalam whitelist atau jika request tidak memiliki origin (seperti dari Postman)
    // Tambahkan izin untuk semua domain .vercel.app (untuk preview deployments)
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || (origin && origin.endsWith('.vercel.app'))) {
      callback(null, true);
    } else {
      console.error("❌ CORS Blocked Origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  // Izinkan frontend mengirim header kustom 'X-Authorization'
  allowedHeaders: ["Content-Type", "X-Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));

// ====================== MIDDLEWARE ======================
app.use(express.json());
app.use(cookieParser());

// Folder statis
app.use(express.static("public"));
// app.use("/uploads", express.static("uploads"));
app.use("/uploads", express.static("public/uploads"));

// ====================== DATABASE CONNECTION ======================
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) return;
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    // Throw error agar middleware bisa menangkap kegagalan koneksi
    throw err;
  }
};

// Middleware untuk memastikan koneksi database pada setiap request (Penting untuk Vercel)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("🔥 Middleware DB Error:", error);
    res.status(500).json({ message: "Gagal terhubung ke database", error: error.message });
  }
});

// ====================== ROUTES ======================
app.use("/api/modul", modulRoutes);
app.use("/api/topik", topikRoutes);
app.use("/api/materi", materiRoutes);
app.use("/api/users", userRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/features", featureRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analiticRoutes);

// ====================== DEFAULT ROUTE ======================
app.get("/", (req, res) => {
  res.json({ message: "Server is running 🚀" });
});

// ====================== SERVER START ======================
// Hanya jalankan app.listen jika di lingkungan development (lokal)
// Di Vercel, export app akan ditangani oleh runtime Vercel
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

export default app;
