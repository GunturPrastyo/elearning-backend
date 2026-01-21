import asyncHandler from "../middlewares/asyncHandler.js";
import Result from "../models/Result.js";
import User from "../models/User.js";
import Question from "../models/Question.js";
import mongoose from "mongoose";
import Materi from "../models/Materi.js";
import Modul from "../models/Modul.js";
import Topik from "../models/Topik.js";
import Feature from "../models/Feature.js";
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { recalculateUserLearningLevel } from "./userController.js"; // Impor fungsi baru
import path from 'path';
import fs from 'fs';

/**
 * @desc    Save a test result
 * @route   POST /api/results
 * @access  Private (user)
 */
const createResult = async (req, res) => {
  try {
    const { testType, score, correct, total, timeTaken, modulId, totalDuration, scoreDetails: providedScoreDetails } = req.body;
    const userId = req.user._id;

    // --- LOGIKA BARU: Session Tracking (Heartbeat & Offline) ---
    
    // 1. User Sedang Aktif (Heartbeat)
    if (testType === 'heartbeat') {
      // Ambil IP User
      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      
      // DEBUG: Cek apakah heartbeat masuk
      console.log(`[Heartbeat] User ${userId} aktif. IP: ${ip}`);

      // Update waktu aktif dan IP
      await User.findByIdAndUpdate(userId, { lastActiveAt: new Date(), lastIp: ip });
      return res.status(200).json({ message: "Heartbeat recorded" });
    }

    // 2. User Keluar/Tutup Tab (Offline)
    if (testType === 'offline') {
      // Reset lastActiveAt ke masa lalu (Epoch) agar langsung hilang dari hitungan online
      await User.findByIdAndUpdate(userId, { lastActiveAt: new Date(0) });
      return res.status(200).json({ message: "User marked offline" });
    }

    // VALIDASI TAMBAHAN: Pastikan modulId ada untuk post-test-modul
    if (testType === 'post-test-modul' && !modulId) {
        return res.status(400).json({ message: "Modul ID diperlukan untuk menyimpan hasil post-test modul." });
    }

    if (!testType || score == null || correct == null || total == null || timeTaken == null) {
      return res.status(400).json({ message: "Data hasil tes tidak lengkap." });
    }

    let scoreDetails = providedScoreDetails;

    if (!scoreDetails) {
      // Kalkulasi rincian skor, sama seperti di submitTest
      const accuracyScore = score; // score di pre-test adalah accuracy
      const timeEfficiency = totalDuration > 0 && timeTaken < totalDuration ? (1 - (timeTaken / totalDuration)) : 0;
      const timeScore = timeEfficiency * 100;

      // Untuk pre-test, asumsikan stabilitas dan fokus 100% karena tidak dilacak
      scoreDetails = {
        accuracy: parseFloat(accuracyScore.toFixed(2)),
        time: parseFloat(timeScore.toFixed(2)),
        stability: 100,
        focus: 100,
      };
    }

    const newResult = new Result({
      userId,
      testType,
      score,
      correct,
      total,
      scoreDetails, // <-- Tambahkan rincian skor di sini
      timeTaken,
      ...(modulId && { modulId: new mongoose.Types.ObjectId(modulId) }), // Pastikan cast ke ObjectId
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
const submitTest = async (req, res) => {
  try {
    // DEBUGGING: Log seluruh body request yang masuk ke endpoint ini
    console.log("[DEBUG] Menerima request ke /api/results/submit-test dengan body:", req.body);

    const userId = req.user._id;
    const { testType, modulId, topikId, answers, timeTaken, answerChanges, tabExits, timePerQuestion } = req.body;

    if (!testType || !answers || Object.keys(answers).length === 0 || timeTaken === undefined) {
      return res.status(400).json({ message: "Data jawaban tidak lengkap." });
    }
    
    // Validasi ID Wajib untuk mencegah data tercampur
    if (testType === "post-test-topik" && (!topikId || !mongoose.Types.ObjectId.isValid(topikId))) {
        return res.status(400).json({ message: "Topik ID valid diperlukan untuk post-test topik." });
    }
    if (testType === "post-test-modul" && (!modulId || !mongoose.Types.ObjectId.isValid(modulId))) {
        return res.status(400).json({ message: "Modul ID valid diperlukan untuk post-test modul." });
    }

    const questionIds = Object.keys(answers);
    
    // PERBAIKAN: Filter soal berdasarkan topikId/modulId untuk mencegah soal dari topik lain terhitung
    const query = { _id: { $in: questionIds } };
    if (testType === 'post-test-topik' && topikId) {
        query.topikId = new mongoose.Types.ObjectId(topikId);
    }
    if (testType === 'post-test-modul' && modulId) {
        query.modulId = new mongoose.Types.ObjectId(modulId);
    }

    // Ambil soal beserta field penting untuk analisis
    const questions = await Question.find(query).select("+answer +durationPerQuestion +subMateriId +topikId");

    if (questions.length !== questionIds.length) {
      // Jangan return 404 jika jumlah tidak sama, karena mungkin ada jawaban sampah dari topik lain yang kita filter out.
      // Cukup peringatkan atau lanjut dengan soal yang valid saja.
      if (questions.length === 0) {
          return res.status(404).json({ message: "Soal tidak ditemukan untuk topik/modul ini." });
      }
    }
    let correctAnswers = 0;
    questions.forEach((q) => {
      if (answers[q._id.toString()] === q.answer) correctAnswers++;
    });

    const totalQuestions = questions.length;
    const totalDuration = questions.reduce((acc, q) => acc + (q.durationPerQuestion || 60), 0);

    // --- Kalkulasi Skor Berdasarkan 4 Komponen ---    
    let accuracyScore;

    // 1. Skor Ketepatan Jawaban (Sₜ) - Bobot 60%
    if (testType === "pre-test-global") {
      // --- START: Logika Kalkulasi Skor Akurasi untuk Pre-test Global ---
      // Kalkulasi ini harus dilakukan di awal untuk mendapatkan `accuracyScore`
      const allFeatures = await Feature.find().lean();
      const relevantModulIds = [...new Set(questions.map(q => q.modulId).filter(id => id))];
      const relevantModules = await Modul.find({ _id: { $in: relevantModulIds } }).select('featureWeights').lean();
      const moduleWeightsMap = new Map(relevantModules.map(m => [m._id.toString(), m.featureWeights]));

      const featureScoresForAccuracy = {}; // Objek sementara untuk kalkulasi akurasi

      questions.forEach(q => {
        const isCorrect = answers[q._id.toString()] === q.answer;
        const moduleWeights = q.modulId ? moduleWeightsMap.get(q.modulId.toString()) : [];

        if (moduleWeights && moduleWeights.length > 0) {
          moduleWeights.forEach(fw => {
            const featureId = fw.featureId.toString();
            if (!featureScoresForAccuracy[featureId]) {
              featureScoresForAccuracy[featureId] = { earned: 0, max: 0 };
            }
            featureScoresForAccuracy[featureId].max += (fw.weight || 0);
            if (isCorrect) {
              featureScoresForAccuracy[featureId].earned += (fw.weight || 0);
            }
          });
        }
      });

      // Hitung accuracyScore berdasarkan total bobot yang didapat
      let totalEarnedWeight = 0;
      let totalMaxWeight = 0;
      Object.values(featureScoresForAccuracy).forEach(data => {
        totalEarnedWeight += data.earned;
        totalMaxWeight += data.max;
      });

      if (totalMaxWeight > 0) {
        accuracyScore = (totalEarnedWeight / totalMaxWeight) * 100;
      } else {
        accuracyScore = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
      }
      // --- END: Logika Kalkulasi Skor Akurasi untuk Pre-test Global ---

    } else {
      // Kalkulasi ketepatan standar untuk tes lain
      accuracyScore = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
    }

    // 2. Skor Waktu Pengerjaan (S𝑤) - Bobot 15%
    // DIKEMBALIKAN KE RUMUS AWAL: Berdasarkan total waktu pengerjaan.
    const timeEfficiency = totalDuration > 0 && timeTaken < totalDuration ? (1 - (timeTaken / totalDuration)) : 0;
    const timeScore = timeEfficiency * 100;

    // 3. Skor Stabilitas Jawaban (S𝑐) - Bobot 10%
    // Semakin sedikit perubahan, semakin tinggi skornya. Maksimal perubahan ditoleransi = jumlah soal.
    const changes = answerChanges || 0;
    const changePenalty = totalQuestions > 0 ? Math.min(changes / totalQuestions, 1) : 0;
    const answerStabilityScore = (1 - changePenalty) * 100;

    // 4. Skor Fokus (S𝑏) - Bobot 15%
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

    // --- Analisis Topik Lemah (hanya untuk post-test-modul) ---
    let weakTopics = [];
    if (testType === "post-test-modul") {
      const topicPerformance = {}; // { topikId: { correct: 0, total: 0 } }

      // 1. Kelompokkan jawaban berdasarkan topikId
      questions.forEach(q => {
        if (q.topikId) {
          const topikIdStr = q.topikId.toString();
          if (!topicPerformance[topikIdStr]) {
            topicPerformance[topikIdStr] = { correct: 0, total: 0 };
          }
          topicPerformance[topikIdStr].total++;
          if (answers[q._id.toString()] === q.answer) {
            topicPerformance[topikIdStr].correct++;
          }
        }
      });

      // 2. Hitung skor dan identifikasi topik lemah
      const weakTopicIds = [];
      for (const topikId in topicPerformance) {
        const perf = topicPerformance[topikId];
        const score = (perf.correct / perf.total) * 100;
        if (score < 70) { // Batas kelulusan 70%
          weakTopicIds.push({ id: topikId, score: Math.round(score) });
        }
      }

      // 3. Ambil detail topik yang lemah (title, slug)
      if (weakTopicIds.length > 0) {
        const topicDetails = await Topik.find({ '_id': { $in: weakTopicIds.map(t => t.id) } }).select('title slug').lean();
        const topicScoreMap = new Map(weakTopicIds.map(t => [t.id, t.score]));
        
        weakTopics = topicDetails.map(topic => ({
          topikId: topic._id, title: topic.title, slug: topic.slug, score: topicScoreMap.get(topic._id.toString())
        }));
      }
    }

    let result;
    let bestScore = finalScore; // Inisialisasi skor akhir dengan skor saat ini
    let learningPathResult = null;
    
    let featureScoresByModule = []; // Variabel baru untuk menyimpan skor per modul
    // Deklarasikan variabel pre-test di sini agar bisa diakses di scope luar
    let calculatedFeatureScores = [];
    let avgScoreDasar = 0;
    let avgScoreMenengah = 0;

    // Logika untuk mengambil nilai terbaik pada post-test topik
    if (testType === "post-test-topik") {
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

      // Log untuk memastikan blok pre-test global dieksekusi
      console.log(`[DEBUG] Memproses pre-test-global untuk user: ${userId}`);
      
      // --- START: Logika Penentuan Level Belajar (Skor per Fitur) ---
      // `accuracyScore` sudah dihitung di atas, sekarang kita hitung skor per fitur untuk menentukan level.
      const allFeatures = await Feature.find().lean();
      const relevantModulIds = [...new Set(questions.map(q => q.modulId).filter(id => id))].map(id => new mongoose.Types.ObjectId(id));
      const relevantModules = await Modul.find({ _id: { $in: relevantModulIds } }).select('featureWeights').lean();
      const moduleWeightsMap = new Map(relevantModules.map(m => [m._id.toString(), m.featureWeights]));

      const featureScores = {}; // { featureId: { earned: 0, max: 0, name: '', group: '' } }

      questions.forEach(q => {
        const isCorrect = answers[q._id.toString()] === q.answer;
        const moduleWeights = q.modulId ? moduleWeightsMap.get(q.modulId.toString()) : [];

        if (moduleWeights && moduleWeights.length > 0) {
          moduleWeights.forEach(fw => {
            const featureId = fw.featureId.toString();
            if (!featureScores[featureId]) {
              const featureInfo = allFeatures.find(af => af._id.toString() === featureId);
              featureScores[featureId] = { earned: 0, max: 0, name: featureInfo?.name || 'Unknown', group: featureInfo?.group || 'Dasar' };
            }
            featureScores[featureId].max += (fw.weight || 0);
            if (isCorrect) {
              featureScores[featureId].earned += (fw.weight || 0);
            }
          });
        }
      });

      // --- START: Logika Baru untuk Skor Fitur per Modul ---
      const moduleFeatureScores = {}; // { moduleId: { moduleTitle: '...', features: { featureId: { earned, max, name, group } } } }

      const modulesInfo = await Modul.find({ _id: { $in: relevantModulIds } }).select('title').lean();
      const moduleTitleMap = new Map(modulesInfo.map(m => [m._id.toString(), m.title]));

      // Inisialisasi struktur data
      relevantModulIds.forEach(modulId => {
        const moduleIdStr = modulId.toString();
        const moduleWeights = moduleWeightsMap.get(moduleIdStr) || [];
        moduleFeatureScores[moduleIdStr] = {
          moduleTitle: moduleTitleMap.get(moduleIdStr) || 'Unknown Module',
          questionCount: 0,
          features: {}
        };
        moduleWeights.forEach(fw => {
          const featureIdStr = fw.featureId.toString();
          const featureInfo = allFeatures.find(af => af._id.toString() === featureIdStr);
          moduleFeatureScores[moduleIdStr].features[featureIdStr] = {
            accumulatedWeightedScore: 0,
            weight: fw.weight || 0,
            name: featureInfo?.name || 'Unknown',
            group: featureInfo?.group || 'Dasar'
          };
        });
      });

      // Proses setiap soal
      questions.forEach(q => {
        if (!q.modulId) return;

        const moduleIdStr = q.modulId.toString();
        if (moduleFeatureScores[moduleIdStr]) {
          moduleFeatureScores[moduleIdStr].questionCount++;
          const isCorrect = answers[q._id.toString()] === q.answer;
          if (isCorrect) {
            // Jika benar, tambahkan skor berbobot (100 * bobot) ke setiap fitur di modul itu
            for (const featureIdStr in moduleFeatureScores[moduleIdStr].features) {
              const featureData = moduleFeatureScores[moduleIdStr].features[featureIdStr];
              featureData.accumulatedWeightedScore += (100 * featureData.weight);
            }
          }
        }
      });
      
      // --- END: Logika Baru untuk Skor Fitur per Modul ---

      // Konversi struktur moduleFeatureScores ke array yang lebih mudah digunakan
      featureScoresByModule = Object.entries(moduleFeatureScores).map(([moduleId, data]) => {
        // Hitung total bobot yang didapat dan total bobot maksimal untuk modul ini
        let totalEarnedWeight = 0;
        let totalMaxWeight = 0;

        const features = Object.entries(data.features).map(([featureId, fData]) => {          
          // Hitung skor rata-rata: total skor berbobot dibagi jumlah soal di modul itu
          const finalFeatureScore = data.questionCount > 0 
            ? parseFloat((fData.accumulatedWeightedScore / data.questionCount).toFixed(2))
            : 0;

          return {
            featureId,
            featureName: fData.name,
            group: fData.group,
            score: finalFeatureScore,
          }
        });
        
        return {
          moduleId,
          moduleTitle: data.moduleTitle,
          features: features
        };
      });

      // 2. Hitung skor akhir untuk setiap fitur (gabungan)
      calculatedFeatureScores = Object.entries(featureScores).map(([featureId, data]) => ({
        featureId,
        featureName: data.name,
        group: data.group, // ex: { earned: 8, max: 10 } -> score: 80
        score: data.max > 0 ? (data.earned / data.max) * 100 : 0,
      }));

      // Log skor fitur dan grup untuk debugging
      console.log('Skor Akhir per Fitur (sebelum dikelompokkan):', calculatedFeatureScores);

      // 3. Kelompokkan skor fitur berdasarkan grupnya
      const groupScores = {
        Dasar: [],
        Menengah: [],
        Lanjutan: [],
      };
      calculatedFeatureScores.forEach(fs => {
        // Normalisasi nama grup (Title Case) untuk mencocokkan kunci groupScores
        const groupName = fs.group ? fs.group.charAt(0).toUpperCase() + fs.group.slice(1).toLowerCase() : 'Dasar';
        if (groupScores[groupName]) {
          groupScores[groupName].push(fs.score);
        }
      });

      // 4. Hitung skor RATA-RATA untuk setiap grup
      const calculateAverage = (scores) => scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      avgScoreDasar = calculateAverage(groupScores.Dasar);
      avgScoreMenengah = calculateAverage(groupScores.Menengah);
      // const avgScoreLanjutan = calculateAverage(groupScores.Lanjutan); // Untuk pengembangan di masa depan

      console.log(`[DEBUG] Rata-rata Skor Grup Dasar: ${avgScoreDasar}, Rata-rata Skor Grup Menengah: ${avgScoreMenengah}`);

      // 5. Terapkan Aturan Logis dengan urutan yang benar
      // Aturan dievaluasi dari yang paling ketat (Lanjutan) ke yang paling longgar (Dasar).
      // Aturan 1: Cek untuk Level Lanjutan
      if (avgScoreDasar >= 85 && avgScoreMenengah >= 75) {
        learningPathResult = "Lanjutan";
      // Aturan 2: Jika tidak lolos Lanjutan, cek untuk Level Menengah
      } else if (avgScoreDasar >= 75) {
        learningPathResult = "Menengah";
      } else {
        // Aturan 3: Jika semua syarat di atas tidak terpenuhi, pengguna masuk ke level Dasar.
        learningPathResult = "Dasar";
      }

      // --- START: Menyiapkan data profil kompetensi per modul untuk disimpan di User ---
      const competencyProfileData = [];
      featureScoresByModule.forEach(modul => {
        modul.features.forEach(feature => {
          competencyProfileData.push({
            modulId: new mongoose.Types.ObjectId(modul.moduleId),
            featureId: new mongoose.Types.ObjectId(feature.featureId),
            score: feature.score
          });
        });
      });
      // --- END: Menyiapkan data profil kompetensi ---

      // Simpan profil kompetensi baru ke user
      const user = await User.findById(userId);
      user.competencyProfile = competencyProfileData;
      
      // FIX: Simpan user terlebih dahulu agar data competencyProfile tersimpan di DB
      // Hal ini penting karena recalculateUserLearningLevel akan melakukan query ke DB
      await user.save();

      user.learningLevel = await recalculateUserLearningLevel(userId);
      await user.save();
      learningPathResult = user.learningLevel; // Gunakan level yang baru dihitung untuk respons
      // --- END: Logika Baru untuk Pre-test Global ---

      // Pre-test hanya dikerjakan sekali, jadi kita selalu upsert.
      // Tidak perlu membandingkan dengan skor lama karena metriknya sekarang berbeda.
      result = await Result.findOneAndUpdate(
        { userId, testType: "pre-test-global" },
        {
          userId, testType, score: finalScore, correct: correctAnswers, total: totalQuestions, scoreDetails, timeTaken,
          featureScores: calculatedFeatureScores.map(fs => ({ featureId: fs.featureId, featureName: fs.featureName, score: fs.score })),
          learningPath: learningPathResult, timestamp: new Date(),
        },
        { new: true, upsert: true, setDefaultsOnInsert: true, set: { featureScoresByModule: featureScoresByModule } }
      );
      bestScore = finalScore;
    } else if (testType === "post-test-modul") {
      const objectModulId = new mongoose.Types.ObjectId(modulId);
      const existingResult = await Result.findOne({ userId, modulId: objectModulId, testType });

      if (!existingResult || finalScore > existingResult.score) {
        result = await Result.findOneAndUpdate(
          { userId, modulId: objectModulId, testType },
          {
            userId, testType, score: finalScore,
            correct: correctAnswers,
            total: totalQuestions,
            scoreDetails,
            weakTopics, // Simpan analisis topik lemah
            answers: questions.map(q => ({ questionId: q._id, selectedOption: answers[q._id.toString()], topikId: q.topikId })),
            timeTaken,
            timestamp: new Date(),
            modulId: objectModulId,
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        bestScore = finalScore;
      } else {
        result = existingResult;
        bestScore = existingResult.score;
      }

      // --- START: Logika Pembaruan Kompetensi setelah Post-Test Modul ---
      console.log(`[DEBUG] Memulai update kompetensi untuk user: ${userId} dari modul: ${modulId}`);

      // 1. Ambil bobot fitur dari modul yang sedang dites
      const modul = await Modul.findById(modulId).select('featureWeights').populate('featureWeights.featureId', 'name group').lean();
      if (!modul || !modul.featureWeights) {
        throw new Error("Bobot fitur untuk modul ini tidak ditemukan.");
      }

      // 2. Hitung skor baru untuk setiap fitur berdasarkan: Skor Akhir Tes * Bobot Fitur
      // Gunakan `bestScore` untuk memastikan skor tertinggi yang digunakan untuk update.
      const newCompetencyDataForModule = modul.featureWeights.map(fw => {
        const featureScore = parseFloat((bestScore * (fw.weight || 0)).toFixed(2));
        return {
          featureId: new mongoose.Types.ObjectId(fw.featureId._id),
          modulId: new mongoose.Types.ObjectId(modulId),
          score: featureScore,
        };
      });

      // 3. Update profil kompetensi pengguna
      const userToSave = await User.findById(userId);
      // Hapus entri lama untuk modul ini
      const otherModulesProfile = userToSave.competencyProfile.filter(
        comp => comp.modulId.toString() !== modulId
      );
      // Gabungkan dengan data baru
      userToSave.competencyProfile = [...otherModulesProfile, ...newCompetencyDataForModule];
      await userToSave.save();

      console.log(`[DEBUG] Profil kompetensi untuk modul ${modulId} telah diperbarui.`);

      // 4. Hitung ulang level belajar berdasarkan profil kompetensi yang baru dan simpan
      const newLearningLevel = await recalculateUserLearningLevel(userId);
      userToSave.learningLevel = newLearningLevel;
      await userToSave.save();
      learningPathResult = newLearningLevel; // Simpan untuk dikirim di respons

      console.log(`[DEBUG] Profil kompetensi dan level belajar user ${userId} telah diperbarui. Level baru: ${newLearningLevel}`);
      // --- END: Logika Pembaruan Kompetensi ---
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
        ...(modulId && { modulId: new mongoose.Types.ObjectId(modulId) }),
        ...(topikId && { topikId: new mongoose.Types.ObjectId(topikId) }),
        timestamp: new Date(),
      }).save();
      bestScore = finalScore;
    }
    
    // Jika post-test topik lulus, lakukan beberapa update:
    if (testType === "post-test-topik" && topikId && bestScore >= 70) {
      // 1. Tambahkan ID topik ke progres user
      await User.findByIdAndUpdate(req.user._id, {
        $addToSet: { topicCompletions: new mongoose.Types.ObjectId(topikId) },
      });
    }

    // Setelah submit, hapus progress tes yang tersimpan untuk topik ini
    if (testType === "post-test-topik" && topikId) {
      await Result.deleteOne({
        userId, topikId, testType: "post-test-topik-progress"
      });
    }

    res.status(201).json({
      message: "Jawaban berhasil disubmit.",
      // Pastikan data yang dikembalikan adalah objek biasa, bukan dokumen Mongoose
      // dan selalu sertakan analisis weakSubTopics dari pengerjaan saat ini untuk feedback langsung.
      data: {
        ...(result.toObject ? result.toObject() : result),
        weakTopics, // Selalu kirim analisis topik lemah dari pengerjaan saat ini
        weakSubTopics, // Feedback sub-topik lemah dari pengerjaan saat ini.
        score: finalScore, // Selalu kirim skor pengerjaan SAAT INI untuk ditampilkan di modal.
        correct: correctAnswers, // PERBAIKAN: Paksa kirim jumlah benar dari percobaan SAAT INI
        total: totalQuestions,   // PERBAIKAN: Paksa kirim total soal dari percobaan SAAT INI
        bestScore: bestScore, // Kirim juga skor terbaik untuk perbandingan/update di frontend.
        learningPath: learningPathResult, // Kirim hasil penentuan level
        scoreDetails, // Feedback rincian skor dari pengerjaan saat ini
        // DEBUG: Kirim rincian skor fitur untuk debugging di frontend
        ...(testType === "pre-test-global" && {
          featureScores: calculatedFeatureScores,
          avgScoreDasar,
          avgScoreMenengah,
          featureScoresByModule, // Kirim data baru ini ke frontend
        }),
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
const logStudyTime = async (req, res) => {
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
const saveProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType, modulId, topikId, answers, currentIndex } = req.body;

    if (!testType) {
      return res.status(400).json({ message: "Tipe tes diperlukan." });
    }

    const query = { userId, testType };
    if (modulId) query.modulId = new mongoose.Types.ObjectId(modulId);
    if (topikId) query.topikId = new mongoose.Types.ObjectId(topikId);

    // Use findOneAndUpdate with upsert to either create a new progress document or update an existing one.
    const progress = await Result.findOneAndUpdate(
      query,
      {
        $set: {
          // Simpan ke field `progressAnswers` yang baru
          progressAnswers: Object.entries(answers || {}).map(([questionId, selectedOption]) => ({
            questionId,
            selectedOption,
          })),
          currentIndex: currentIndex || 0,
          ...(modulId && { modulId: new mongoose.Types.ObjectId(modulId) }),
          ...(topikId && { topikId: new mongoose.Types.ObjectId(topikId) }),
          testType
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
const getProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { modulId, topikId, testType } = req.query;

    if (!testType) {
      return res.status(400).json({ message: "Parameter testType diperlukan." });
    }

    const query = { userId, testType };
    if (modulId && mongoose.Types.ObjectId.isValid(modulId)) query.modulId = new mongoose.Types.ObjectId(modulId);
    if (topikId && mongoose.Types.ObjectId.isValid(topikId)) query.topikId = new mongoose.Types.ObjectId(topikId);

    const progress = await Result.findOne(query);

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
const deleteProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    // Ambil parameter dari query string, bukan dari body
    const { modulId, topikId, testType } = req.query;

    if (!testType) {
      return res.status(400).json({ message: "Parameter testType diperlukan." });
    }

    const query = { userId, testType };
    if (modulId && mongoose.Types.ObjectId.isValid(modulId)) query.modulId = new mongoose.Types.ObjectId(modulId);
    if (topikId && mongoose.Types.ObjectId.isValid(topikId)) query.topikId = new mongoose.Types.ObjectId(topikId);

    await Result.deleteOne(query);
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
const getLatestResultByTopic = async (req, res) => {
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
const getLatestResultByType = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType } = req.params;
    const { modulId } = req.query;

    if (!testType) {
      return res.status(400).json({ message: "Parameter testType diperlukan." });
    }

    // PERBAIKAN: Wajibkan modulId untuk post-test-modul agar tidak mengambil data modul lain
    if (testType === 'post-test-modul' && (!modulId || !mongoose.Types.ObjectId.isValid(modulId))) {
        // Jika modulId tidak valid/ada, kembalikan null (jangan ambil data sembarangan)
        return res.status(200).json(null);
    }

    const query = { userId, testType };
    // Explicitly set modulId for post-test-modul to ensure filtering
    if (testType === 'post-test-modul') {
        query.modulId = new mongoose.Types.ObjectId(modulId);
    } else if (modulId && mongoose.Types.ObjectId.isValid(modulId)) {
      query.modulId = new mongoose.Types.ObjectId(modulId);
    }

    const latestResult = await Result.findOne(query)
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
const deleteResultByType = async (req, res) => {
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
const getResults = async (req, res) => {
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
const getResultsByUser = async (req, res) => {
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
const getStudyTime = async (req, res) => {
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
const getAnalytics = async (req, res) => {
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
 * @desc    Get user's daily study streak
 * @route   GET /api/results/streak
 * @access  Private
 */
const getDailyStreak = async (req, res) => {
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
const getWeeklyActivity = async (req, res) => {
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
 * @desc    Get class average weekly study activity
 * @route   GET /api/results/class-weekly-activity
 * @access  Private
 */
const getClassWeeklyActivity = async (req, res) => {
  try {
    // Dapatkan tanggal 7 hari yang lalu
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Agregasi untuk menghitung rata-rata waktu belajar harian
    const activity = await Result.aggregate([
      // 1. Filter entri relevan dalam 7 hari terakhir
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo },
          timeTaken: { $exists: true, $gt: 0 } // Hanya entri yang mencatat waktu
        },
      },
      // 2. Kelompokkan total waktu per pengguna per hari
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            userId: "$userId"
          },
          totalSecondsPerUser: { $sum: "$timeTaken" }
        }
      },
      // 3. Hitung rata-rata dari total waktu harian semua pengguna
      {
        $group: {
          _id: "$_id.date", // Sekarang kelompokkan hanya berdasarkan tanggal
          averageSeconds: { $avg: "$totalSecondsPerUser" }
        }
      },
      { $sort: { _id: 1 } }, // Urutkan berdasarkan tanggal
    ]);

    const activityMap = new Map(activity.map(item => [item._id, item.averageSeconds]));

    const weeklyAverages = Array(7).fill(0).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateString = d.toISOString().split('T')[0];
      return activityMap.get(dateString) || 0;
    });

    res.status(200).json({ weeklyAverages });
  } catch (error) {
    console.error("Error fetching class weekly activity:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get user's latest module post-test scores
 * @route   GET /api/results/module-scores
 * @access  Private
 */
const getModuleScores = async (req, res) => {
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
const getComparisonAnalytics = async (req, res) => {
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
const getLearningRecommendations = async (req, res) => {
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
        { $project: { _id: 0, topicId: "$topikDetails._id", topicTitle: "$topikDetails.title", topicSlug: "$topikDetails.slug", modulSlug: "$modulDetails.slug", score: { $round: ["$latestScore", 2] } } }
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

    // Gunakan learningPath dari hasil pre-test, bukan skor.
    if (preTestResult && preTestResult.learningPath) {
        const learningPath = preTestResult.learningPath.toLowerCase(); // 'Lanjutan' -> 'lanjutan'
        // Map learningPath ke kategori modul ('mudah', 'sedang', 'sulit')
        const categoryMap = { 'dasar': 'mudah', 'menengah': 'sedang', 'lanjutan': 'sulit' };
        const userCategory = categoryMap[learningPath];

        // Urutkan semua modul berdasarkan 'order'
        const sortedModules = [...modulesWithCompletion].sort((a, b) => (a.order || 0) - (b.order || 0));

        // Prioritas 1: Cari modul yang direkomendasikan (sesuai kategori) dan sedang berjalan
        let recommendedModule = sortedModules.find(m => m.category === userCategory && m.progress > 0 && m.progress < 100);

        // Prioritas 2: Jika tidak ada, cari modul yang direkomendasikan dan belum dimulai
        if (!recommendedModule) {
            recommendedModule = sortedModules.find(m => m.category === userCategory && m.progress === 0);
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
const getTopicsToReinforce = async (req, res) => {
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
const hasCompletedModulePostTest = async (userId, modulId) => {
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
const getSubTopicPerformance = async (req, res) => {
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

// @desc    Generate a certificate for the logged-in user
// @route   GET /api/results/certificate
// @access  Private
const generateCertificate = asyncHandler(async (req, res) => {
    const { name } = req.query; // Ambil nama dari query parameter

    if (!name) {
        res.status(400);
        throw new Error('Nama pada sertifikat tidak boleh kosong.');
    }

    // Batasi nama menjadi maksimal 3 kata
    const truncatedName = name.split(' ').slice(0, 3).join(' ');

    // 1. Muat template PDF dari file
    const templatePath = path.resolve(process.cwd(), 'src', 'assets', 'certificate-template.pdf');
    const templateBytes = await fs.promises.readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);

    // 2. Gunakan font standar yang sudah ada di pdf-lib
    const customFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold); // Anda bisa ganti ke font lain jika sudah di-embed
    // 3. Ambil halaman pertama dari template
    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();

    // Mengatur header untuk respons file PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sertifikat_${name.replace(/\s+/g, '_')}.pdf"`);

    // 4. Gambar teks nama di atas template
    // Anda perlu menyesuaikan posisi (x, y), ukuran (size), dan warna (color)
    const nameToDraw = truncatedName.toUpperCase();
    const nameWidth = customFont.widthOfTextAtSize(nameToDraw, 36);
    page.drawText(nameToDraw, {
        x: (width - nameWidth) / 2, // Contoh: Posisi tengah horizontal
        y: height / 2 + 30,         // Contoh: Posisi tengah vertikal + 30px
        font: customFont,
        size: 36,
        color: rgb(0.1, 0.1, 0.1), // Warna gelap
    });

    // 5. Gambar teks tanggal di atas template
    const date = new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateWidth = customFont.widthOfTextAtSize(date, 14);
    page.drawText(date, {
        x: (width - dateWidth) / 2, // Contoh: Posisi tengah horizontal
        y: height / 2 - 100,        // Contoh: Di bawah nama
        font: customFont,
        size: 14,
        color: rgb(0.3, 0.3, 0.3), // Warna abu-abu
    });

    // 6. Simpan PDF ke buffer
    const pdfBytes = await pdfDoc.save();

    // 7. Kirim buffer sebagai respons
    res.end(Buffer.from(pdfBytes));
});

// @desc    Get user's competency map from pre-test results
// @route   GET /api/results/competency-map
// @access  Private
const getCompetencyMap = asyncHandler(async (req, res) => {  
  // 1. Ambil profil kompetensi pengguna dan buat peta skor
  const user = await User.findById(req.user._id).select('competencyProfile').lean();
  const scoreMap = new Map();
  if (user && user.competencyProfile) {
    user.competencyProfile.forEach(comp => {
      const featureId = comp.featureId.toString();
      const currentScore = scoreMap.get(featureId) || 0;
      if (comp.score > currentScore) {
        scoreMap.set(featureId, comp.score);
      }
    });
  }

  // 2. Ambil semua fitur yang ada di database
  const allFeatures = await Feature.find({}).sort({ name: 1 }).lean();

  // 3. Inisialisasi struktur data untuk pengelompokan
  const groupedFeatures = {
    Dasar: [],
    Menengah: [],
    Lanjutan: [],
  };

  // 4. Kelompokkan fitur dan tambahkan skor pengguna
  allFeatures.forEach(feature => {
    const featureData = {
      name: feature.name,
      score: scoreMap.get(feature._id.toString()) || 0,
    };
    if (groupedFeatures[feature.group]) {
      groupedFeatures[feature.group].push(featureData);
    }
  });

  res.json(groupedFeatures);
});

// @desc    Cek apakah user sudah mengerjakan Pre-Test
// @route   GET /api/results/check-pre-test
// @access  Private
const checkPreTestStatus = async (req, res) => {
  try {
    // Mengambil ID user dari token (asumsi middleware auth menyimpan user di req.user)
    const userId = req.user._id;

    // Cari data result dengan tipe/kategori 'Pre-Test' milik user tersebut
    // Pastikan field 'category' atau 'type' sesuai dengan yang Anda simpan saat submit pre-test
    const preTestResult = await Result.findOne({
      userId: userId,
      testType: 'pre-test-global' 
    });

    if (preTestResult) {
      // Ambil data user terbaru untuk mendapatkan learningLevel yang paling update
      const user = await User.findById(userId).select('learningLevel');

      // Jika data ditemukan, kirim status true dan levelnya
      return res.status(200).json({
        hasTakenPreTest: true,
        learningLevel: user?.learningLevel || preTestResult.learningLevel || 'dasar', // Prioritaskan level dari User
        score: preTestResult.score
      });
    }

    // Jika data tidak ditemukan
    return res.status(200).json({
      hasTakenPreTest: false,
      learningLevel: null
    });

  } catch (error) {
    console.error('Error checking pre-test status:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};


export {
    createResult, getResults, getResultsByUser, submitTest, logStudyTime,
    getStudyTime, getAnalytics, getDailyStreak, getWeeklyActivity,
    getClassWeeklyActivity, 
    getModuleScores, getComparisonAnalytics, getLearningRecommendations,
    getTopicsToReinforce, saveProgress, getProgress, getLatestResultByTopic,
    getLatestResultByType, deleteResultByType, deleteProgress, getCompetencyMap,
    hasCompletedModulePostTest,
    getSubTopicPerformance,
    generateCertificate, checkPreTestStatus,
};