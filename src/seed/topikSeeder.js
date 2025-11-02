import mongoose from "mongoose";
import dotenv from "dotenv";
import Modul from "../models/Modul.js";
import Topik from "../models/Topik.js"; // pastikan path sesuai

dotenv.config();

const seedTopik = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Database connected");

    // Hapus semua topik lama
    await Topik.deleteMany();
    console.log("🗑️ Topik lama dihapus");

    // Ambil semua modul dari database
    const modules = await Modul.find();
    if (modules.length === 0) {
      console.log("❌ Tidak ada modul ditemukan. Jalankan seedModul.js dulu.");
      process.exit(1);
    }

    const getModulId = (slug) => {
      const modul = modules.find((m) => m.slug === slug);
      if (!modul) {
        throw new Error(`Modul dengan slug "${slug}" tidak ditemukan.`);
      }
      return modul._id;
    };

    // Buat daftar topik per modul (hanya title, slug, dan modulId)
    const topics = [
      // Untuk modul JavaScript Dasar
      {
        title: "Pengenalan JavaScript",
        slug: "pengenalan-javascript",
        modulId: getModulId("javascript-dasar"),
      },
      {
        title: "Variabel dan Tipe Data",
        slug: "variabel-dan-tipe-data",
        modulId: getModulId("javascript-dasar"),
      },
      {
        title: "Operator dan Ekspresi",
        slug: "operator-dan-ekspresi",
        modulId: getModulId("javascript-dasar"),
      },
      {
        title: "Struktur Kontrol: Percabangan (if-else)",
        slug: "struktur-kontrol-percabangan",
        modulId: getModulId("javascript-dasar"),
      },
      {
        title: "Struktur Kontrol: Perulangan (for, while)",
        slug: "struktur-kontrol-perulangan",
        modulId: getModulId("javascript-dasar"),
      },

      // Untuk modul Fungsi dan Lingkup
      {
        title: "Membuat Fungsi",
        slug: "membuat-fungsi",
        modulId: getModulId("fungsi-dan-lingkup"),
      },
      {
        title: "Lingkup Variabel (Scope)",
        slug: "lingkup-variabel-scope",
        modulId: getModulId("fungsi-dan-lingkup"),
      },
      {
        title: "Parameter dan Argumen",
        slug: "parameter-dan-argumen",
        modulId: getModulId("fungsi-dan-lingkup"),
      },
      {
        title: "Arrow Function",
        slug: "arrow-function",
        modulId: getModulId("fungsi-dan-lingkup"),
      },

      // Untuk modul Manipulasi DOM
      {
        title: "Seleksi Elemen DOM",
        slug: "seleksi-elemen-dom",
        modulId: getModulId("manipulasi-dom"),
      },
      {
        title: "Mengubah Konten DOM",
        slug: "mengubah-konten-dom",
        modulId: getModulId("manipulasi-dom"),
      },
      {
        title: "Event Handling",
        slug: "event-handling",
        modulId: getModulId("manipulasi-dom"),
      },
      {
        title: "Mengubah Style Elemen",
        slug: "mengubah-style-elemen",
        modulId: getModulId("manipulasi-dom"),
      },
    ];

    // Tambahkan ke database
    await Topik.insertMany(topics);
    console.log("✅ Topik berhasil ditambahkan");

    process.exit();
  } catch (error) {
    console.error("❌ Gagal menambahkan topik:", error);
    process.exit(1);
  }
};

seedTopik();
