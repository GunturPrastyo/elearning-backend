import Modul from "../models/Modul.js";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import Result from "../models/Result.js";
import Topik from "../models/Topik.js";
import Materi from "../models/Materi.js";
import Question from "../models/Question.js";
import User from "../models/User.js";
import { hasCompletedModulePostTest } from "./resultController.js";

export const getModules = async (req, res) => {
  try {
    const { search } = req.query;

    let query = {};
    if (search) {
      // Mencari title yang mengandung string 'search' (case-insensitive)
      query.title = { $regex: search, $options: "i" };
    }
    const modules = await Modul.find(query).sort({ order: 1 });
    res.status(200).json(modules);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * @desc    Get all modules with user-specific progress
 * @route   GET /api/modul/progress
 * @access  Private
 */
export const getModulesWithProgress = async (req, res) => {
  try {
    const userId = req.user?._id;
    const objectUserId = userId ? new mongoose.Types.ObjectId(userId) : null;

    const modulesWithProgress = await Modul.aggregate([
      // 0. Urutkan modul berdasarkan field 'order'
      {
        $sort: { order: 1 }
      },
      // 1. Ambil semua topik yang berelasi
      {
        $lookup: {
          from: "topiks",
          localField: "_id",
          foreignField: "modulId",
          as: "topics"
        }
      },
      // 2. Ambil hasil tes post-test-topik user yang lulus
      {
        $lookup: {
          from: "results",
          let: { modul_id: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$modulId", "$$modul_id"] },
                    { $eq: ["$userId", objectUserId] },
                    { $eq: ["$testType", "post-test-topik"] },
                    { $gte: ["$score", 80] }
                  ]
                }
              }
            }
          ],
          as: "userCompletions"
        }
      },
      // 3. Bentuk ulang data dan hitung progres
      {
        $project: {
          title: 1,
          slug: 1,
          overview: 1,
          category: 1,
          icon: 1,
          order: 1,
          totalTopics: { $size: "$topics" },
          completedTopics: { $size: "$userCompletions" },
          firstTopicTitle: { $ifNull: [{ $arrayElemAt: ["$topics.title", 0] }, null] },
          progress: {
            $cond: {
              if: { $gt: [{ $size: "$topics" }, 0] },
              then: { $round: [{ $multiply: [{ $divide: [{ $size: "$userCompletions" }, { $size: "$topics" }] }, 100] }] },
              else: 0
            }
          }
        }
      }
    ]);
    res.status(200).json(modulesWithProgress);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

/**
 * @desc    Get module, topics, materials, and user progress for user view
 * @route   GET /api/modul/user-view/:slug
 * @access  Private
 */
export const getModuleDetailsForUser = async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user._id;

    // 1. Ambil modul berdasarkan slug
    const modul = await Modul.findOne({ slug });
    if (!modul) {
      return res.status(404).json({ message: "Modul tidak ditemukan" });
    }

    // Ambil data user untuk mengecek topik yang sudah selesai
    const user = await User.findById(userId).select('topicCompletions').lean();
    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    // 2. Ambil semua topik, materi, soal, dan status penyelesaian user dalam satu query
    const topicsDetails = await Topik.aggregate([
      // Match topik untuk modul yang spesifik
      { $match: { modulId: new mongoose.Types.ObjectId(modul._id) } },
      // Urutkan topik berdasarkan field 'order'
      { $sort: { order: 1 } },
      // Ambil materi terkait
      {
        $lookup: {
          from: "materis",
          localField: "_id",
          foreignField: "topikId",
          as: "materiArr"
        }
      },
      // Ambil soal post-test terkait
      {
        $lookup: {
          from: "questions",
          let: { topik_id: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$topikId", "$$topik_id"] }, { $eq: ["$testType", "post-test-topik"] }] } } },
            { $project: { answer: 0 } } // Hapus jawaban
          ],
          as: "questions"
        }
      },
      // Bentuk ulang output
      {
        $addFields: {
          materi: { $ifNull: [{ $arrayElemAt: ["$materiArr", 0] }, null] },
          isCompleted: { $in: ["$_id", user.topicCompletions || []] }
        }
      },
      // Hapus field yang tidak perlu
      { $project: { materiArr: 0, completion: 0 } }
    ]);

    // 5. Hitung progres keseluruhan modul dari hasil agregasi
    const totalTopics = topicsDetails.length;
    const completedCount = topicsDetails.filter(t => t.isCompleted).length;
    const progress = totalTopics > 0 ? Math.round((completedCount / totalTopics) * 100) : 0;

    // 6. Cek apakah user sudah menyelesaikan post-test akhir modul
    const hasCompletedPostTest = await hasCompletedModulePostTest(userId, modul._id);

    res.status(200).json({
      ...modul.toObject(), // Gunakan toObject() untuk mengubah dokumen Mongoose menjadi objek biasa
      progress,
      completedTopics: completedCount,
      totalTopics,
      topics: topicsDetails,
      hasCompletedModulPostTest: hasCompletedPostTest,
    });

  } catch (err) {
    console.error("Error getting module details for user:", err);
    res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
};

export const getModuleById = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    // Cek apakah parameter adalah ObjectId yang valid
    const isObjectId = mongoose.Types.ObjectId.isValid(idOrSlug);

    // Tentukan query berdasarkan tipe parameter
    const query = isObjectId ? { _id: idOrSlug } : { slug: idOrSlug };
    const modul = await Modul.findOne(query);

    if (!modul) return res.status(404).json({ message: "Modul dengan slug/ID tersebut tidak ditemukan" });
    res.status(200).json(modul);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createModule = async (req, res) => {
  try {
    const { title, category, overview, slug } = req.body;
    const icon = req.file ? req.file.filename : null;

    const modul = new Modul({ title, category, overview, slug, icon });
    await modul.save();

    res.status(201).json(modul);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/**
 * @desc    Update modul by its ID
 * @route   PUT /api/modul/:id
 * @access  Private/Admin
 */
export const updateModul = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, overview, category, slug } = req.body; // Data teks dari FormData

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID Modul tidak valid" });
    }

    const modul = await Modul.findById(id);
    if (!modul) {
      return res.status(404).json({ message: "Modul tidak ditemukan" });
    }

    // Update data teks
    modul.title = title || modul.title;
    modul.overview = overview || modul.overview;
    modul.category = category || modul.category;
    modul.slug = slug || modul.slug;

    // Cek apakah ada file icon baru yang di-upload
    if (req.file) {
      // Jika ada icon lama, hapus dari storage
      if (modul.icon) {
        // Dapatkan path absolut dari direktori saat ini
        const __dirname = path.dirname(new URL(import.meta.url).pathname.substring(1));
        const oldPath = path.join(__dirname, "..", "..", "public", "uploads", modul.icon);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      // Update dengan nama file icon yang baru
      modul.icon = req.file.filename;
    }

    const updatedModul = await modul.save();

    res.status(200).json({
      message: "Modul berhasil diperbarui",
      data: updatedModul,
    });
  } catch (error) {
    console.error("Error updating modul:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

/**
 * @desc    Delete a module and its associated icon, topics, and materials
 * @route   DELETE /api/modul/:id
 * @access  Private/Admin
 */
export const deleteModul = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID Modul tidak valid" });
    }

    const modul = await Modul.findById(id);

    if (!modul) {
      return res.status(404).json({ message: "Modul tidak ditemukan" });
    }

    // Hapus file ikon dari storage jika ada
    if (modul.icon) {
      const __dirname = path.dirname(new URL(import.meta.url).pathname.substring(1));
      const iconPath = path.join(__dirname, "..", "..", "public", "uploads", modul.icon);
      if (fs.existsSync(iconPath)) {
        fs.unlinkSync(iconPath);
      }
    }

    // Hapus semua data yang terkait dengan modul ini (cascading delete)
    await Topik.deleteMany({ modulId: id });
    await Materi.deleteMany({ modulId: id });
    await Question.deleteMany({ modulId: id });
    await Result.deleteMany({ modulId: id });

    // Hapus modul dari database
    await Modul.findByIdAndDelete(id);

    res.status(200).json({ message: "Modul dan semua data terkait berhasil dihapus" });
  } catch (error) {
    console.error("Error deleting modul:", error);
    res.status(500).json({ message: "Terjadi kesalahan server saat menghapus modul" });
  }
};

/**
 * @desc    Update the order of modules
 * @route   PUT /api/modul/update-order
 * @access  Private/Admin
 */
export const updateModulOrder = async (req, res) => {
  try {
    const { orderedIds } = req.body; // Mengharapkan array berisi ID modul

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ message: "Data urutan tidak valid." });
    }

    // Membuat array operasi update untuk bulkWrite
    const bulkOps = orderedIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order: index } },
      },
    }));

    // Menjalankan operasi bulk write untuk efisiensi
    await Modul.bulkWrite(bulkOps);

    res.status(200).json({ message: "Urutan modul berhasil diperbarui." });
  } catch (error) {
    console.error("Error updating modul order:", error);
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
};
