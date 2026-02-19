import Modul from "../models/Modul.js";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import Result from "../models/Result.js";
import Topik from "../models/Topik.js";
import Materi from "../models/Materi.js";
import Question from "../models/Question.js";
import User from "../models/User.js";
import { hasCompletedModulePostTest, isModuleLockedForUser } from "./resultController.js";

export const getModules = async (req, res) => {
  try {
    const { search } = req.query;

    let query = {};
    if (search) {
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
    const user = await User.findById(req.user._id).select('learningLevel topicCompletions').lean();
    if (!user) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    const modules = await Modul.find({}).sort({ order: 1 }).lean();
    const allTopics = await Topik.find({}).select('_id title slug modulId').sort({ order: 1 }).lean();
    const allQuestions = await Question.find({ testType: 'post-test-topik' }).select('topikId durationPerQuestion').lean();

    // Agregasi untuk menghitung jumlah pengguna unik per modul
    const userCountsByModule = await Result.aggregate([
      { $match: { testType: 'post-test-topik', modulId: { $exists: true } } },
      { $group: { _id: { modulId: "$modulId", userId: "$userId" } } },
      { $group: { _id: "$_id.modulId", userCount: { $sum: 1 } } }
    ]);
    const userCountMap = new Map(userCountsByModule.map(item => [item._id.toString(), item.userCount]));

    const modulesWithDetails = modules.map(modul => {
      const isModulLocked = isModuleLockedForUser(modul.category, user.learningLevel);
      const topicsForThisModule = allTopics.filter(t => t.modulId.equals(modul._id));
      const topicIdsForThisModule = topicsForThisModule.map(t => t._id);

      // Hitung total durasi dari semua soal post-test topik di modul ini
      const totalDurationInSeconds = allQuestions
        .filter(q => topicIdsForThisModule.some(tid => tid.equals(q.topikId)))
        .reduce((sum, q) => sum + (q.durationPerQuestion || 0), 0);

      const totalDuration = Math.ceil(totalDurationInSeconds / 60); // Konversi ke menit 
      const userCount = userCountMap.get(modul._id.toString()) || 0;

      let previousTopicCompleted = true; 
      const topicsWithStatus = topicsForThisModule.map(topik => {
        const isCompleted = user.topicCompletions?.some(id => id.equals(topik._id)) || false;
        const isTopicLocked = isModulLocked || !previousTopicCompleted;

        previousTopicCompleted = isCompleted; 
        return {
          _id: topik._id,
          title: topik.title,
          slug: topik.slug,
          isLocked: isTopicLocked,
          isCompleted: isCompleted,
        };
      });

      if (!isModulLocked && topicsWithStatus.length > 0) {
        topicsWithStatus[0].isLocked = false;
      }

      const completedTopicsCount = topicsWithStatus.filter(t => t.isCompleted).length;
      const totalTopics = topicsWithStatus.length;
      const progress = totalTopics > 0 ? Math.round((completedTopicsCount / totalTopics) * 100) : 0;

      let status;
      if (isModulLocked) {
        status = 'Terkunci';
      } else if (progress === 100) {
        status = 'Selesai';
      } else if (progress > 0) {
        status = 'Berjalan';
      } else {
        status = 'Belum Mulai';
      }

      return {
        ...modul,
        progress,
        completedTopics: completedTopicsCount,
        totalTopics,
        userCount, 
        totalDuration, 
        topics: topicsWithStatus, 
        isLocked: isModulLocked, 
        status, 
      };
    });

    res.status(200).json(modulesWithDetails);
  } catch (err) {
    console.error("Error in getModulesWithProgress:", err);
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
      { $match: { modulId: new mongoose.Types.ObjectId(modul._id) } },
      { $sort: { order: 1 } },
      {
        $lookup: {
          from: "materis",
          localField: "_id",
          foreignField: "topikId",
          as: "materiArr"
        }
      },
   
      {
        $lookup: {
          from: "questions",
          let: { topik_id: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$topikId", "$$topik_id"] }, { $eq: ["$testType", "post-test-topik"] }] } } },
            { $project: { answer: 0 } } 
          ],
          as: "questions"
        }
      },
     
      {
        $lookup: {
          from: "results",
          let: { topik_id: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$topikId", "$$topik_id"] },
                    { $eq: ["$userId", new mongoose.Types.ObjectId(userId)] }
                  ]
                }
              }
            }, { $limit: 1 }
          ], as: "attempts"
        }
      },
    
      {
        $addFields: {
          materi: {
            $ifNull: [
              {
                $reduce: {
                  input: "$materiArr",
                  initialValue: { _id: { $arrayElemAt: ["$materiArr._id", 0] }, subMateris: [], youtube: { $arrayElemAt: ["$materiArr.youtube", 0] } },
                  in: {
                    _id: "$$value._id",
                    subMateris: { $concatArrays: ["$$value.subMateris", "$$this.subMateris"] },
                    youtube: { $ifNull: ["$$this.youtube", "$$value.youtube"] }
                  }
                }
              },
              null
            ]
          },
         
          isCompleted: { $in: ["$_id", user.topicCompletions || []] }, 
          hasAttempted: { $gt: [{ $size: "$attempts" }, 0] }
        }
      },
     
      { $project: { materiArr: 0, completion: 0, attempts: 0 } }
    ]);

    // 5. Hitung progres keseluruhan modul dari hasil agregasi
    const totalTopics = topicsDetails.length;
    const completedCount = topicsDetails.filter(t => t.isCompleted).length;
    const progress = totalTopics > 0 ? Math.round((completedCount / totalTopics) * 100) : 0;

    // 6. Cek apakah user sudah menyelesaikan post-test akhir modul
    const hasCompletedPostTest = await hasCompletedModulePostTest(userId, modul._id);

    res.status(200).json({
      ...modul.toObject(), 
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

/**
 * @desc    Get module by ID or slug
 * @route   GET /api/modul/:idOrSlug
 * @access  Private
 */
export const getModuleById = async (req, res) => {
  try {
   
    const idOrSlug = req.params.slug || req.params.idOrSlug;

    const isObjectId = mongoose.Types.ObjectId.isValid(idOrSlug);

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
    const { title, overview, category, slug } = req.body; 

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID Modul tidak valid" });
    }

    const modul = await Modul.findById(id);
    if (!modul) {
      return res.status(404).json({ message: "Modul tidak ditemukan" });
    }

    modul.title = title || modul.title;
    modul.overview = overview || modul.overview;
    modul.category = category || modul.category;
    modul.slug = slug || modul.slug;

    if (req.file) {
      if (modul.icon) {
        const __dirname = path.dirname(new URL(import.meta.url).pathname.substring(1));
        const oldPath = path.join(__dirname, "..", "..", "public", "uploads", modul.icon);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
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

    if (modul.icon) {
      const __dirname = path.dirname(new URL(import.meta.url).pathname.substring(1));
      const iconPath = path.join(__dirname, "..", "..", "public", "uploads", modul.icon);
      if (fs.existsSync(iconPath)) {
        fs.unlinkSync(iconPath);
      }
    }

    await Topik.deleteMany({ modulId: id });
    await Materi.deleteMany({ modulId: id });
    await Question.deleteMany({ modulId: id });
    await Result.deleteMany({ modulId: id });

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
    const { orderedIds } = req.body; 

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

/**
 * @desc    Get feature weights for a specific module
 * @route   GET /api/modul/:id/feature-weights
 * @access  Private/Admin
 */
export const getModuleFeatureWeights = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID Modul tidak valid" });
    }

    const modul = await Modul.findById(id).select("featureWeights");
    if (!modul) {
      return res.status(404).json({ message: "Modul tidak ditemukan" });
    }

    res.status(200).json(modul.featureWeights || []);
  } catch (error) {
    console.error("Error getting module feature weights:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

/**
 * @desc    Update feature weights for a specific module
 * @route   PUT /api/modul/:id/feature-weights
 * @access  Private/Admin
 */
export const updateModuleFeatureWeights = async (req, res) => {
  try {
    const { id } = req.params;
    const { weights } = req.body; 

    if (!Array.isArray(weights)) {
      return res.status(400).json({ message: "Data bobot tidak valid, harus berupa array." });
    }

    const modul = await Modul.findById(id);

    if (modul) {
      const validatedWeights = weights.map(fw => ({
        featureId: fw.featureId,
        weight: Number(fw.weight) || 0
      }));

      modul.featureWeights = validatedWeights;

      const updatedModul = await modul.save();
      res.status(200).json(updatedModul.featureWeights);
    } else {
      res.status(404).json({ message: "Modul tidak ditemukan" });
    }
  } catch (error) {
    console.error("Error updating module feature weights:", error);
    res.status(500).json({ message: "Terjadi kesalahan server." });
  }
};
