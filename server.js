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
import notificationRoutes from './src/routes/notificationRoutes.js';

dotenv.config();
const app = express();

// ====================== CORS CONFIG ======================
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true, // penting untuk kirim cookie dari browser
  })
);

// ====================== MIDDLEWARE ======================
app.use(express.json());
app.use(cookieParser());

// Folder statis
app.use(express.static("public"));
// app.use("/uploads", express.static("uploads"));
app.use("/uploads", express.static("public/uploads"));

// ====================== ROUTES ======================
app.use("/api/modul", modulRoutes);
app.use("/api/topik", topikRoutes);
app.use("/api/materi", materiRoutes);
app.use("/api/users", userRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/upload", uploadRoutes);
app.use('/api/notifications', notificationRoutes);

// ====================== MONGODB CONNECT ======================
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ Database connected successfully");
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  });

// ====================== DEFAULT ROUTE ======================
app.get("/", (req, res) => {
  res.json({ message: "Server is running 🚀" });
});
