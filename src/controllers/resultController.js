import Result from "../models/Result.js";
import User from "../models/User.js";
import Question from "../models/Question.js";
import mongoose from "mongoose";
import Materi from "../models/Materi.js";
import Modul from "../models/Modul.js";
import Topik from "../models/Topik.js";

/**
 * @desc    Save a test result
 * @route   POST /api/results
 * @access  Private (user)
 */
export const createResult = async (req, res) => {
  try {
    const { testType, score, correct, total, timeTaken, modulId, totalDuration } = req.body;
    const userId = req.user._id;

    if (!testType || score == null || correct == null || total == null || timeTaken == null) {
      return res.status(400).json({ message: "Data hasil tes tidak lengkap." });
    }

    // Kalkulasi rincian skor, sama seperti di submitTest
    const accuracyScore = score; // score di pre-test adalah accuracy
    const timeEfficiency = totalDuration > 0 && timeTaken < totalDuration ? (1 - (timeTaken / totalDuration)) : 0;
    const timeScore = timeEfficiency * 100;

    // Untuk pre-test, asumsikan stabilitas dan fokus 100% karena tidak dilacak
    const scoreDetails = {
      accuracy: parseFloat(accuracyScore.toFixed(2)),
      time: parseFloat(timeScore.toFixed(2)),
      stability: 100,
      focus: 100,
    };

    const newResult = new Result({
      userId,
      testType,
      score,
      correct,
      total,
      scoreDetails, // <-- Tambahkan rincian skor di sini
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
    const { testType, modulId, topikId, answers, timeTaken, answerChanges, tabExits, timePerQuestion } = req.body;

    if (!testType || !answers || Object.keys(answers).length === 0 || timeTaken === undefined) {
      return res.status(400).json({ message: "Data jawaban tidak lengkap." });
    }
    
    const questionIds = Object.keys(answers);
    
    // Kueri soal berdasarkan tipe tes
    const query = { _id: { $in: questionIds }, testType };
    if (testType === 'post-test-topik' && topikId) {
      query.topikId = new mongoose.Types.ObjectId(topikId);
    }
    if (testType === 'post-test-modul' && modulId) {
      query.modulId = new mongoose.Types.ObjectId(modulId);
    }

    const questions = await Question.find({
      _id: { $in: questionIds },
      testType,
    }).select("+answer +durationPerQuestion");

    if (questions.length !== questionIds.length) {
      return res.status(404).json({ message: "Beberapa soal tidak ditemukan." });
    }

    let correctAnswers = 0;
    questions.forEach((q) => {
      if (answers[q._id.toString()] === q.answer) correctAnswers++;
    });

    const totalQuestions = questions.length;
    const totalDuration = questions.reduce((acc, q) => acc + (q.durationPerQuestion || 60), 0);

    // --- Kalkulasi Skor Berdasarkan 4 Komponen ---

    // 1. Skor Ketepatan Jawaban (Sₜ) - Bobot 60%
    const accuracyScore = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;

    // 2. Skor Waktu Pengerjaan (S𝑤) - Bobot 15%
    // DIKEMBALIKAN KE RUMUS AWAL: Berdasarkan total waktu pengerjaan.
    const timeEfficiency = totalDuration > 0 && timeTaken < totalDuration ? (1 - (timeTaken / totalDuration)) : 0;
    const timeScore = timeEfficiency * 100;

    // 3. Skor Perubahan Jawaban (S𝑐) - Bobot 10%
    // Semakin sedikit perubahan, semakin tinggi skornya. Maksimal perubahan ditoleransi = jumlah soal.
    const changes = answerChanges || 0;
    const changePenalty = totalQuestions > 0 ? Math.min(changes / totalQuestions, 1) : 0;
    const answerStabilityScore = (1 - changePenalty) * 100;

    // 4. Skor Tab Keluar Halaman (S𝑏) - Bobot 15%
    // Semakin sedikit keluar tab, semakin tinggi skornya. Toleransi 3x keluar tab.
    const exits = tabExits || 0;
    const focusPenalty = exits > 3 ? 1 : exits / 3;
    const focusScore = (1 - focusPenalty) * 100;

    // Kalkulasi Skor Akhir (Final Score)
    const finalScore = parseFloat(((accuracyScore * 0.60) + (timeScore * 0.15) + (answerStabilityScore * 0.10) + (focusScore * 0.15)).toFixed(2));

    // Siapkan objek rincian skor untuk disimpan
    const scoreDetails = {
      accuracy: parseFloat(accuracyScore.toFixed(2)),
      time: parseFloat(timeScore.toFixed(2)),
      stability: parseFloat(answerStabilityScore.toFixed(2)),
      focus: parseFloat(focusScore.toFixed(2)),
    };

    // --- Analisis Sub Topik Lemah (hanya untuk post-test-topik) ---
    // Analisis ini dilakukan pada percobaan saat ini, sebelum memutuskan apakah akan disimpan atau tidak.
    let weakSubTopics = [];
    if (testType === "post-test-topik") {
      const subTopicAnalysis = {}; // { subMateriId: { correct: 0, total: 0 } }

      // 1. Kelompokkan jawaban berdasarkan subMateriId dari soal yang dikerjakan
      questions.forEach(q => {
        if (q.subMateriId) {
          const subId = q.subMateriId.toString();
          if (!subTopicAnalysis[subId]) {
            subTopicAnalysis[subId] = { correct: 0, total: 0 };
          }
          subTopicAnalysis[subId].total++;
          if (answers[q._id.toString()] === q.answer) {
            subTopicAnalysis[subId].correct++;
          }
        }
      });

      // 2. Hitung skor per sub-topik dan filter yang lemah (di bawah 70%)
      const weakSubTopicDetails = [];
      for (const subId in subTopicAnalysis) {
        const analysis = subTopicAnalysis[subId];
        const subTopicScore = analysis.total > 0 ? (analysis.correct / analysis.total) * 100 : 0;
        if (subTopicScore < 70) {
          weakSubTopicDetails.push({ subId, score: parseFloat(subTopicScore.toFixed(2)) });
        }
      }
      const weakSubTopicIds = weakSubTopicDetails.map(d => d.subId);

      if (weakSubTopicIds.length > 0) {
        // 3. Ambil detail (judul) dari sub-topik yang lemah
        const materiWithWeakSubTopics = await Materi.findOne({ topikId: new mongoose.Types.ObjectId(topikId) });
        if (
          materiWithWeakSubTopics &&
          materiWithWeakSubTopics.subMateris
        ) {
          const weakSubTopicsMap = new Map(weakSubTopicDetails.map(d => [d.subId, d.score]));
          weakSubTopics = materiWithWeakSubTopics.subMateris.filter(sub => weakSubTopicIds.includes(sub._id.toString())).map(sub => ({ subMateriId: sub._id, title: sub.title, score: weakSubTopicsMap.get(sub._id.toString()) }));
        }
      }
    }

    let result;
    let bestScore = finalScore; // Inisialisasi skor akhir dengan skor saat ini

    // Logika untuk mengambil nilai terbaik pada post-test topik
    if (testType === "post-test-topik" && topikId) {
      // 1. Cari hasil yang sudah ada
      const existingResult = await Result.findOne({ userId, topikId, testType: "post-test-topik" });

      // 2. Bandingkan skor. Hanya update jika tidak ada hasil atau skor baru lebih tinggi.
      if (!existingResult || finalScore > existingResult.score) {
        // Jika skor baru lebih baik, perbarui/buat data baru
        result = await Result.findOneAndUpdate(
          { userId, topikId, testType: "post-test-topik" },
          {
            userId, testType, score: finalScore, // FIX: Simpan finalScore, bukan accuracyScore
            correct: correctAnswers,
            total: totalQuestions,
            scoreDetails, // Simpan rincian skor
            answers: questions.map(q => ({ questionId: q._id, selectedOption: answers[q._id.toString()], subMateriId: q.subMateriId })),
            weakSubTopics, // Simpan hasil analisis sub topik lemah
            timeTaken,
            modulId,
            topikId,
            timestamp: new Date() // Perbarui timestamp ke waktu pengerjaan terbaru
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        bestScore = finalScore;
        // `result` sekarang berisi `weakSubTopics` yang sudah disimpan dari percobaan terbaik ini.
      } else {
        // Jika skor baru tidak lebih baik, kembalikan hasil lama yang lebih bagus.
        bestScore = existingResult.score;
        // Jangan ubah `result` di sini. Cukup gunakan `existingResult` apa adanya.
        // Kita akan menambahkan `weakSubTopics` dari percobaan saat ini ke respons JSON secara terpisah.
        result = existingResult;
      }
    } else if (testType === "pre-test-global") {
      const existingResult = await Result.findOne({ userId, testType });

      if (!existingResult || finalScore > existingResult.score) {
        result = await Result.findOneAndUpdate(
          { userId, testType },
          {
            userId, testType, score: finalScore,
            correct: correctAnswers,
            total: totalQuestions,
            scoreDetails,
            timeTaken,
            timestamp: new Date(),
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        bestScore = finalScore;
      } else {
        result = existingResult;
        bestScore = existingResult.score;
      }
    } else if (testType === "post-test-modul" && modulId) {
      const existingResult = await Result.findOne({ userId, modulId, testType });

      if (!existingResult || finalScore > existingResult.score) {
        result = await Result.findOneAndUpdate(
          { userId, modulId, testType },
          {
            userId, testType, score: finalScore,
            correct: correctAnswers,
            total: totalQuestions,
            scoreDetails,
            timeTaken,
            timestamp: new Date(),
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        bestScore = finalScore;
      } else {
        result = existingResult;
        bestScore = existingResult.score;
      }
    } else {
      // Untuk tipe tes lain (misalnya pre-test), selalu buat hasil baru.
      result = await new Result({
        userId, testType, score: finalScore,
        correct: correctAnswers,
        total: totalQuestions,
        scoreDetails, // Simpan rincian skor
        answers: questions.map(q => ({ questionId: q._id, selectedOption: answers[q._id.toString()], subMateriId: q.subMateriId })),
        // weakSubTopics hanya relevan untuk post-test-topik, jadi biarkan kosong untuk tipe lain.
        weakSubTopics: [],
        timeTaken,
        ...(modulId && { modulId }),
        ...(topikId && { topikId }),
        timestamp: new Date(),
      }).save();
      bestScore = finalScore;
    }
    
    // Jika post-test topik lulus, lakukan beberapa update:
    if (testType === "post-test-topik" && topikId && bestScore >= 70) { // Pastikan batas kelulusan konsisten 70
      // 1. Tambahkan ID topik ke progres user
      await User.findByIdAndUpdate(req.user._id, {
        $addToSet: { topicCompletions: new mongoose.Types.ObjectId(topikId) },
      });
    }

    // Setelah submit, hapus progress tes yang tersimpan untuk topik ini
    await Result.deleteOne({
      userId, topikId, testType: "post-test-topik-progress"
    });

    res.status(201).json({
      message: "Jawaban berhasil disubmit.",
      // Pastikan data yang dikembalikan adalah objek biasa, bukan dokumen Mongoose
      // dan selalu sertakan analisis weakSubTopics dari pengerjaan saat ini untuk feedback langsung.
      data: {
        ...(result.toObject ? result.toObject() : result),
        weakSubTopics, // Feedback sub-topik lemah dari pengerjaan saat ini.
        score: finalScore, // Selalu kirim skor pengerjaan SAAT INI untuk ditampilkan di modal.
        bestScore: bestScore, // Kirim juga skor terbaik untuk perbandingan/update di frontend.
        scoreDetails, // Feedback rincian skor dari pengerjaan saat ini
      }
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
          // Simpan ke field `progressAnswers` yang baru
          progressAnswers: Object.entries(answers || {}).map(([questionId, selectedOption]) => ({
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
      .sort({ timestamp: -1 }) // Urutkan berdasarkan timestamp pengerjaan terakhir
      .populate("topikId", "title slug") // Perbaiki field yang di-populate
      .populate("modulId", "title slug");

    if (!latestResult) {
      return res.status(404).json({ message: "Belum ada hasil post-test untuk topik ini." });
    }

    // Langsung kembalikan hasil dari DB, termasuk field `weakSubTopics` yang sudah tersimpan.
    // Tidak perlu kalkulasi ulang.
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
 * @desc    Delete a result by test type for the current user
 * @route   DELETE /api/results/by-type/:testType
 * @access  Private
 */
export const deleteResultByType = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType } = req.params;

    if (!testType) {
      return res.status(400).json({ message: "Parameter testType diperlukan." });
    }

    const result = await Result.deleteOne({
      userId,
      testType,
    });

    if (result.deletedCount === 0) {
      // Tidak apa-apa jika tidak ada yang dihapus, mungkin memang belum ada hasilnya.
      return res.status(200).json({ message: "Tidak ada hasil tes yang cocok untuk dihapus." });
    }

    res.status(200).json({ message: `Hasil tes untuk tipe ${testType} berhasil dihapus.` });
  } catch (error) {
    console.error(`Gagal menghapus hasil tes tipe ${testType}:`, error);
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
      // Tambahkan filter: hanya anggap topik "lemah" jika skornya di bawah 70
      {
        $match: {
          latestScore: { $lt: 70 },
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
    if (weakestModuleResult.length > 0 && weakestModuleResult[0].score < 70) {
      const weakestModule = weakestModuleResult[0];

      // Cek apakah semua topik di modul ini sudah dikuasai
      const topicsInModule = await Topik.find({ modulId: weakestModule._id }).select('_id').lean();
      const topicIdsInModule = topicsInModule.map(t => t._id);

      const topicScores = await Result.aggregate([
        { $match: { userId, testType: "post-test-topik", topikId: { $in: topicIdsInModule } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$topikId", latestScore: { $first: "$score" } } },
      ]);

      const allTopicsMastered = topicIdsInModule.length > 0 && topicScores.length === topicIdsInModule.length && topicScores.every(s => s.latestScore >= 70);

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
        { $project: { _id: 0, topicId: "$topicDetails._id", topicTitle: "$topikDetails.title", topicSlug: "$topikDetails.slug", modulSlug: "$modulDetails.slug", score: { $round: ["$latestScore", 2] } } }
    ]);

    let deepenTopic = null;
    // Hanya tampilkan rekomendasi ini jika ada topik terlemah DAN nilainya di bawah 70
    if (weakestOverallTopicResult.length > 0 && weakestOverallTopicResult[0].score < 70) {
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
                _id: 1, title: 1, slug: 1, icon: 1, category: 1, order: 1, // Tambahkan order modul
                topics: { _id: 1, title: 1, slug: 1, order: 1 }, // Tambahkan order topik
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

        // Urutkan semua modul berdasarkan 'order'
        const sortedModules = [...modulesWithCompletion].sort((a, b) => (a.order || 0) - (b.order || 0));

        // Prioritas 1: Cari modul yang direkomendasikan dan sedang berjalan (in-progress)
        // Sekarang mencari dari modul yang sudah diurutkan
        let recommendedModule = sortedModules.find(m => m.category === userLevel && m.progress > 0 && m.progress < 100);

        // Prioritas 2: Jika tidak ada, cari modul yang direkomendasikan dan belum dimulai
        if (!recommendedModule) {
            recommendedModule = sortedModules.find(m => m.category === userLevel && m.progress === 0);
        }

        if (recommendedModule) {
            // Cari topik pertama yang belum selesai di modul yang direkomendasikan
            // Urutkan topik berdasarkan 'order' sebelum mencari yang belum selesai
            const sortedTopics = [...recommendedModule.topics].sort((a, b) => a.order - b.order);
            const nextTopicInRecommendedModule = sortedTopics.find(
                t => !user.topicCompletions.some(ct => ct.equals(t._id))
            );

            continueToModule = {
                moduleTitle: recommendedModule.title,
                moduleSlug: recommendedModule.slug,
                moduleIcon: recommendedModule.icon,
                nextTopic: nextTopicInRecommendedModule ? { title: nextTopicInRecommendedModule.title, id: nextTopicInRecommendedModule._id.toString() } : null,
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
          weakSubTopics: { $first: "$weakSubTopics" }, // Ambil weakSubTopics dari hasil terbaru
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
          weakSubTopics: { $ifNull: ["$weakSubTopics", []] }, // Sertakan weakSubTopics, default ke array kosong
          status: {
            $switch: {
              branches: [
                { case: { $lt: ["$latestScore", 60] }, then: "Perlu review" },
                { case: { $lt: ["$latestScore", 70] }, then: "Butuh latihan" },
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

/**
 * @desc    Get user's performance across all sub-topics
 * @route   GET /api/results/subtopic-performance
 * @access  Private
 */
export const getSubTopicPerformance = async (req, res) => {
  try {
    const userId = req.user._id;

    const performance = await Result.aggregate([
      // 1. Ambil semua hasil post-test topik dari user
      { $match: { userId: new mongoose.Types.ObjectId(userId), testType: "post-test-topik" } },
      // 2. "Buka" array 'answers' agar setiap jawaban menjadi dokumen terpisah
      { $unwind: "$answers" },
      // 3. Pastikan jawaban memiliki subMateriId
      { $match: { "answers.subMateriId": { $exists: true, $ne: null } } },
      // 4. Lookup ke koleksi 'questions' untuk mendapatkan jawaban yang benar
      {
        $lookup: {
          from: "questions",
          localField: "answers.questionId",
          foreignField: "_id",
          as: "questionDetails"
        }
      },
      { $unwind: "$questionDetails" },
      // 5. Kelompokkan berdasarkan subMateriId dan hitung jawaban benar & total
      {
        $group: {
          _id: "$answers.subMateriId",
          correct: {
            $sum: {
              $cond: [{ $eq: ["$answers.selectedOption", "$questionDetails.answer"] }, 1, 0]
            }
          },
          total: { $sum: 1 }
        }
      },
      // 6. Hitung skor rata-rata
      {
        $project: {
          averageScore: { $round: [{ $multiply: [{ $divide: ["$correct", "$total"] }, 100] }, 2] }
        }
      },
      // 7. Urutkan dari skor terendah
      { $sort: { averageScore: 1 } },
      // 8. Lookup ke koleksi 'materis' untuk mendapatkan judul sub-topik
      { $lookup: { from: "materis", localField: "_id", foreignField: "subMateris._id", as: "materiDetails" } },
      { $unwind: "$materiDetails" },
      { $unwind: "$materiDetails.subMateris" },
      { $match: { $expr: { $eq: ["$_id", "$materiDetails.subMateris._id"] } } },
      // 9. Bentuk output akhir
      { $project: { _id: 0, subTopicTitle: "$materiDetails.subMateris.title", score: "$averageScore" } }
    ]);

    res.status(200).json(performance);
  } catch (error) {
    console.error("Error fetching sub-topic performance:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};