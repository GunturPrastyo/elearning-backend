import mongoose from "mongoose";
import dotenv from "dotenv";
import Modul from "../models/Modul.js"; // path ke model Modul

dotenv.config();

const modules = [
  {
    title: "JavaScript Dasar",
    icon: "",
    category: "mudah",
    overview: "Modul ini membahas konsep dasar JavaScript seperti variabel, tipe data, dan operator.",
    slug: "javascript-dasar",
  },
  {
    title: "Fungsi dan Lingkup",
    icon: "",
    category: "sedang",
    overview: "Pelajari bagaimana fungsi bekerja, konsep scope, dan cara membuat fungsi modular di JavaScript.",
    slug: "fungsi-dan-lingkup",
  },
  {
    title: "Manipulasi DOM",
    icon: "",
    category: "sulit",
    overview: "Panduan lengkap tentang cara mengubah struktur HTML menggunakan JavaScript.",
    slug: "manipulasi-dom",
  },
];

const seedModules = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Database connected");

    // Hapus data lama (opsional)
    await Modul.deleteMany();
    console.log("ℹ️ Old modules removed");

    // Masukkan data baru
    await Modul.insertMany(modules);
    console.log("✅ Modules seeded successfully");

    process.exit();
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
};

seedModules();
