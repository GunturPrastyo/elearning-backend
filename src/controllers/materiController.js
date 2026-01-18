import Materi from "../models/Materi.js";
import Modul from "../models/Modul.js";
import Topik from "../models/Topik.js";
import DOMPurify from "../utils/sanitize.js";

// Helper function to convert YouTube watch URL to embed URL
const getEmbedUrl = (url) => {
  if (!url || typeof url !== 'string') return null;

  // Check if it's already an embed URL
  if (url.includes("youtube.com/embed/")) {
    return url;
  }

  // Regex to extract video ID from various YouTube URLs
  const regExp = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|)([\w-]{11})(?:\S+)?/;
  const match = url.match(regExp);

  return (match && match[1]) ? `https://www.youtube.com/embed/${match[1]}` : null;
};

const sanitizeSubMateri = (subMateris) => {
  if (!Array.isArray(subMateris)) return [];
  return subMateris.map(sub => ({
    ...sub,
    content: DOMPurify.sanitize(sub.content || '', {
    // Izinkan tag tambahan untuk iframe (YouTube) dan blok kode (pre, code)
    ADD_TAGS: ["iframe", "pre", "code"],
    // Izinkan atribut yang diperlukan untuk embed video dan styling kode
    ADD_ATTR: ["style", "allow", "allowfullscreen", "frameborder", "scrolling", "src", "title", "class", "id"],
    })
  }));
};

/**
 * @desc    Get materi by modul and topik slug
 * @route   GET /api/materi/modul/:modulSlug/topik/:topikSlug
 * @access  Private/Admin
 */
export const getMateriBySlugs = async (req, res) => {
  try {
    const { modulSlug, topikSlug } = req.params;

    const modul = await Modul.findOne({ slug: modulSlug });
    if (!modul) {
      return res.status(404).json({ message: "Modul tidak ditemukan" });
    }

    const topik = await Topik.findOne({ slug: topikSlug, modulId: modul._id });
    if (!topik) {
      return res.status(404).json({ message: "Topik tidak ditemukan" });
    }

    const materi = await Materi.findOne({
      modulId: modul._id,
      topikId: topik._id,
    });

    if (!materi) {
      // Ini bukan error, hanya saja materinya belum ada.
      // Kirim 404 tapi sertakan ID yang dibutuhkan frontend untuk membuat materi baru.
      return res.status(404).json({
        message: "Materi belum dibuat",
        topikId: topik._id, // Pastikan topikId selalu ada di response
      });
    }

    res.status(200).json(materi);
  } catch (error) {
    console.error("Error getting materi by slugs:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

/**
 * @desc    Create or Update materi for a specific topic (Upsert)
 * @route   POST /api/materi/save
 * @access  Private/Admin
 */
export const saveMateri = async (req, res) => {
  try {
    const { topikId, subMateris, youtube } = req.body;

    // Validasi sederhana
    if (!topikId || !subMateris) {
      return res.status(400).json({ message: "ID Topik dan konten materi diperlukan." });
    }

    // Cari topik untuk mendapatkan modulId dan memastikan topik ada
    const topik = await Topik.findById(topikId);
    if (!topik) {
      return res.status(404).json({ message: "Topik tidak ditemukan." });
    }

    // Validasi dan sanitasi URL YouTube
    const finalYoutubeUrl = youtube ? getEmbedUrl(youtube) : null; // Helper getEmbedUrl hanya untuk validasi
    if (youtube && !finalYoutubeUrl) {
      // Jika URL diberikan tapi tidak valid, kirim error.
      return res.status(400).json({ message: "URL YouTube tidak valid." });
    }

    // Sanitasi konten sebelum disimpan
    const cleanSubMateris = sanitizeSubMateri(subMateris);

    // Operasi "Upsert": Update jika ada, atau buat baru jika tidak ada.
    const materi = await Materi.findOneAndUpdate(
      { topikId: topik._id },
      {
        subMateris: cleanSubMateris, // Data yang akan di-update atau dibuat
        youtube: youtube || null, // Simpan URL asli dari input pengguna
        modulId: topik.modulId, // Pastikan modulId juga tersimpan/diperbarui
      },
      {
        new: true, // Kembalikan dokumen yang sudah diupdate/dibuat
        upsert: true, // Buat dokumen baru jika tidak ada yang cocok
        runValidators: true,
      }
    );

    res.status(200).json({
      message: "Materi berhasil disimpan",
      data: materi, // Pastikan data yang dikembalikan adalah dokumen yang baru
    });
  } catch (error) {
    console.error("Error saat menyimpan materi:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};
