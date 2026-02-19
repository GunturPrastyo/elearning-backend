import Materi from "../models/Materi.js";
import Modul from "../models/Modul.js";
import Topik from "../models/Topik.js";
import DOMPurify from "../utils/sanitize.js";

// Helper function to convert YouTube watch URL to embed URL
const getEmbedUrl = (url) => {
  if (!url || typeof url !== 'string') return null;

  if (url.includes("youtube.com/embed/")) {
    return url;
  }

  const regExp = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|)([\w-]{11})(?:\S+)?/;
  const match = url.match(regExp);

  return (match && match[1]) ? `https://www.youtube.com/embed/${match[1]}` : null;
};

const sanitizeSubMateri = (subMateris) => {
  if (!Array.isArray(subMateris)) return [];
  return subMateris.map(sub => ({
    ...sub,
    content: DOMPurify.sanitize(sub.content || '', {
    ADD_TAGS: ["iframe", "pre", "code"],
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
      return res.status(404).json({
        message: "Materi belum dibuat",
        topikId: topik._id, 
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
      return res.status(400).json({ message: "URL YouTube tidak valid." });
    }

    // Sanitasi konten sebelum disimpan
    const cleanSubMateris = sanitizeSubMateri(subMateris);

    const materi = await Materi.findOneAndUpdate(
      { topikId: topik._id },
      {
        subMateris: cleanSubMateris, 
        youtube: youtube || null, 
        modulId: topik.modulId, 
      },
      {
        new: true, 
        upsert: true, 
        runValidators: true,
      }
    );

    res.status(200).json({
      message: "Materi berhasil disimpan",
      data: materi, 
    });
  } catch (error) {
    console.error("Error saat menyimpan materi:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};
