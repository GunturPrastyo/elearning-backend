// import express from "express";
// import mongoose from "mongoose";
// import dotenv from "dotenv";
// import cors from "cors";
// import cookieParser from "cookie-parser";

// // Import Routes
// import modulRoutes from "./src/routes/modulRoutes.js";
// import userRoutes from "./src/routes/userRoutes.js";
// import topikRoutes from "./src/routes/topikRoutes.js";
// import materiRoutes from "./src/routes/materiRoutes.js";
// import questionRoutes from "./src/routes/questionRoutes.js";
// import testRoutes from "./src/routes/testRoutes.js";
// import resultRoutes from "./src/routes/resultRoutes.js";
// import uploadRoutes from "./src/routes/uploadRoutes.js";
// import featureRoutes from "./src/routes/featureRoutes.js";
// import notificationRoutes from './src/routes/notificationRoutes.js';
// import analiticRoutes from './src/routes/analiticRoutes.js'; // Pastikan file ini ada
// dotenv.config();
// const app = express();

// // ====================== CORS CONFIG ======================
// const allowedOrigins = [
//   process.env.FRONTEND_URL || "https://kelas-smk.vercel.app",
//   "http://localhost:3000", // Untuk development lokal
//   "https://localhost:3000", // Untuk development lokal dengan HTTPS
// ];

// const corsOptions = {
//   origin: function (origin, callback) {
//     // Izinkan request jika origin ada di dalam whitelist atau jika request tidak memiliki origin (seperti dari Postman)
//     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       callback(new Error("Not allowed by CORS"));
//     }
//   },
//   methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
//   // Izinkan frontend mengirim header kustom 'X-Authorization'
//   allowedHeaders: ["Content-Type", "X-Authorization"],
//   credentials: true,
// };

// app.use(cors(corsOptions));

// // ====================== MIDDLEWARE ======================
// app.use(express.json());
// app.use(cookieParser());

// // Folder statis
// app.use(express.static("public"));
// // app.use("/uploads", express.static("uploads"));
// app.use("/uploads", express.static("public/uploads"));

// // ====================== ROUTES ======================
// app.use("/api/modul", modulRoutes);
// app.use("/api/topik", topikRoutes);
// app.use("/api/materi", materiRoutes);
// app.use("/api/users", userRoutes);
// app.use("/api/questions", questionRoutes);
// app.use("/api/tests", testRoutes);
// app.use("/api/results", resultRoutes);
// app.use("/api/upload", uploadRoutes);
// app.use("/api/features", featureRoutes);
// app.use('/api/notifications', notificationRoutes);
// app.use('/api/analytics', analiticRoutes);

// // ====================== MONGODB CONNECT ======================
// mongoose
//   .connect(process.env.MONGO_URI, {
//     useNewUrlParser: true,
//     useUnifiedTopology: true,
//   })
//   .then(() => {
//     console.log("✅ Database connected successfully");
//     const PORT = process.env.PORT || 5000;
//     app.listen(PORT, () => {
//       console.log(`🚀 Server running on port ${PORT}`);
//     });
//   })
//   .catch((err) => {
//     console.error("❌ Database connection failed:", err.message);
//     process.exit(1);
//   });

// // ====================== DEFAULT ROUTE ======================
// app.get("/", (req, res) => {
//   res.json({ message: "Server is running 🚀" });
// });

import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";

// Routes
import modulRoutes from "./src/routes/modulRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import topikRoutes from "./src/routes/topikRoutes.js";
import materiRoutes from "./src/routes/materiRoutes.js";
import questionRoutes from "./src/routes/questionRoutes.js";
import testRoutes from "./src/routes/testRoutes.js";
import resultRoutes from "./src/routes/resultRoutes.js";
import uploadRoutes from "./src/routes/uploadRoutes.js";
import featureRoutes from "./src/routes/featureRoutes.js";
import notificationRoutes from "./src/routes/notificationRoutes.js";
import analiticRoutes from "./src/routes/analiticRoutes.js";

dotenv.config();

const app = express();

/* ====================== CORS ====================== */
const allowedOrigins = [
  process.env.FRONTEND_URL || "https://kelas-smk.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

/* ====================== MIDDLEWARE ====================== */
app.use(express.json());
app.use(cookieParser());

/* ====================== ROUTES ====================== */
app.use("/api/modul", modulRoutes);
app.use("/api/topik", topikRoutes);
app.use("/api/materi", materiRoutes);
app.use("/api/users", userRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/features", featureRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/analytics", analiticRoutes);

/* ====================== DEFAULT ====================== */
app.get("/", (req, res) => {
  res.json({ message: "Server is running 🚀" });
});

/* ====================== DB CONNECT (SERVERLESS SAFE) ====================== */
let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  await mongoose.connect(process.env.MONGO_URI);
  isConnected = true;
  console.log("✅ MongoDB connected");
}

// ⚠️ PENTING
export default async function handler(req, res) {
  await connectDB();
  return app(req, res);
}
