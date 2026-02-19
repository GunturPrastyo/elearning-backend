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
import path from 'path';
import fs from 'fs';

/**
 * Helper untuk menghitung skor fitur berbobot (Weighted Average)
 * Rumus: Sum(Skor Modul * Bobot Fitur) / Sum(Bobot Fitur)
 */
const calculateWeightedFeatureScores = async (userId) => {
  const user = await User.findById(userId).select('competencyProfile').lean();
  if (!user || !user.competencyProfile) return {};

  const allModules = await Modul.find().select('featureWeights').lean();
  const featureMap = {};

  user.competencyProfile.forEach(cp => {
    if (!cp.modulId || !cp.featureId) return;
    const fid = cp.featureId.toString();
    const mid = cp.modulId.toString();
    const rawScore = cp.score; 

    const module = allModules.find(m => m._id.toString() === mid);
    if (module && module.featureWeights) {
      const fw = module.featureWeights.find(f => f.featureId.toString() === fid);
      if (fw) {
        const weight = fw.weight || 0;
        if (!featureMap[fid]) featureMap[fid] = { weightedSum: 0, totalWeight: 0 };
        featureMap[fid].weightedSum += rawScore * weight;
        featureMap[fid].totalWeight += weight;
      }
    }
  });

  const finalScores = {};
  Object.keys(featureMap).forEach(fid => {
    const data = featureMap[fid];
    finalScores[fid] = data.totalWeight > 0 ? data.weightedSum / data.totalWeight : 0;
  });
  
  return finalScores;
};

/**
 * Menghitung rincian skor berdasarkan 4 komponen: Akurasi, Waktu, Stabilitas, Fokus.
 */
const calculateFinalScoreDetails = (accuracyScore, timeTaken, totalDuration, answerChanges, tabExits, totalQuestions) => {
  // 1. Skor Waktu Pengerjaan (Sw) - Bobot 5%
  const timeEfficiency = totalDuration > 0 && timeTaken < totalDuration ? (1 - (timeTaken / totalDuration)) : 0;
  const timeScore = timeEfficiency * 100;

  // 2. Skor Stabilitas Jawaban (Sc) - Bobot 5%
  const changes = answerChanges || 0;
  const changePenalty = totalQuestions > 0 ? Math.min(changes / totalQuestions, 1) : 0;
  const answerStabilityScore = (1 - changePenalty) * 100;

  // 3. Skor Fokus (Sb) - Bobot 10%
  const exits = tabExits || 0;
  const focusPenalty = exits > 3 ? 1 : exits / 3;
  const focusScore = (1 - focusPenalty) * 100;

  // Kalkulasi Skor Akhir (Final Score)
  const finalScore = parseFloat(((accuracyScore * 0.80) + (timeScore * 0.05) + (answerStabilityScore * 0.05) + (focusScore * 0.10)).toFixed(2));

  return {
    finalScore,
    scoreDetails: {
      accuracy: parseFloat(accuracyScore.toFixed(2)),
      time: parseFloat(timeScore.toFixed(2)),
      stability: parseFloat(answerStabilityScore.toFixed(2)),
      focus: parseFloat(focusScore.toFixed(2)),
    }
  };
};

/**
 * Helper untuk menghitung dan update streak user
 */
const updateUserStreak = async (userId) => {
  try {
    const results = await Result.find({ userId }).sort({ createdAt: "desc" });
    let streak = 0;
    if (results.length > 0) {
      const uniqueDays = new Set();
      results.forEach(result => {
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
        streak = 1;
        for (let i = 0; i < sortedDays.length - 1; i++) {
          const diffTime = sortedDays[i] - sortedDays[i + 1];
          if (Math.round(diffTime / (1000 * 60 * 60 * 24)) === 1) streak++;
          else break;
        }
      }
    }
    await User.findByIdAndUpdate(userId, { dailyStreak: streak });
  } catch (error) {
    console.error("Error updating user streak:", error);
  }
};

/**
 * Menganalisis kelemahan sub-topik (untuk post-test-topik) atau topik (untuk post-test-modul).
 */
const analyzeWeaknesses = async (testType, questions, answers, topikId) => {
  let weakSubTopics = [];
  let weakTopics = [];

  // --- Analisis Sub Topik Lemah (Post-Test Topik) ---
  if (testType === "post-test-topik") {
    const subTopicAnalysis = {};
    questions.forEach(q => {
      if (q.subMateriId) {
        const subId = q.subMateriId.toString();
        if (!subTopicAnalysis[subId]) subTopicAnalysis[subId] = { correct: 0, total: 0 };
        subTopicAnalysis[subId].total++;
        if (answers[q._id.toString()] === q.answer) subTopicAnalysis[subId].correct++;
      }
    });

    const weakSubTopicDetails = [];
    for (const subId in subTopicAnalysis) {
      const analysis = subTopicAnalysis[subId];
      const subTopicScore = analysis.total > 0 ? (analysis.correct / analysis.total) * 100 : 0;
      if (subTopicScore < 70) weakSubTopicDetails.push({ subId, score: parseFloat(subTopicScore.toFixed(2)) });
    }

    if (weakSubTopicDetails.length > 0) {
      const materiWithWeakSubTopics = await Materi.findOne({ topikId: new mongoose.Types.ObjectId(topikId) });
      if (materiWithWeakSubTopics?.subMateris) {
        const weakSubTopicsMap = new Map(weakSubTopicDetails.map(d => [d.subId, d.score]));
        weakSubTopics = materiWithWeakSubTopics.subMateris
          .filter(sub => weakSubTopicsMap.has(sub._id.toString()))
          .map(sub => ({ subMateriId: sub._id, title: sub.title, score: weakSubTopicsMap.get(sub._id.toString()) }));
      }
    }
  }

  // --- Analisis Topik Lemah (Post-Test Modul) ---
  if (testType === "post-test-modul") {
    const topicPerformance = {};
    questions.forEach(q => {
      if (q.topikId) {
        const topikIdStr = q.topikId.toString();
        if (!topicPerformance[topikIdStr]) topicPerformance[topikIdStr] = { correct: 0, total: 0 };
        topicPerformance[topikIdStr].total++;
        if (answers[q._id.toString()] === q.answer) topicPerformance[topikIdStr].correct++;
      }
    });

    const weakTopicIds = [];
    for (const topikId in topicPerformance) {
      const perf = topicPerformance[topikId];
      const score = (perf.correct / perf.total) * 100;
      if (score < 70) weakTopicIds.push({ id: topikId, score: Math.round(score) });
    }

    if (weakTopicIds.length > 0) {
      const topicDetails = await Topik.find({ '_id': { $in: weakTopicIds.map(t => t.id) } }).select('title slug').lean();
      const topicScoreMap = new Map(weakTopicIds.map(t => [t.id, t.score]));
      weakTopics = topicDetails.map(topic => ({
        topikId: topic._id, title: topic.title, slug: topic.slug, score: topicScoreMap.get(topic._id.toString())
      }));
    }
  }

  return { weakSubTopics, weakTopics };
};

/**
 * Memproses logika khusus Pre-Test Global (Skor Fitur & Level Belajar).
 */
const processPreTestGlobal = async (questions, answers) => {
  const allFeatures = await Feature.find().lean();
  const relevantModulIds = [...new Set(questions.map(q => q.modulId).filter(id => id))].map(id => new mongoose.Types.ObjectId(id));
  const relevantModules = await Modul.find({ _id: { $in: relevantModulIds } }).select('featureWeights title').lean();
  const moduleWeightsMap = new Map(relevantModules.map(m => [m._id.toString(), m.featureWeights]));
  const moduleTitleMap = new Map(relevantModules.map(m => [m._id.toString(), m.title]));

  const featureScores = {}; 
  const moduleFeatureScores = {}; 

  // Inisialisasi struktur data per modul
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
    const isCorrect = answers[q._id.toString()] === q.answer;
    const moduleIdStr = q.modulId ? q.modulId.toString() : null;
    const moduleWeights = moduleIdStr ? moduleWeightsMap.get(moduleIdStr) : [];

    // 1. Hitung Global Feature Scores
    if (moduleWeights && moduleWeights.length > 0) {
      moduleWeights.forEach(fw => {
        const featureId = fw.featureId.toString();
        if (!featureScores[featureId]) {
          const featureInfo = allFeatures.find(af => af._id.toString() === featureId);
          featureScores[featureId] = { earned: 0, max: 0, name: featureInfo?.name || 'Unknown', group: featureInfo?.group || 'Dasar' };
        }
        featureScores[featureId].max += (fw.weight || 0);
        if (isCorrect) featureScores[featureId].earned += (fw.weight || 0);
      });
    }

    // 2. Hitung Per-Module Feature Scores
    if (moduleIdStr && moduleFeatureScores[moduleIdStr]) {
      moduleFeatureScores[moduleIdStr].questionCount++;
      if (isCorrect) {
        for (const featureIdStr in moduleFeatureScores[moduleIdStr].features) {
          const featureData = moduleFeatureScores[moduleIdStr].features[featureIdStr];
          featureData.accumulatedWeightedScore += 100; 
        }
      }
    }
  });

  // Format Output: Skor Fitur Berdasarkan Modul
  const featureScoresByModule = Object.entries(moduleFeatureScores).map(([moduleId, data]) => {
    const features = Object.entries(data.features).map(([featureId, fData]) => ({
      featureId,
      featureName: fData.name,
      group: fData.group,
      score: data.questionCount > 0 ? parseFloat((fData.accumulatedWeightedScore / data.questionCount).toFixed(2)) : 0,
    }));
    return { moduleId, moduleTitle: data.moduleTitle, features };
  });

  // Format Output: Skor Fitur Global Terhitung
  const calculatedFeatureScores = Object.entries(featureScores).map(([featureId, data]) => ({
    featureId,
    featureName: data.name,
    group: data.group,
    score: data.max > 0 ? (data.earned / data.max) * 100 : 0,
  }));

  // Hitung Akurasi Total (Weighted)
  let totalEarnedWeight = 0;
  let totalMaxWeight = 0;
  Object.values(featureScores).forEach(data => {
    totalEarnedWeight += data.earned;
    totalMaxWeight += data.max;
  });
  const accuracyScore = totalMaxWeight > 0 ? (totalEarnedWeight / totalMaxWeight) * 100 : 0;

  // Hitung Rata-rata Grup
  const groupScores = { Dasar: [], Menengah: [], Lanjutan: [] };
  calculatedFeatureScores.forEach(fs => {
    const groupName = fs.group ? fs.group.charAt(0).toUpperCase() + fs.group.slice(1).toLowerCase() : 'Dasar';
    if (groupScores[groupName]) groupScores[groupName].push(fs.score);
  });
  const calculateAverage = (scores) => scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const avgScoreDasar = calculateAverage(groupScores.Dasar);
  const avgScoreMenengah = calculateAverage(groupScores.Menengah);

  // --- LOGIKA PENENTUAN LEVEL (Berdasarkan Formula Global) ---
  const checkGroupPass = (groupName, threshold) => {
    const featuresInGroup = allFeatures.filter(f => {
      const g = f.group ? f.group.charAt(0).toUpperCase() + f.group.slice(1).toLowerCase() : 'Dasar';
      return g === groupName;
    });

    if (featuresInGroup.length === 0) return false;

    return featuresInGroup.every(f => {
      const fid = f._id.toString();
      const featureScoreObj = calculatedFeatureScores.find(cfs => cfs.featureId === fid);
      const score = featureScoreObj ? featureScoreObj.score : 0;
      return score >= threshold;
    });
  };

  let learningLevel = "Dasar";
  const passedDasarForLanjutan = checkGroupPass('Dasar', 85);
  const passedMenengahForLanjutan = checkGroupPass('Menengah', 75);
  
  if (passedDasarForLanjutan && passedMenengahForLanjutan) {
    learningLevel = "Lanjutan";
  } else {
    const passedDasarForMenengah = checkGroupPass('Dasar', 75);
    if (passedDasarForMenengah) {
      learningLevel = "Menengah";
    }
  }

  return {
    accuracyScore,
    featureScoresByModule,
    calculatedFeatureScores,
    avgScoreDasar,
    avgScoreMenengah,
    learningLevel
  };
};

/**
 * Menghitung ulang level belajar user berdasarkan profil kompetensi saat ini.
 */
const recalculateUserLearningLevel = async (userId) => {
  // 1. Hitung skor berbobot terbaru untuk setiap fitur
  const userFeatureScores = await calculateWeightedFeatureScores(userId);

  // 2. Ambil semua fitur yang tersedia di sistem untuk referensi kelengkapan
  const allFeatures = await Feature.find({}).lean();

  // 3. Fungsi helper untuk mengecek apakah SEMUA fitur dalam grup memenuhi threshold
  const checkGroupPass = (groupName, threshold) => {
    // Filter fitur sistem berdasarkan grup
    const featuresInGroup = allFeatures.filter(f => {
      const g = f.group ? f.group.charAt(0).toUpperCase() + f.group.slice(1).toLowerCase() : 'Dasar';
      return g === groupName;
    });

    if (featuresInGroup.length === 0) return false;

    // Cek setiap fitur di grup tersebut
    return featuresInGroup.every(f => {
      const fid = f._id.toString();
      const score = userFeatureScores[fid] || 0; // Jika user belum punya nilai, anggap 0
      return score >= threshold;
    });
  };

  // 4. Terapkan aturan penentuan level (Per Fitur)
  // Syarat Lanjutan: Semua fitur Dasar >= 85 DAN Semua fitur Menengah >= 75
  const passedDasarForLanjutan = checkGroupPass('Dasar', 85);
  const passedMenengahForLanjutan = checkGroupPass('Menengah', 75);
  
  if (passedDasarForLanjutan && passedMenengahForLanjutan) {
    return "Lanjutan";
  }

  // Syarat Menengah: Semua fitur Dasar >= 75
  const passedDasarForMenengah = checkGroupPass('Dasar', 75);
  
  if (passedDasarForMenengah) {
    return "Menengah";
  }

  return "Dasar";
};

/**
 * Menentukan apakah modul terkunci untuk user berdasarkan level belajar.
 */
const isModuleLockedForUser = (moduleCategory, userLearningLevel) => {
  // Jika level pengguna belum ditentukan (null/undefined/kosong), kunci semua modul.
  if (!userLearningLevel) return true;

  const level = userLearningLevel.charAt(0).toUpperCase() + userLearningLevel.slice(1).toLowerCase();
  const category = moduleCategory ? moduleCategory.toLowerCase() : '';

  // Normalisasi kategori modul agar mendukung 'mudah'/'dasar', 'sedang'/'menengah', dll.
  const isDasar = ['dasar', 'mudah'].includes(category);
  const isMenengah = ['menengah', 'sedang'].includes(category);

  // Aturan 1: Jika level pengguna 'Lanjutan', semua modul terbuka.
  if (level === 'Lanjutan' || level === 'Lanjut') {
    return false;
  }

  // Aturan 2: Jika level pengguna 'Menengah', modul 'mudah' dan 'sedang' terbuka.
  if (level === 'Menengah') {
    // Modul terbuka jika kategorinya Dasar atau Menengah. Terkunci jika Lanjutan/Sulit.
    return !(isDasar || isMenengah);
  }

  // Aturan 3: Jika level pengguna 'Dasar', hanya modul 'mudah' yang terbuka.
  if (level === 'Dasar') {
    // Modul terkunci jika kategorinya BUKAN Dasar.
    return !isDasar;
  }

  return true; // Defaultnya, kunci modul jika ada level yang tidak dikenal.
};

/**
 * Helper: Simpan hasil hanya jika skor baru lebih tinggi dari sebelumnya (High Score Strategy)
 */
const saveBestResult = async (query, updateData, finalScore) => {
  const existingResult = await Result.findOne(query);
  const previousBestScore = existingResult ? existingResult.score : null;

  if (!existingResult || finalScore > existingResult.score) {
    const result = await Result.findOneAndUpdate(
      query,
      { ...updateData, timestamp: new Date() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return { result, bestScore: finalScore, previousBestScore };
  }
  return { result: existingResult, bestScore: existingResult.score, previousBestScore };
};

/**
 * Helper untuk memetakan jawaban ke format database
 */
const mapAnswers = (questions, answers) => {
  return questions.map(q => ({
    questionId: q._id,
    selectedOption: answers[q._id.toString()],
    subMateriId: q.subMateriId,
    topikId: q.topikId
  }));
};

/**
 * Handler khusus untuk Post-Test Topik
 */
const handlePostTestTopik = async (userId, topikId, modulId, finalScore, correct, total, scoreDetails, questions, answers, weakSubTopics, timeTaken) => {
  const query = { userId, topikId, testType: "post-test-topik" };
  const updateData = {
    userId, testType: "post-test-topik", score: finalScore, correct, total, scoreDetails,
    answers: mapAnswers(questions, answers), weakSubTopics, timeTaken, modulId, topikId
  };
  return await saveBestResult(query, updateData, finalScore);
};

/**
 * Handler khusus untuk Pre-Test Global
 */
const handlePreTestGlobalResult = async (userId, finalScore, correct, total, scoreDetails, timeTaken, preTestData) => {
  const existingResult = await Result.findOne({ userId, testType: "pre-test-global" });
  const previousBestScore = existingResult ? existingResult.score : null;
  const { featureScoresByModule, calculatedFeatureScores, learningLevel } = preTestData;

  // Simpan profil kompetensi (Raw Score)
  const competencyProfileData = featureScoresByModule.flatMap(mod => 
    mod.features.map(feat => ({
      featureId: new mongoose.Types.ObjectId(feat.featureId),
      modulId: new mongoose.Types.ObjectId(mod.moduleId),
      score: feat.score
    }))
  );

  const user = await User.findById(userId);
  user.competencyProfile = competencyProfileData;
  await user.save();

  // Hitung ulang level belajar
  const newLearningLevel = await recalculateUserLearningLevel(userId);
  user.learningLevel = newLearningLevel;
  await user.save();

  const result = await Result.findOneAndUpdate(
    { userId, testType: "pre-test-global" },
    {
      userId, testType: "pre-test-global", score: finalScore, correct, total, scoreDetails, timeTaken,
      featureScores: calculatedFeatureScores.map(fs => ({ featureId: fs.featureId, featureName: fs.featureName, score: fs.score })),
      learningPath: newLearningLevel, timestamp: new Date(),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, set: { featureScoresByModule } }
  );

  return { result, bestScore: finalScore, previousBestScore, learningPathResult: newLearningLevel };
};

/**
 * Handler khusus untuk Post-Test Modul
 */
const handlePostTestModul = async (userId, modulId, finalScore, correct, total, scoreDetails, weakTopics, questions, answers, timeTaken) => {
  const objectModulId = new mongoose.Types.ObjectId(modulId);
  const query = { userId, modulId: objectModulId, testType: "post-test-modul" };
  const updateData = {
    userId, testType: "post-test-modul", score: finalScore, correct, total, scoreDetails, weakTopics,
    answers: mapAnswers(questions, answers), timeTaken, modulId: objectModulId
  };

  const { result, bestScore, previousBestScore } = await saveBestResult(query, updateData, finalScore);

  // Perbarui Profil Kompetensi & Level Belajar
  const competencyUpdates = [];
  let learningPathResult = null;
  
  const updateResult = await updateUserCompetencyFromModuleScore(userId, modulId, bestScore);
  if (updateResult) {
      competencyUpdates.push(...updateResult.competencyUpdates);
      learningPathResult = updateResult.learningPathResult;
  }

  return { result, bestScore, previousBestScore, competencyUpdates, learningPathResult };
};

/**
 * Helper untuk update kompetensi user dari skor modul 
 */
const updateUserCompetencyFromModuleScore = async (userId, modulId, bestScore) => {
    const modul = await Modul.findById(modulId).select('featureWeights title').populate('featureWeights.featureId', 'name group').lean();
    if (!modul || !modul.featureWeights) return null;

    const userToSave = await User.findById(userId);
    if (!userToSave) return null;

    const scoresBefore = await calculateWeightedFeatureScores(userId);
    let profile = userToSave.competencyProfile || [];

    modul.featureWeights.forEach(fw => {
        if (fw.featureId && fw.featureId._id) {
            const fid = fw.featureId._id.toString();
            const existingIndex = profile.findIndex(cp => 
                cp.modulId && cp.modulId.toString() === modulId && cp.featureId.toString() === fid
            );

            if (existingIndex > -1) {
                profile[existingIndex].score = Math.max(profile[existingIndex].score, bestScore);
            } else {
                profile.push({
                    featureId: fw.featureId._id,
                    modulId: new mongoose.Types.ObjectId(modulId),
                    score: bestScore
                });
            }
        }
    });

    userToSave.competencyProfile = profile;
    await userToSave.save();

    const scoresAfter = await calculateWeightedFeatureScores(userId);
    const competencyUpdates = [];

    Object.keys(scoresAfter).forEach(fid => {
        const oldScore = scoresBefore[fid] || 0;
        const newScore = scoresAfter[fid];
        if (newScore > oldScore) {
            const featureObj = modul.featureWeights.find(fw => fw.featureId && fw.featureId._id.toString() === fid);
            const featureName = featureObj && featureObj.featureId ? featureObj.featureId.name : 'Unknown Feature';
            competencyUpdates.push({
                featureName, oldScore, newScore,
                diff: parseFloat((newScore - oldScore).toFixed(2)),
                percentIncrease: oldScore > 0 ? Math.round(((newScore - oldScore) / oldScore) * 100) : 100
            });
        }
    });

    const newLearningLevel = await recalculateUserLearningLevel(userId);
    userToSave.learningLevel = newLearningLevel;
    await userToSave.save();

    return { competencyUpdates, learningPathResult: newLearningLevel };
};

/**
 * @desc    Simpan hasil tes (Pembuatan manual)
 */
const createResult = async (req, res) => {
  try {
    const { testType, score, correct, total, timeTaken, modulId, totalDuration } = req.body;
    const userId = req.user._id;

    if (!testType || score == null || correct == null || total == null || timeTaken == null) {
      return res.status(400).json({ message: "Data hasil tes tidak lengkap." });
    }

    // Kalkulasi rincian skor, sama seperti di submitTest
    const accuracyScore = score; 
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
      scoreDetails, 
      timeTaken,
      ...(modulId && { modulId }), 
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
 * @desc    Kirim jawaban tes (pre-test, post-test topik, post-test modul)
 */
const submitTest = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType, modulId, topikId, answers, timeTaken, answerChanges, tabExits } = req.body;

    if (!testType || !answers || Object.keys(answers).length === 0 || timeTaken === undefined) {
      return res.status(400).json({ message: "Data jawaban tidak lengkap." });
    }
    if (testType === "post-test-topik" && (!topikId || !mongoose.Types.ObjectId.isValid(topikId))) return res.status(400).json({ message: "Topik ID valid diperlukan." });
    if (testType === "post-test-modul" && (!modulId || !mongoose.Types.ObjectId.isValid(modulId))) return res.status(400).json({ message: "Modul ID valid diperlukan." });

    // 2. Ambil Soal
    const questionIds = Object.keys(answers);
    const query = { _id: { $in: questionIds } };
    if (testType === 'post-test-topik' && topikId) query.topikId = new mongoose.Types.ObjectId(topikId);
    if (testType === 'post-test-modul' && modulId) query.modulId = new mongoose.Types.ObjectId(modulId);

    const questions = await Question.find(query).select("+answer +durationPerQuestion +subMateriId +topikId");

    if (questions.length === 0) return res.status(404).json({ message: "Soal tidak ditemukan." });

    const correctAnswers = questions.reduce((count, q) => 
        answers[q._id.toString()] === q.answer ? count + 1 : count, 0);

    const totalQuestions = questions.length;
    const totalDuration = questions.reduce((acc, q) => acc + (q.durationPerQuestion || 60), 0);

    // 3. Kalkulasi Skor
    let accuracyScore;
    let preTestData = null;

    if (testType === "pre-test-global") {
      preTestData = await processPreTestGlobal(questions, answers);
      accuracyScore = preTestData.accuracyScore;
    } else {
      accuracyScore = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
    }

    const { finalScore, scoreDetails } = calculateFinalScoreDetails(
      accuracyScore, timeTaken, totalDuration, answerChanges, tabExits, totalQuestions
    );

    // 4. Analisis
    const { weakSubTopics, weakTopics } = await analyzeWeaknesses(testType, questions, answers, topikId);

    // 5. Simpan Hasil
    let resultData;

    if (testType === "post-test-topik") {
        resultData = await handlePostTestTopik(userId, topikId, modulId, finalScore, correctAnswers, totalQuestions, scoreDetails, questions, answers, weakSubTopics, timeTaken);
    } else if (testType === "pre-test-global") {
        resultData = await handlePreTestGlobalResult(userId, finalScore, correctAnswers, totalQuestions, scoreDetails, timeTaken, preTestData);
    } else if (testType === "post-test-modul") {
        resultData = await handlePostTestModul(userId, modulId, finalScore, correctAnswers, totalQuestions, scoreDetails, weakTopics, questions, answers, timeTaken);
    } else {
        // Hasil generik default
        const newResult = await new Result({
        userId, testType, score: finalScore, correct: correctAnswers, total: totalQuestions,
        scoreDetails, answers: mapAnswers(questions, answers), weakSubTopics: [], timeTaken,
        ...(modulId && { modulId: new mongoose.Types.ObjectId(modulId) }),
        ...(topikId && { topikId: new mongoose.Types.ObjectId(topikId) }),
        timestamp: new Date(),
      }).save();
      resultData = { result: newResult, bestScore: finalScore };
    }
    
    // 6. Pasca-Pemrosesan
    const { result, bestScore, previousBestScore, learningPathResult, competencyUpdates } = resultData;

    if (testType === "post-test-topik" && topikId && bestScore >= 70) {
      await User.findByIdAndUpdate(userId, { $addToSet: { topicCompletions: new mongoose.Types.ObjectId(topikId) } });
      await Result.deleteOne({ userId, topikId, testType: "post-test-topik-progress" });
    }

    await updateUserStreak(userId);

    res.status(201).json({
      message: "Jawaban berhasil disubmit.",
      data: {
        ...(result.toObject ? result.toObject() : result),
        weakTopics,
        weakSubTopics,
        score: finalScore,
        correct: correctAnswers,
        total: totalQuestions,
        bestScore,
        previousBestScore,
        learningPath: learningPathResult,
        scoreDetails,
        competencyUpdates,
        ...(testType === "pre-test-global" && {
          featureScores: preTestData.calculatedFeatureScores,
          avgScoreDasar: preTestData.avgScoreDasar,
          avgScoreMenengah: preTestData.avgScoreMenengah,
          featureScoresByModule: preTestData.featureScoresByModule,
        }),
      }
    });
  } catch (error) {
    console.error("Gagal submit tes:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Catat waktu belajar untuk sebuah topik
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
      score: 0,
      correct: 0,
      total: 0,
    });

    await newResult.save();

    await updateUserStreak(userId);

    res.status(201).json({ success: true, message: "Waktu belajar berhasil dicatat." });
  } catch (error) {
    console.error("Gagal mencatat waktu belajar:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Simpan atau perbarui progres tes pengguna
 */
const saveProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType, modulId, topikId, answers, currentIndex } = req.body;

    if (!testType || (!topikId && !modulId)) {
      return res.status(400).json({ message: "Data progress tidak lengkap (perlu testType dan salah satu dari topikId/modulId)." });
    }

    const query = { userId, testType };
    if (modulId) query.modulId = new mongoose.Types.ObjectId(modulId);
    if (topikId) query.topikId = new mongoose.Types.ObjectId(topikId);

    const progress = await Result.findOneAndUpdate( 
      query,
      {
        $set: {
          progressAnswers: Object.entries(answers || {}).map(([questionId, selectedOption]) => ({
            questionId,
            selectedOption,
          })),
          currentIndex: currentIndex || 0,
          ...(modulId && { modulId: new mongoose.Types.ObjectId(modulId) }),
          ...(topikId && { topikId: new mongoose.Types.ObjectId(topikId) }),
        },
      },
      {
        new: true, 
        upsert: true, 
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
 * @desc    Ambil progres tes pengguna
 */
const getProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { modulId, topikId, testType } = req.query;

    if (!testType) {
        return res.status(400).json({ message: "Parameter testType diperlukan." });
    }

    if (modulId && !mongoose.Types.ObjectId.isValid(modulId)) {
        return res.status(400).json({ message: `Format modulId tidak valid: ${modulId}` });
    }
    if (topikId && !mongoose.Types.ObjectId.isValid(topikId)) {
        return res.status(400).json({ message: `Format topikId tidak valid: ${topikId}` });
    }

    if (!topikId && !modulId) {
        return res.status(400).json({ message: "Salah satu dari topikId atau modulId diperlukan." });
    }

    const query = { userId, testType };
    if (modulId) query.modulId = new mongoose.Types.ObjectId(modulId);
    if (topikId) query.topikId = new mongoose.Types.ObjectId(topikId);

    const progress = await Result.findOne(query);

    if (!progress) {
      return res.status(200).json(null);
    }

    res.status(200).json(progress);
  } catch (error) {
    console.error("Gagal mengambil progress:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Hapus progres tes pengguna
 */
const deleteProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { modulId, topikId, testType } = req.query;

    if (!testType || (!topikId && !modulId)) {
      return res.status(400).json({ message: "Parameter testType dan salah satu dari topikId/modulId diperlukan untuk menghapus progress." });
    }

    const query = { userId, testType };
    if (modulId) query.modulId = modulId;
    if (topikId) query.topikId = topikId;

    await Result.deleteOne(query);
    res.status(200).json({ message: "Progress berhasil dihapus." });
  } catch (error) {
    console.error("Gagal menghapus progress:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Ambil hasil terbaru berdasarkan topik untuk pengguna saat ini dalam modul tertentu
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
      .sort({ timestamp: -1 }) 
      .populate("topikId", "title slug") 
      .populate("modulId", "title slug");

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
 * @desc    Ambil hasil terbaru berdasarkan tipe tes untuk pengguna saat ini
 */
const getLatestResultByType = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType } = req.params;
    const { modulId } = req.query;

    if (!testType) {
      return res.status(400).json({ message: "Parameter testType diperlukan." });
    }

    const query = { userId, testType };

    if (modulId) {
        if (!mongoose.Types.ObjectId.isValid(modulId)) {
            console.warn(`[getLatestResultByType] Invalid modulId received: ${modulId}`);
            return res.status(200).json(null);
        }
        query.modulId = new mongoose.Types.ObjectId(modulId);
    } else if (testType === 'post-test-modul') {
        console.log(`[getLatestResultByType] Missing modulId for post-test-modul`);
        return res.status(200).json(null);
    }

  
    const latestResult = await Result.findOne(query)
      .sort({ createdAt: -1 }) 
      .select('+weakTopics +scoreDetails') 
      .lean(); 

    if (latestResult && modulId && String(latestResult.modulId) !== String(modulId)) {
        console.warn(`[getLatestResultByType] Mismatch detected! Req: ${modulId}, Found: ${latestResult.modulId}. Returning null.`);
        return res.status(200).json(null);
    }

    res.status(200).json(latestResult);

  } catch (error) {
    console.error(`Gagal mengambil hasil tes tipe ${testType}:`, error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Hapus hasil berdasarkan tipe tes untuk pengguna saat ini
 */
const deleteResultByType = async (req, res) => {
  try {
    const userId = req.user._id;
    const { testType } = req.params;
    const { modulId } = req.query; 

    if (!testType) {
      return res.status(400).json({ message: "Parameter testType diperlukan." });
    }

    const query = { userId, testType };

    // Validasi untuk post-test-modul
    if (testType === 'post-test-modul') {
      if (!modulId || !mongoose.Types.ObjectId.isValid(modulId)) {
        return res.status(400).json({ message: "Modul ID valid diperlukan untuk menghapus post-test modul." });
      }
      query.modulId = new mongoose.Types.ObjectId(modulId);
    }

    const result = await Result.deleteMany(query);

    if (result.deletedCount === 0) {
      return res.status(200).json({ message: "Tidak ada hasil tes yang cocok untuk dihapus." });
    }

    res.status(200).json({ message: `Hasil tes untuk tipe ${testType} berhasil dihapus.` });
  } catch (error) {
    console.error(`Gagal menghapus hasil tes tipe ${testType}:`, error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Ambil semua hasil
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
 * @desc    Ambil hasil berdasarkan ID pengguna
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
 * @desc    Ambil total waktu belajar pengguna
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
 * @desc    Ambil data analitik untuk pengguna saat ini (skor rata-rata, topik terlemah)
 */
const getAnalytics = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ message: "User tidak terautentikasi." });
    }

    // Hitung Skor Rata-rata
    const averageScoreResult = await Result.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          testType: { $in: ["post-test-topik", "post-test-modul"] },
        },
      },
      {
        $group: {
          _id: null,
          averageScore: { $avg: "$score" },
        },
      },
    ]);

    // Hitung Skor Rata-rata Kelas
    const classAverageScoreResult = await Result.aggregate([
      {
        $match: {
          testType: { $in: ["post-test-topik", "post-test-modul"] },
        },
      },
      {
        $group: {
          _id: null,
          averageScore: { $avg: "$score" },
        },
      },
    ]);

    // Hitung Total Waktu Belajar
    const studyTimeResult = await Result.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, totalTime: { $sum: "$timeTaken" } } },
    ]);
    const totalStudyTime = studyTimeResult.length > 0 ? studyTimeResult[0].totalTime : 0;

    // Hitung Streak Harian
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
    const classAverageScore = classAverageScoreResult.length > 0 ? parseFloat(classAverageScoreResult[0].averageScore.toFixed(2)) : 0;

    // Cari Topik Terlemah
    const weakestTopicResult = await Result.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          testType: "post-test-topik",
        },
      },
      {
        $sort: { createdAt: -1 }, 
      },
      {
        $group: {
          _id: "$topikId", 
          latestScore: { $first: "$score" }, 
          latestTopikId: { $first: "$topikId" }, 
        },
      },
      {
        $match: {
          latestScore: { $lt: 70 },
        },
      },
      {
        $sort: { latestScore: 1 }, 
      },
      {
        $limit: 1, 
      },
      {
        $lookup: {
          from: "topiks", 
          localField: "latestTopikId",
          foreignField: "_id",
          as: "topikDetails",
        },
      },
      { $unwind: { path: "$topikDetails", preserveNullAndEmptyArrays: true } },
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
          modulSlug: { $ifNull: ["$modulDetails.slug", ""] }, 
        },
      },
    ]);

    const weakestTopic = weakestTopicResult.length > 0 ? weakestTopicResult[0] : null;

    res.status(200).json({
      averageScore,
      classAverageScore,
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
 * @desc    Ambil streak belajar harian pengguna
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
      date.setHours(0, 0, 0, 0); 
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
        else break; 
      }
    }

    res.status(200).json({ streak });
  } catch (error) {
    console.error("Error fetching daily streak:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

/**
 * @desc    Ambil aktivitas belajar mingguan pengguna
 */
const getWeeklyActivity = async (req, res) => {
  try {
    const userId = req.user._id;

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

    const weeklySeconds = Array(7).fill(0).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const dateString = d.toISOString().split('T')[0];
      return activityMap.get(dateString) || 0; 
    });

    res.status(200).json({ weeklySeconds });
  } catch (error) {
    console.error("Error fetching weekly activity:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Ambil rata-rata aktivitas belajar mingguan kelas
 */
const getClassWeeklyActivity = async (req, res) => {
  try {
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
          _id: "$_id.date", 
          averageSeconds: { $avg: "$totalSecondsPerUser" }
        }
      },
      { $sort: { _id: 1 } }, 
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
 * @desc    Ambil skor post-test modul terbaru pengguna
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
            { $sort: { createdAt: -1 } }, 
            { $limit: 1 }, 
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
 * @desc    Ambil data perbandingan rata-rata pengguna vs kelas untuk post-test modul
 */
const getComparisonAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    const objectUserId = new mongoose.Types.ObjectId(userId);
    const allModulesData = await Modul.aggregate([
      // 1. Ambil semua modul
      { $sort: { title: 1 } }, 
      // 2. Ambil skor terbaru pengguna untuk setiap modul
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
      // 3. Ambil rata-rata kelas untuk setiap modul
      {
        $lookup: {
          from: "results",
          let: { modul_id: "$_id" },
          pipeline: [
            { $match: { $expr: { $and: [ { $eq: ["$modulId", "$$modul_id"] }, { $eq: ["$testType", "post-test-modul"] } ] } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: "$userId", latestScore: { $first: "$score" } } },
            { $group: { _id: null, averageScore: { $avg: "$latestScore" } } }
          ],
          as: "classResult"
        }
      },
      // 4. Proyeksikan data akhir
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

    // --- 3. Hitung Peringkat dan Selisih Skor ---
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
 * @desc    Ambil rekomendasi belajar untuk pengguna
 */
const getLearningRecommendations = async (req, res) => {
  try {
    const userId = req.user._id;

    // --- 1. Rekomendasi: Ulangi Modul Terlemah ---
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

    // --- 2. Rekomendasi: Perdalam Topik Terlemah Secara Keseluruhan ---
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

    if (weakestOverallTopicResult.length > 0 && weakestOverallTopicResult[0].score < 70) {
      deepenTopic = {
        ...weakestOverallTopicResult[0]
      };
    }

    // --- 3. Rekomendasi: Lanjutkan ke Modul Berikutnya ---
    const user = await User.findById(userId).select('topicCompletions').lean();
    const modulesWithProgress = await Modul.aggregate([
        { $lookup: { from: "topiks", localField: "_id", foreignField: "modulId", as: "topics" } },
        {
            $project: {
                _id: 1, title: 1, slug: 1, icon: 1, category: 1, order: 1, 
                topics: { _id: 1, title: 1, slug: 1, order: 1 }, 
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

    if (preTestResult && preTestResult.learningPath) {
        const learningPath = preTestResult.learningPath.toLowerCase(); // 'Lanjutan' -> 'lanjutan'
        // Petakan learningPath ke kategori modul ('mudah', 'sedang', 'sulit')
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
 * @desc    Ambil topik yang perlu diperkuat untuk pengguna
 */
const getTopicsToReinforce = async (req, res) => {
  try {
    const userId = req.user._id;

    const topics = await Result.aggregate([
      // 1. Cocokkan semua hasil post-test topik untuk pengguna
      { $match: { userId, testType: "post-test-topik", topikId: { $exists: true } } },
      // 2. Urutkan berdasarkan yang terbaru untuk mengambil skor terkini dengan mudah
      { $sort: { createdAt: -1 } },
      // 3. Kelompokkan berdasarkan topik untuk mendapatkan skor terbaru masing-masing
      {
        $group: {
          _id: "$topikId",
          latestScore: { $first: "$score" },
          weakSubTopics: { $first: "$weakSubTopics" }, 
        },
      },
      // 4. Urutkan dari skor terendah
      { $sort: { latestScore: 1 } },
      // 5. Gabungkan dengan koleksi 'topiks' untuk mendapatkan judul
      {
        $lookup: {
          from: "topiks",
          localField: "_id",
          foreignField: "_id",
          as: "topicDetails",
        },
      },
      // 6. Filter topik yang mungkin telah dihapus
      { $match: { topicDetails: { $ne: [] } } },
      // 7. Proyeksikan bentuk akhir dan tambahkan status
      {
        $project: {
          _id: 0,
          topicTitle: { $arrayElemAt: ["$topicDetails.title", 0] },
          score: { $round: ["$latestScore", 2] },
          weakSubTopics: { $ifNull: ["$weakSubTopics", []] }, 
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
 * @desc    Cek apakah pengguna telah menyelesaikan post-test modul
 * @param   {string} userId - ID pengguna.
 * @param   {string} modulId - ID modul.
 * @returns {Promise<boolean>} - True jika hasil ada, false jika tidak.
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
 * @desc    Ambil performa pengguna di seluruh sub-topik
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

/**
 * @desc    Ambil papan peringkat streak
 * @route   GET /api/results/streak-leaderboard
 * @access  Private
 */
const getStreakLeaderboard = async (req, res) => {
  try {
    // Ambil top 10 user berdasarkan dailyStreak, urutkan descending
    // Hanya ambil user yang memiliki streak > 0
    const leaderboard = await User.find({ role: 'user', dailyStreak: { $gt: 0 } })
      .sort({ dailyStreak: -1 })
      .limit(10)
      .select('name avatar dailyStreak');
      
    res.status(200).json(leaderboard);
  } catch (error) {
    console.error("Error fetching streak leaderboard:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

// @desc    Buat sertifikat untuk pengguna yang sedang login
const generateCertificate = asyncHandler(async (req, res) => {
    const { name } = req.query; 

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
    const customFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold); 
    // 3. Ambil halaman pertama dari template
    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();

    // Mengatur header untuk respons file PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sertifikat_${name.replace(/\s+/g, '_')}.pdf"`);

    // 4. Gambar teks nama di atas template
    const nameToDraw = truncatedName.toUpperCase();
    const nameWidth = customFont.widthOfTextAtSize(nameToDraw, 36);
    page.drawText(nameToDraw, {
        x: (width - nameWidth) / 2, //  Posisi tengah horizontal
        y: height / 2 + 30,         // Posisi tengah vertikal + 30px
        font: customFont,
        size: 36,
        color: rgb(0.1, 0.1, 0.1), // Warna gelap
    });

    // 5. Gambar teks tanggal di atas template
    const date = new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
    const dateWidth = customFont.widthOfTextAtSize(date, 14);
    page.drawText(date, {
        x: (width - dateWidth) / 2, //  Posisi tengah horizontal
        y: height / 2 - 100,        // Di bawah nama
        font: customFont,
        size: 14,
        color: rgb(0.3, 0.3, 0.3), // Warna abu-abu
    });

    // 6. Simpan PDF ke buffer
    const pdfBytes = await pdfDoc.save();

    // 7. Kirim buffer sebagai respons
    res.end(Buffer.from(pdfBytes));
});

// @desc    Ambil peta kompetensi pengguna dari hasil pre-test
const getCompetencyMap = asyncHandler(async (req, res) => {  
  // 1. Hitung skor kompetensi pengguna menggunakan Weighted Average
  const userFeatureScores = await calculateWeightedFeatureScores(req.user._id);

  // --- Hitung Rata-rata Kelas ---
  const allUsers = await User.find({ role: 'user' }).select('competencyProfile').lean();
  const featureTotalScoreMap = new Map();
  const featureUserCountMap = new Map();

  allUsers.forEach(u => {
    if (u.competencyProfile && Array.isArray(u.competencyProfile)) {
      const userFeatureAvgScores = new Map();
      const userFeatureCounts = new Map();

      u.competencyProfile.forEach(comp => {
        const fid = comp.featureId.toString();
        userFeatureAvgScores.set(fid, (userFeatureAvgScores.get(fid) || 0) + comp.score);
        userFeatureCounts.set(fid, (userFeatureCounts.get(fid) || 0) + 1);
      });

      userFeatureAvgScores.forEach((total, fid) => {
        const count = userFeatureCounts.get(fid);
        const avg = count > 0 ? total / count : 0;
        featureTotalScoreMap.set(fid, (featureTotalScoreMap.get(fid) || 0) + avg);
        featureUserCountMap.set(fid, (featureUserCountMap.get(fid) || 0) + 1);
      });
    }
  });

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
    const fid = feature._id.toString();
    const count = featureUserCountMap.get(fid) || 0;
    const total = featureTotalScoreMap.get(fid) || 0;
    const average = count > 0 ? Math.round(total / count) : 0;

    const featureData = {
      name: feature.name,
      score: userFeatureScores[fid] || 0,
      average: average,
    };
    if (groupedFeatures[feature.group]) {
      groupedFeatures[feature.group].push(featureData);
    }
  });

  res.json(groupedFeatures);
});

// @desc    Cek apakah user sudah mengerjakan Pre-Test
const checkPreTestStatus = async (req, res) => {
  try {
  
    const userId = req.user._id;

    const preTestResult = await Result.findOne({
      userId: userId,
      testType: 'pre-test-global' 
    });

    if (preTestResult) {
      const user = await User.findById(userId).select('learningLevel');

      return res.status(200).json({
        hasTakenPreTest: true,
        learningLevel: user?.learningLevel || preTestResult.learningLevel || 'dasar', 
        score: preTestResult.score
      });
    }

    return res.status(200).json({
      hasTakenPreTest: false,
      learningLevel: null
    });

  } catch (error) {
    console.error('Error checking pre-test status:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// @desc    Ambil status user (tur guide & streak)
const getUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('hasSeenModulTour hasSeenProfileTour hasSeenModuleDetailTour hasSeenAnalyticsTour lastStreakShownDate');
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user status:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// @desc    Update status user (tur guide & streak)
const updateUserStatus = async (req, res) => {
  try {
    const { key, value } = req.body;
    const allowedKeys = ['hasSeenModulTour', 'hasSeenProfileTour', 'hasSeenModuleDetailTour', 'hasSeenAnalyticsTour', 'lastStreakShownDate'];
    
    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ message: "Invalid status key" });
    }

    const update = {};
    update[key] = value;

    await User.findByIdAndUpdate(req.user._id, update);
    res.status(200).json({ message: "Status updated" });
  } catch (error) {
    console.error("Error updating user status:", error);
    res.status(500).json({ message: "Server Error" });
  }
};


export {
    createResult, getResults, getResultsByUser, submitTest, logStudyTime,
    getStudyTime, getAnalytics, getDailyStreak, getWeeklyActivity,
    getClassWeeklyActivity, 
    getModuleScores, getComparisonAnalytics, getLearningRecommendations,
    getTopicsToReinforce, saveProgress, getProgress, getLatestResultByTopic,
    getLatestResultByType, deleteResultByType, deleteProgress, getCompetencyMap,
    getStreakLeaderboard,
    hasCompletedModulePostTest,
    getSubTopicPerformance,
    generateCertificate, checkPreTestStatus, 
    recalculateUserLearningLevel, 
    isModuleLockedForUser,
    getUserStatus, updateUserStatus,
};