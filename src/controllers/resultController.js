import Result from "../models/Result.js";
import User from "../models/User.js";
import Question from "../models/Question.js";
import mongoose from "mongoose";
import Modul from "../models/Modul.js";
import Topik from "../models/Topik.js";

/**
 * @desc    Save a test result
 * @route   POST /api/results
 * @access  Private (user)
 */
export const createResult = async (req, res) => {
  try {
    const { testType, score, correct, total, timeTaken, modulId } = req.body;
    const userId = req.user._id;

    if (!testType || score == null || correct == null || total == null || timeTaken == null) {
      return res.status(400).json({ message: "Data hasil tes tidak lengkap." });
    }

    const newResult = new Result({
      userId,
      testType,
      score,
      correct,
      total,
      timeTaken,
      ...(modulId && { modulId }), // Hanya tambahkan modulId jika ada
    });

    await newResult.save();

    res.status(201).json({
      message: "Hasil tes berhasil disimpan.",
      data: newResult,
    });
  } catch (error) {
    console.error("Gagal menyimpan hasil tes:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Submit answers for a test (pre-test, post-test topik, post-test modul)
 * @route   POST /api/results/submit-test
 * @access  Private
 */
export const submitTest = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType, modulId, topikId, answers, timeTaken } = req.body;

    if (!testType || !answers || Object.keys(answers).length === 0 || timeTaken === undefined) {
      return res.status(400).json({ message: "Data jawaban tidak lengkap." });
    }

    const questionIds = Object.keys(answers);
    const questions = await Question.find({
      _id: { $in: questionIds },
      testType,
      ...(modulId && { modulId: new mongoose.Types.ObjectId(modulId) }),
      ...(topikId && { topikId: new mongoose.Types.ObjectId(topikId) }),
    }).select("+answer");

    if (questions.length !== questionIds.length) {
      return res.status(404).json({ message: "Beberapa soal tidak ditemukan." });
    }

    let correctAnswers = 0;
    questions.forEach((q) => {
      if (answers[q._id.toString()] === q.answer) correctAnswers++;
    });

    const totalQuestions = questions.length;
    // Bulatkan skor menjadi 2 angka desimal
    const score = totalQuestions > 0 ? parseFloat(((correctAnswers / totalQuestions) * 100).toFixed(2)) : 0;

    let result;
    let finalScore = score; // Inisialisasi skor akhir dengan skor saat ini

    // Logika untuk mengambil nilai terbaik pada post-test topik
    if (testType === "post-test-topik" && topikId) {
      // 1. Cari hasil yang sudah ada
      const existingResult = await Result.findOne({ userId, topikId, testType: "post-test-topik" });

      // 2. Bandingkan skor. Hanya update jika tidak ada hasil atau skor baru lebih tinggi.
      if (!existingResult || score > existingResult.score) {
        // Jika skor baru lebih baik, perbarui/buat data baru
        result = await Result.findOneAndUpdate(
          { userId, topikId, testType: "post-test-topik" },
          {
            userId, testType, score,
            correct: correctAnswers,
            total: totalQuestions,
            answers: Object.entries(answers).map(([questionId, selectedOption]) => ({ questionId, selectedOption })),
            timeTaken,
            modulId,
            topikId,
            timestamp: new Date() // Perbarui timestamp ke waktu pengerjaan terbaru
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        finalScore = score;
      } else {
        // Jika skor baru tidak lebih baik, jangan update DB.
        // Kembalikan saja hasil lama yang lebih bagus.
        result = existingResult;
        finalScore = existingResult.score;
      }
    } else {
      // Untuk tipe tes lain (pre-test, post-test modul), selalu buat hasil baru.
      const newResult = new Result({
        userId, testType, score,
        correct: correctAnswers,
        total: totalQuestions,
        answers: Object.entries(answers).map(([questionId, selectedOption]) => ({ questionId, selectedOption })),
        timeTaken,
        ...(modulId && { modulId }),
        ...(topikId && { topikId }),
      });
      result = await newResult.save();
      finalScore = score;
    }

    // Jika post-test topik lulus, lakukan beberapa update:
    if (testType === "post-test-topik" && topikId && finalScore >= 80) {
      // 1. Tambahkan ID topik ke progres user
      await User.findByIdAndUpdate(userId, {
        $addToSet: { topicCompletions: new mongoose.Types.ObjectId(topikId) },
      });

      // 2. (Opsional tapi direkomendasikan) Tandai topik itu sendiri sebagai selesai jika ada fieldnya
      // Asumsi model Topik memiliki field `isCompletedByUser` atau sejenisnya.
      // Jika tidak, logika ini bisa diskip, tapi akan lebih baik jika ada.
      // Untuk contoh ini, kita asumsikan tidak ada dan frontend akan handle dari data user.
    }

    // Setelah submit, hapus progress tes yang tersimpan untuk topik ini
    await Result.deleteOne({
      userId, topikId, testType: "post-test-topik-progress"
    });

    res.status(201).json({
      message: "Jawaban berhasil disubmit.",
      data: result,
    });
  } catch (error) {
    console.error("Gagal submit tes:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Log time spent studying a topic
 * @route   POST /api/results/log-study-time
 * @access  Private
 */
export const logStudyTime = async (req, res) => {
  try {
    const userId = req.user._id;
    const { topikId, durationInSeconds } = req.body;

    if (!topikId || durationInSeconds === undefined || durationInSeconds <= 0) {
      return res.status(400).json({ message: "Data waktu belajar tidak lengkap atau tidak valid." });
    }

    const newResult = new Result({
      userId,
      topikId,
      testType: 'study-session',
      timeTaken: durationInSeconds,
      // Atur field lain yang required ke nilai default jika perlu
      score: 0,
      correct: 0,
      total: 0,
    });

    await newResult.save();
    res.status(201).json({ success: true, message: "Waktu belajar berhasil dicatat." });
  } catch (error) {
    console.error("Gagal mencatat waktu belajar:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};
/**
 * @desc    Save or update user's test progress
 * @route   POST /api/results/progress
 * @access  Private
 */
export const saveProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType, modulId, topikId, answers, currentIndex } = req.body;

    if (!testType || !topikId) {
      return res.status(400).json({ message: "Data progress tidak lengkap." });
    }

    // Use findOneAndUpdate with upsert to either create a new progress document or update an existing one.
    const progress = await Result.findOneAndUpdate( // The testType here should be specific to progress tracking
      {
        userId,
        modulId: new mongoose.Types.ObjectId(modulId),
        topikId: new mongoose.Types.ObjectId(topikId),
        testType: "post-test-topik-progress", // Use a distinct testType for progress
      },
      {
        $set: {
          answers: Object.entries(answers || {}).map(([questionId, selectedOption]) => ({
            questionId,
            selectedOption,
          })),
          currentIndex: currentIndex || 0,
        },
      },
      {
        new: true, // Return the modified document
        upsert: true, // Create a new document if one doesn't exist
        setDefaultsOnInsert: true,
      }
    );

    res.status(200).json({ message: "Progress berhasil disimpan.", data: progress });
  } catch (error) {
    console.error("Gagal menyimpan progress:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get user's test progress
 * @route   GET /api/results/progress
 * @access  Private
 */
export const getProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { modulId, topikId, testType } = req.query;

    if (!testType || !topikId) {
      return res.status(400).json({ message: "Parameter testType dan topikId diperlukan." });
    }

    // Pastikan testType di query sesuai dengan yang disimpan di DB
    const progress = await Result.findOne({
      userId,
      modulId: new mongoose.Types.ObjectId(modulId),
      topikId: new mongoose.Types.ObjectId(topikId),
      testType: testType, // FIX: Gunakan testType langsung dari query, jangan tambahkan "-progress" lagi
    });

    if (!progress) {
      // Ini bukan error, hanya berarti tidak ada progress. Kirim 404 agar frontend tahu.
      return res.status(404).json({ message: "Progress tidak ditemukan." });
    }

    res.status(200).json(progress);
  } catch (error) {
    console.error("Gagal mengambil progress:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Delete user's test progress
 * @route   DELETE /api/results/progress
 * @access  Private
 */
export const deleteProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    // Ambil parameter dari query string, bukan dari body
    const { modulId, topikId, testType } = req.query;

    if (!testType || !topikId || !modulId) {
      return res.status(400).json({ message: "Parameter modulId, topikId, dan testType diperlukan untuk menghapus progress." });
    }

    await Result.deleteOne({ userId, modulId, topikId, testType });
    res.status(200).json({ message: "Progress berhasil dihapus." });
  } catch (error) {
    console.error("Gagal menghapus progress:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get latest result by topic for current user within a specific module
 * @route   GET /api/results/latest-by-topic
 * @access  Private
 */
export const getLatestResultByTopic = async (req, res) => {
  try {
    const userId = req.user._id;
    const { modulId, topikId } = req.query;

    if (!modulId || !mongoose.Types.ObjectId.isValid(modulId)) {
      return res.status(400).json({ message: "Modul ID tidak valid." });
    }
    if (!topikId || !mongoose.Types.ObjectId.isValid(topikId)) {
      return res.status(400).json({ message: "Topik ID tidak valid." });
    }

    const latestResult = await Result.findOne({
      userId,
      modulId: new mongoose.Types.ObjectId(modulId),
      topikId: new mongoose.Types.ObjectId(topikId),
      testType: "post-test-topik",
    })
      .sort({ createdAt: -1 })
      .populate("topikId", "nama deskripsi")
      .populate("modulId", "title");

    if (!latestResult) {
      return res.status(404).json({ message: "Belum ada hasil post-test untuk topik ini." });
    }

    res.status(200).json(latestResult);
  } catch (error) {
    console.error("Gagal mengambil hasil post-test topik:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get latest result by test type for the current user
 * @route   GET /api/results/latest-by-type/:testType
 * @access  Private
 */
export const getLatestResultByType = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType } = req.params;

    if (!testType) {
      return res.status(400).json({ message: "Parameter testType diperlukan." });
    }

    const latestResult = await Result.findOne({
      userId,
      testType,
    })
      .sort({ createdAt: -1 }) // Urutkan berdasarkan yang terbaru
      .lean(); // Gunakan .lean() untuk performa lebih baik jika tidak butuh method Mongoose

    // Tidak masalah jika null, frontend akan menanganinya
    res.status(200).json(latestResult);

  } catch (error) {
    console.error(`Gagal mengambil hasil tes tipe ${testType}:`, error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};


/**
 * @desc    Get all results
 * @route   GET /api/results
 * @access  Private (Admin)
 */
export const getResults = async (req, res) => {
  try {
    const results = await Result.find({}).populate("userId", "name email");
    res.status(200).json(results);
  } catch (error) {
    console.error("Gagal mengambil semua hasil tes:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get results by user ID
 * @route   GET /api/results/user/:userId
 * @access  Private
 */
export const getResultsByUser = async (req, res) => {
  try {
    const results = await Result.find({ userId: req.params.userId });
    res.status(200).json(results);
  } catch (error) {
    console.error("Gagal mengambil hasil tes pengguna:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get user's total study time
 * @route   GET /api/results/study-time
 * @access  Private
 */
export const getStudyTime = async (req, res) => {
  try {
    const userId = req.user._id;

    const results = await Result.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: "$userId",
          totalTimeInSeconds: { $sum: "$timeTaken" },
        },
      },
    ]);

    const totalTime = results.length > 0 ? results[0].totalTimeInSeconds : 0;
    res.status(200).json({ totalTimeInSeconds: totalTime });
  } catch (error) {
    console.error("Gagal mengambil waktu belajar:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get analytics data for the current user (average score, weakest topic)
 * @route   GET /api/results/analytics
 * @access  Private
 */
export const getAnalytics = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ message: "User tidak terautentikasi." });
    }

    // Calculate Average Score
    const averageScoreResult = await Result.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          testType: "post-test-topik",
        },
      },
      {
        $group: {
          _id: null,
          averageScore: { $avg: "$score" },
        },
      },
    ]);

    // Calculate Total Study Time
    const studyTimeResult = await Result.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, totalTime: { $sum: "$timeTaken" } } },
    ]);
    const totalStudyTime = studyTimeResult.length > 0 ? studyTimeResult[0].totalTime : 0;

    // Calculate Daily Streak
    const streakResults = await Result.find({ userId }).sort({ createdAt: "desc" });
    let dailyStreak = 0;
    if (streakResults.length > 0) {
      const uniqueDays = new Set();
      streakResults.forEach(result => {
        const date = new Date(result.createdAt);
        date.setHours(0, 0, 0, 0);
        uniqueDays.add(date.getTime());
      });
      const sortedDays = Array.from(uniqueDays).sort((a, b) => b - a);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (sortedDays[0] === today.getTime() || sortedDays[0] === yesterday.getTime()) {
        dailyStreak = 1;
        for (let i = 0; i < sortedDays.length - 1; i++) {
          const diffTime = sortedDays[i] - sortedDays[i + 1];
          if (Math.round(diffTime / (1000 * 60 * 60 * 24)) === 1) dailyStreak++;
          else break;
        }
      }
    }

    const averageScore = averageScoreResult.length > 0 ? parseFloat(averageScoreResult[0].averageScore.toFixed(2)) : 0;

    // Find Weakest Topic
    const weakestTopicResult = await Result.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          testType: "post-test-topik",
        },
      },
      {
        $sort: { createdAt: -1 }, // Sort by latest result first
      },
      {
        $group: {
          _id: "$topikId", // Group by topikId
          latestScore: { $first: "$score" }, // Get the score of the latest attempt
          latestTopikId: { $first: "$topikId" }, // Keep the topikId
        },
      },
      // Tambahkan filter: hanya anggap topik "lemah" jika skornya di bawah 80
      {
        $match: {
          latestScore: { $lt: 80 },
        },
      },
      {
        $sort: { latestScore: 1 }, // Sort by lowest score
      },
      {
        $limit: 1, // Get only the weakest one
      },
      {
        $lookup: {
          from: "topiks", // The collection name for Topik model
          localField: "latestTopikId",
          foreignField: "_id",
          as: "topikDetails",
        },
      },
      { $unwind: { path: "$topikDetails", preserveNullAndEmptyArrays: true } },
      // Pindahkan lookup modul ke sini agar bisa diakses di $project
      {
        $lookup: {
          from: "moduls",
          localField: "topikDetails.modulId",
          foreignField: "_id",
          as: "modulDetails",
        },
      },
      { $unwind: { path: "$modulDetails", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          topicId: "$topikDetails._id",
          title: "$topikDetails.title",
          topicSlug: "$topikDetails.slug",
          score: { $round: ["$latestScore", 2] },
          modulSlug: { $ifNull: ["$modulDetails.slug", ""] }, // Sekarang modulDetails sudah ada
        },
      },
    ]);

    const weakestTopic = weakestTopicResult.length > 0 ? weakestTopicResult[0] : null;

    res.status(200).json({
      averageScore,
      weakestTopic,
      totalStudyTime,
      dailyStreak,
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get aggregated analytics data for the admin dashboard
 * @route   GET /api/results/admin-analytics
 * @access  Private (Admin)
 */
export const getAdminAnalytics = async (req, res) => {
  try {
    // --- 1. Total Jam Belajar (Semua User) ---
    const totalStudyTimeResult = await Result.aggregate([
      { $match: { testType: 'study-session' } },
      { $group: { _id: null, totalSeconds: { $sum: "$timeTaken" } } },
    ]);
    const totalStudyHours = totalStudyTimeResult.length > 0 ? Math.floor(totalStudyTimeResult[0].totalSeconds / 3600) : 0;

    // --- 2. Rata-rata Progres Belajar (Semua User) ---
    const allUsersProgress = await User.aggregate([
      { $project: { totalCompletions: { $size: { $ifNull: ["$topicCompletions", []] } } } }
    ]);
    const totalTopics = await Topik.countDocuments();
    const averageProgress = totalTopics > 0 && allUsersProgress.length > 0
      ? Math.round(
        (allUsersProgress.reduce((sum, user) => sum + user.totalCompletions, 0) / (allUsersProgress.length * totalTopics)) * 100
      )
      : 0;

    // --- 3. Rata-rata Skor Keseluruhan (Semua User) ---
    const overallAverageScoreResult = await Result.aggregate([
      { $match: { testType: "post-test-topik" } },
      { $group: { _id: null, averageScore: { $avg: "$score" } } },
    ]);
    const overallAverageScore = overallAverageScoreResult.length > 0 ? parseFloat(overallAverageScoreResult[0].averageScore.toFixed(1)) : 0;

    // --- 4. Total Pengguna Terdaftar ---
    const totalUsers = await User.countDocuments();

    // --- 5. Topik Paling Sulit (Skor Rata-rata Terendah) ---
    const hardestTopicResult = await Result.aggregate([
      { $match: { testType: "post-test-topik" } },
      {
        $group: {
          _id: "$topikId",
          averageScore: { $avg: "$score" },
          attempts: { $sum: 1 }
        }
      },
      { $match: { attempts: { $gte: 3 } } }, // Hanya pertimbangkan topik yang sudah dikerjakan minimal 3 kali
      { $sort: { averageScore: 1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: "topiks",
          localField: "_id",
          foreignField: "_id",
          as: "topikDetails"
        }
      },
      { $unwind: { path: "$topikDetails", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "moduls",
          localField: "topikDetails.modulId",
          foreignField: "_id",
          as: "modulDetails"
        }
      },
      { $unwind: { path: "$modulDetails", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          topicId: "$topikDetails._id",
          topicTitle: "$topikDetails.title",
          topicSlug: "$topikDetails.slug",
          moduleSlug: "$modulDetails.slug",
          averageScore: { $round: ["$averageScore", 1] }
        }
      }
    ]);

    const weakestTopicOverall = hardestTopicResult.length > 0 ? hardestTopicResult[0] : null;

    res.status(200).json({
      totalStudyHours,
      averageProgress,
      overallAverageScore,
      totalUsers,
      weakestTopicOverall,
    });

  } catch (error) {
    console.error("Error fetching admin analytics:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get user's daily study streak
 * @route   GET /api/results/streak
 * @access  Private
 */
export const getDailyStreak = async (req, res) => {
  try {
    const userId = req.user._id;

    const results = await Result.find({ userId }).sort({ createdAt: "desc" });

    if (results.length === 0) {
      return res.status(200).json({ streak: 0 });
    }

    const uniqueDays = new Set();
    results.forEach(result => {
      const date = new Date(result.createdAt);
      date.setHours(0, 0, 0, 0); // Normalisasi ke awal hari
      uniqueDays.add(date.getTime());
    });

    const sortedDays = Array.from(uniqueDays).sort((a, b) => b - a);

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Cek apakah ada aktivitas hari ini atau kemarin
    if (sortedDays[0] === today.getTime() || sortedDays[0] === yesterday.getTime()) {
      streak = 1;
      for (let i = 0; i < sortedDays.length - 1; i++) {
        const diffTime = sortedDays[i] - sortedDays[i + 1];
        if (Math.round(diffTime / (1000 * 60 * 60 * 24)) === 1) streak++;
        else break; // Streak terputus
      }
    }

    res.status(200).json({ streak });
  } catch (error) {
    console.error("Error fetching daily streak:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

/**
 * @desc    Get user's weekly study activity
 * @route   GET /api/results/weekly-activity
 * @access  Private
 */
export const getWeeklyActivity = async (req, res) => {
  try {
    const userId = req.user._id;

    // Dapatkan tanggal 7 hari yang lalu
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Agregasi data waktu belajar
    const activity = await Result.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          totalSeconds: { $sum: "$timeTaken" },
        },
      },
      { $sort: { _id: 1 } }, // Urutkan berdasarkan tanggal
    ]);

    // Buat map untuk memudahkan pencarian
    const activityMap = new Map(activity.map(item => [item._id, item.totalSeconds]));

    // Siapkan array 7 hari terakhir
    const weeklySeconds = Array(7).fill(0).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateString = d.toISOString().split('T')[0];
      return activityMap.get(dateString) || 0; // Kirim dalam detik
    });

    res.status(200).json({ weeklySeconds });
  } catch (error) {
    console.error("Error fetching weekly activity:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get user's latest module post-test scores
 * @route   GET /api/results/module-scores
 * @access  Private
 */
export const getModuleScores = async (req, res) => {
  try {
    const userId = req.user._id;
    const objectUserId = new mongoose.Types.ObjectId(userId);

    const moduleScores = await Modul.aggregate([
      // 1. Mulai dari semua modul
      // 2. Lakukan lookup ke hasil tes user untuk modul ini
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
                    { $eq: ["$testType", "post-test-modul"] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } }, // Urutkan untuk mendapatkan yang terbaru
            { $limit: 1 }, // Ambil hanya satu hasil terbaru
          ],
          as: "userResult",
        },
      },
      // 3. Bentuk output yang diinginkan
      {
        $project: {
          _id: 0,
          moduleTitle: "$title",
          // Jika ada hasil, ambil skornya. Jika tidak, skornya 0.
          score: { $ifNull: [{ $arrayElemAt: ["$userResult.score", 0] }, 0] },
        },
      },
    ]);

    res.status(200).json(moduleScores);
  } catch (error) {
    console.error("Error fetching module scores:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get user vs class average comparison data for module post-tests
 * @route   GET /api/results/comparison-analytics
 * @access  Private
 */
export const getComparisonAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    const objectUserId = new mongoose.Types.ObjectId(userId);

    // --- 1. Get current user's latest module scores ---
    const allModulesData = await Modul.aggregate([
      // 1. Get all modules
      { $sort: { title: 1 } }, // Sort modules by title
      // 2. Get user's latest score for each module
      {
        $lookup: {
          from: "results",
          let: { modul_id: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [ { $eq: ["$modulId", "$$modul_id"] }, { $eq: ["$userId", objectUserId] }, { $eq: ["$testType", "post-test-modul"] } ] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
          ],
          as: "userResult"
        }
      },
      // 3. Get class average for each module
      {
        $lookup: {
          from: "results",
          let: { modul_id: "$_id" },
          pipeline: [
            // Match all post-tests for this module
            { $match: { $expr: { $and: [ { $eq: ["$modulId", "$$modul_id"] }, { $eq: ["$testType", "post-test-modul"] } ] } } },
            // Get the latest score for each user in this module
            { $sort: { createdAt: -1 } },
            { $group: { _id: "$userId", latestScore: { $first: "$score" } } },
            // Calculate the average of those latest scores
            { $group: { _id: null, averageScore: { $avg: "$latestScore" } } }
          ],
          as: "classResult"
        }
      },
      // 4. Project the final data
      {
        $project: {
          _id: 0,
          moduleTitle: "$title",
          userScore: { $ifNull: [{ $arrayElemAt: ["$userResult.score", 0] }, 0] },
          classAverage: { $ifNull: [{ $round: [{ $arrayElemAt: ["$classResult.averageScore", 0] }, 2] }, 0] }
        }
      }
    ]);

    const labels = allModulesData.map(d => d.moduleTitle);
    const userScores = allModulesData.map(d => d.userScore);
    const classAverages = allModulesData.map(d => d.classAverage);

    // --- 3. Calculate Rank and Score Difference ---
    const allUsersAverageScores = await Result.aggregate([
      { $match: { testType: "post-test-modul", modulId: { $exists: true } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { modulId: "$modulId", userId: "$userId" }, latestScore: { $first: "$score" } } },
      { $group: { _id: "$_id.userId", userAverage: { $avg: "$latestScore" } } },
      { $sort: { userAverage: -1 } }
    ]);

    const totalParticipants = allUsersAverageScores.length;
    const userRankIndex = allUsersAverageScores.findIndex(u => u._id.equals(userId));
    const rank = userRankIndex !== -1 ? userRankIndex + 1 : totalParticipants;

    const userOverallAverage = userScores.length > 0 
      ? userScores.reduce((sum, s) => sum + s, 0) / userScores.length 
      : 0;

    const classOverallAverage = classAverages.length > 0 
      ? classAverages.reduce((sum, s) => sum + s, 0) / classAverages.length 
      : 0;

    const scoreDifference = classOverallAverage > 0 
      ? parseFloat((((userOverallAverage - classOverallAverage) / classOverallAverage) * 100).toFixed(2))
      : 0;

    res.status(200).json({ 
      labels, 
      userScores, 
      classAverages,
      rank,
      totalParticipants,
      scoreDifference,
    });

  } catch (error) {
    console.error("Error fetching comparison analytics:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get learning recommendations for the user
 * @route   GET /api/results/recommendations
 * @access  Private
 */
export const getLearningRecommendations = async (req, res) => {
  try {
    const userId = req.user._id;

    // --- 1. Recommendation: Repeat Weakest Module ---
    const weakestModuleResult = await Result.aggregate([
      { $match: { userId, testType: "post-test-modul", modulId: { $exists: true } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$modulId", latestScore: { $first: "$score" } } },
      { $sort: { latestScore: 1 } },
      { $limit: 1 },
      { $lookup: { from: "moduls", localField: "_id", foreignField: "_id", as: "modulDetails" } },
      { $unwind: { path: "$modulDetails", preserveNullAndEmptyArrays: true } },      
      { $project: { _id: 1, title: "$modulDetails.title", slug: "$modulDetails.slug", icon: "$modulDetails.icon", score: { $round: ["$latestScore", 2] } } },
    ]);

    let repeatModule = null;
    if (weakestModuleResult.length > 0 && weakestModuleResult[0].score < 80) {
      const weakestModule = weakestModuleResult[0];

      // Cek apakah semua topik di modul ini sudah dikuasai
      const topicsInModule = await Topik.find({ modulId: weakestModule._id }).select('_id').lean();
      const topicIdsInModule = topicsInModule.map(t => t._id);

      const topicScores = await Result.aggregate([
        { $match: { userId, testType: "post-test-topik", topikId: { $in: topicIdsInModule } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$topikId", latestScore: { $first: "$score" } } },
      ]);

      const allTopicsMastered = topicIdsInModule.length > 0 && topicScores.length === topicIdsInModule.length && topicScores.every(s => s.latestScore >= 80);

      let weakestTopicInModuleResult = [];
      if (!allTopicsMastered) {
        // Jika belum semua topik dikuasai, cari yang terlemah
        weakestTopicInModuleResult = await Result.aggregate([
          { $match: { userId, modulId: new mongoose.Types.ObjectId(weakestModule._id), testType: "post-test-topik" } },
          { $sort: { createdAt: -1 } },
          { $group: { _id: "$topikId", latestScore: { $first: "$score" } } },
          { $sort: { latestScore: 1 } },
          { $limit: 1 },
          { $lookup: { from: "topiks", localField: "_id", foreignField: "_id", as: "topicDetails" } },
          { $unwind: { path: "$topicDetails", preserveNullAndEmptyArrays: true } },
          { $project: { _id: "$topicDetails._id", title: "$topicDetails.title", slug: "$topicDetails.slug" } },
        ]);
      }

      repeatModule = {
        moduleTitle: weakestModule.title,
        moduleIcon: weakestModule.icon,
        moduleScore: weakestModule.score,
        // Jika semua topik sudah dikuasai, set weakestTopic menjadi null
        weakestTopic: !allTopicsMastered && weakestTopicInModuleResult.length > 0 ? weakestTopicInModuleResult[0].title : null,
        moduleSlug: weakestModule.slug,
        weakestTopicDetails: !allTopicsMastered && weakestTopicInModuleResult.length > 0 ? weakestTopicInModuleResult[0] : null,
        allTopicsMastered: allTopicsMastered, // Kirim flag ini ke frontend
      };
    }

    // --- 2. Recommendation: Deepen Weakest Overall Topic ---
    const weakestOverallTopicResult = await Result.aggregate([
      { $match: { userId, testType: "post-test-topik", topikId: { $exists: true } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$topikId", latestScore: { $first: "$score" } } },
      { $sort: { latestScore: 1 } },
      { $limit: 1 },
      { $lookup: { from: "topiks", localField: "_id", foreignField: "_id", as: "topikDetails" } },
      { $unwind: { path: "$topikDetails", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "moduls", localField: "topikDetails.modulId", foreignField: "_id", as: "modulDetails" } },
      { $unwind: { path: "$modulDetails", preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, topicId: { $toString: "$topicDetails._id" }, topicTitle: "$topicDetails.title", topicSlug: "$topicDetails.slug", modulSlug: "$modulDetails.slug", score: { $round: ["$latestScore", 2] } } }
    ]);

    let deepenTopic = null;
    // Hanya tampilkan rekomendasi ini jika ada topik terlemah DAN nilainya di bawah 80
    if (weakestOverallTopicResult.length > 0 && weakestOverallTopicResult[0].score < 80) {
      deepenTopic = {
        ...weakestOverallTopicResult[0]
      };
    }

    // --- 3. Recommendation: Continue to Next Module ---
    const user = await User.findById(userId).select('topicCompletions').lean();
    const modulesWithProgress = await Modul.aggregate([
        { $lookup: { from: "topiks", localField: "_id", foreignField: "modulId", as: "topics" } },
        {
            $project: {
                _id: 1, title: 1, slug: 1, icon: 1, category: 1,
                topics: { _id: 1, title: 1, slug: 1 },
                totalTopics: { $size: "$topics" },
            }
        }
    ]);

    const modulesWithCompletion = modulesWithProgress.map(m => {
        const completedTopics = m.topics.filter(t => user.topicCompletions.some(ct => ct.equals(t._id))).length;
        const progress = m.totalTopics > 0 ? Math.round((completedTopics / m.totalTopics) * 100) : 0;
        return { ...m, completedTopics, progress };
    });

    let continueToModule = null;
    const preTestResult = await Result.findOne({ userId, testType: 'pre-test-global' }).sort({ createdAt: -1 });

    if (preTestResult) {
        let userLevel;
        if (preTestResult.score >= 75) userLevel = 'sulit';
        else if (preTestResult.score >= 40) userLevel = 'sedang';
        else userLevel = 'mudah';

        // Prioritas 1: Cari modul yang direkomendasikan dan sedang berjalan (in-progress)
        let recommendedModule = modulesWithCompletion.find(m => m.category === userLevel && m.progress > 0 && m.progress < 100);

        // Prioritas 2: Jika tidak ada, cari modul yang direkomendasikan dan belum dimulai
        if (!recommendedModule) {
            recommendedModule = modulesWithCompletion.find(m => m.category === userLevel && m.progress === 0);
        }

        if (recommendedModule) {
            // Cari topik pertama yang belum selesai di modul yang direkomendasikan
            const nextTopicInRecommendedModule = recommendedModule.topics.find(
                t => !user.topicCompletions.some(ct => ct.equals(t._id))
            );

            continueToModule = {
                moduleTitle: recommendedModule.title,
                moduleSlug: recommendedModule.slug,
                moduleIcon: recommendedModule.icon,
                nextTopic: nextTopicInRecommendedModule ? { title: nextTopicInRecommendedModule.title, id: nextTopicInRecommendedModule._id } : null,
            };
        }
    }

    res.status(200).json({
      repeatModule,
      deepenTopic,
      continueToModule,
    });

  } catch (error) {
    console.error("Error fetching learning recommendations:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get topics that need reinforcement for the user
 * @route   GET /api/results/topics-to-reinforce
 * @access  Private
 */
export const getTopicsToReinforce = async (req, res) => {
  try {
    const userId = req.user._id;

    const topics = await Result.aggregate([
      // 1. Match all post-test topic results for the user
      { $match: { userId, testType: "post-test-topik", topikId: { $exists: true } } },
      // 2. Sort by latest first to easily pick the most recent score
      { $sort: { createdAt: -1 } },
      // 3. Group by topic to get the latest score for each
      {
        $group: {
          _id: "$topikId",
          latestScore: { $first: "$score" },
        },
      },
      // 4. Sort by the lowest scores first
      { $sort: { latestScore: 1 } },
      // 5. Join with the 'topiks' collection to get the title
      {
        $lookup: {
          from: "topiks",
          localField: "_id",
          foreignField: "_id",
          as: "topicDetails",
        },
      },
      // 6. Filter out topics that might have been deleted
      { $match: { topicDetails: { $ne: [] } } },
      // 7. Project the final shape and add the status
      {
        $project: {
          _id: 0,
          topicTitle: { $arrayElemAt: ["$topicDetails.title", 0] },
          score: { $round: ["$latestScore", 2] },
          status: {
            $switch: {
              branches: [
                { case: { $lt: ["$latestScore", 60] }, then: "Perlu review" },
                { case: { $lt: ["$latestScore", 80] }, then: "Butuh latihan" },
              ],
              default: "Sudah bagus",
            },
          },
        },
      },
    ]);

    res.status(200).json(topics);
  } catch (error) {
    console.error("Error fetching topics to reinforce:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Check if a user has completed a module post-test
 * @param   {string} userId - The ID of the user.
 * @param   {string} modulId - The ID of the module.
 * @returns {Promise<boolean>} - True if a result exists, false otherwise.
 */
export const hasCompletedModulePostTest = async (userId, modulId) => {
  if (!userId || !modulId) {
    return false;
  }
  try {
    const result = await Result.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      modulId: new mongoose.Types.ObjectId(modulId),
      testType: "post-test-modul",
    });
    return !!result;
  } catch (error) {
    console.error("Error checking module post-test completion:", error);
    return false;
  }
};