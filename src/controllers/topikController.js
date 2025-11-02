import Topik from "../models/Topik.js";
import slugify from "slugify";
import Modul from "../models/Modul.js";


// Ambil semua topik
export const getTopik = async (req, res) => {
  try {
    const topikList = await Topik.find().populate("modulId"); // bisa populate modul
    res.status(200).json(topikList);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Ambil semua topik berdasarkan modulId
export const getTopikByModul = async (req, res) => {
  try {
    const { modulId } = req.params;
    const topikList = await Topik.find({ modulId }).populate("modulId");

    // Jika kosong, tetap kirim array kosong (bukan 404)
    if (!topikList || topikList.length === 0) {
      return res.status(200).json([]);
    }

    res.status(200).json(topikList);
  } catch (err) {
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

// Ambil satu topik berdasarkan slug modul dan slug topik
export const getTopikBySlugs = async (req, res) => {
  try {
    const { modulSlug, topikSlug } = req.params;

    // 1. Cari modul berdasarkan slug-nya untuk mendapatkan ID modul
    const modul = await Modul.findOne({ slug: modulSlug });
    if (!modul) {
      return res.status(404).json({ message: "Modul tidak ditemukan." });
    }

    // 2. Cari topik berdasarkan slug-nya DAN ID modul yang sudah ditemukan
    const topik = await Topik.findOne({ slug: topikSlug, modulId: modul._id });
    if (!topik) {
      return res.status(404).json({ message: "Topik tidak ditemukan pada modul ini." });
    }

    res.status(200).json(topik);
  } catch (err) {
    console.error("Error saat mengambil topik by slugs:", err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

export const createTopik = async (req, res) => {
  try {
    const { title, modulId } = req.body;

    if (!title || !modulId) {
      return res.status(400).json({ message: "Data tidak lengkap" });
    }

    // Buat slug otomatis dari judul
    let slug = slugify(title, { lower: true, strict: true });

    // Cek apakah slug sudah digunakan
    const existingTopik = await Topik.findOne({ slug });
    if (existingTopik) {
      // Jika sudah ada, tambahkan angka unik di akhir
      slug = `${slug}-${Date.now()}`;
    }

    const topik = new Topik({ title, slug, modulId });
    await topik.save();

    res.status(201).json(topik);
  } catch (err) {
    console.error("Error saat membuat topik:", err);
    res.status(500).json({ message: "Gagal membuat topik: " + err.message });
  }
};

// Hapus topik berdasarkan ID
export const deleteTopik = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedTopik = await Topik.findByIdAndDelete(id);
    if (!deletedTopik) {
      return res.status(404).json({ message: "Topik tidak ditemukan" });
    }
    res.status(200).json({ message: "Topik berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
