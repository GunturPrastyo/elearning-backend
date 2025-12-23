import Result from "../models/Result.js";
import User from "../models/User.js";
import Topik from "../models/Topik.js";
import Modul from "../models/Modul.js";

/**
 * @desc    Get aggregated analytics data for the admin dashboard
 * @route   GET /api/analytics/admin-analytics
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

    // --- 6. Kecepatan Belajar per Modul (Rata-rata Waktu Pengerjaan Tes) ---
    const moduleLearningSpeed = await Result.aggregate([
      // 1. Filter hanya untuk post-test-topik dan post-test-modul yang punya modulId
      {
        $match: {
          testType: { $in: ["post-test-topik", "post-test-modul"] },
          modulId: { $exists: true, $ne: null },
        },
      },
      // 2. Kelompokkan berdasarkan modulId dan hitung rata-rata timeTaken
      {
        $group: {
          _id: "$modulId",
          averageTime: { $avg: "$timeTaken" }, // dalam detik
        },
      },
      // 3. Lookup ke collection 'moduls' untuk mendapatkan judul modul
      {
        $lookup: {
          from: "moduls",
          localField: "_id",
          foreignField: "_id",
          as: "modulDetails",
        },
      },
      // 4. Deconstruct array hasil lookup
      { $unwind: "$modulDetails" },
      // 5. Bentuk output yang diinginkan
      {
        $project: {
          _id: 0,
          moduleTitle: "$modulDetails.title",
          // Kirim rata-rata waktu dalam detik (dibulatkan)
          averageTimeInSeconds: { $round: ["$averageTime", 0] },
        },
      },
      // 6. Urutkan berdasarkan waktu tercepat
      { $sort: { averageTimeInSeconds: 1 } },
    ]);

    // --- 7. Distribusi Nilai per Modul (untuk Radar Chart) ---
    const moduleScoreDistribution = await Result.aggregate([
      // 1. Filter hanya untuk post-test-topik dan post-test-modul
      {
        $match: {
          testType: { $in: ["post-test-topik", "post-test-modul"] },
          modulId: { $exists: true, $ne: null },
        },
      },
      // 2. Kelompokkan berdasarkan modulId dan hitung rata-rata skor
      {
        $group: {
          _id: "$modulId",
          // Hitung total skor dan jumlah untuk post-test-topik
          topicTotalScore: {
            $sum: { $cond: [{ $eq: ["$testType", "post-test-topik"] }, "$score", 0] }
          },
          topicCount: {
            $sum: { $cond: [{ $eq: ["$testType", "post-test-topik"] }, 1, 0] }
          },
          // Hitung total skor dan jumlah untuk post-test-modul
          moduleTotalScore: {
            $sum: { $cond: [{ $eq: ["$testType", "post-test-modul"] }, "$score", 0] }
          },
          moduleCount: {
            $sum: { $cond: [{ $eq: ["$testType", "post-test-modul"] }, 1, 0] }
          },
        },
      },
      // 3. Lookup ke collection 'moduls' untuk mendapatkan judul modul
      {
        $lookup: {
          from: "moduls",
          localField: "_id",
          foreignField: "_id",
          as: "modulDetails",
        },
      },
      { $unwind: "$modulDetails" },
      // 4. Bentuk output yang diinginkan
      {
        $project: {
          _id: 0,
          subject: "$modulDetails.title", // 'subject' digunakan oleh Recharts Radar Chart
          // Hitung rata-rata dengan penanganan bagi dengan nol
          topicScore: {
            $round: [
              { $cond: [{ $eq: ["$topicCount", 0] }, 0, { $divide: ["$topicTotalScore", "$topicCount"] }] },
              1
            ]
          },
          moduleScore: {
            $round: [
              { $cond: [{ $eq: ["$moduleCount", 0] }, 0, { $divide: ["$moduleTotalScore", "$moduleCount"] }] },
              1
            ]
          },
          fullMark: 100, // Nilai maksimal untuk skala radar
        },
      },
    ]);

    // --- 8. Analitik per Modul (untuk Tabel) ---
    // Pertama, hitung rata-rata waktu pengerjaan tes secara keseluruhan sebagai baseline
    const overallTestTimeStats = await Result.aggregate([
      { $match: { testType: { $in: ["post-test-topik", "post-test-modul"] } } },
      { $group: { _id: null, overallAverageTime: { $avg: "$timeTaken" } } }
    ]);
    const overallAverageTime = overallTestTimeStats.length > 0 ? overallTestTimeStats[0].overallAverageTime : 600; // Default 10 menit jika tidak ada data

    const moduleAnalytics = await Modul.aggregate([
      {
        $lookup: {
          from: "results",
          let: { modulId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$modulId", "$$modulId"] },
                    { $in: ["$testType", ["post-test-topik", "post-test-modul"]] }
                  ]
                }
              }
            },
            { $sort: { timestamp: -1 } },
            {
              $group: {
                _id: "$userId",
                latestScore: { $first: "$score" },
                averageTime: { $avg: "$timeTaken" }
              }
            }
          ],
          as: "studentResults"
        }
      },
      {
        $project: {
          _id: 0,
          moduleTitle: "$title",
          totalStudents: { $size: "$studentResults" },
          averageScore: {
            $cond: [{ $eq: [{ $size: "$studentResults" }, 0] }, 0, { $avg: "$studentResults.latestScore" }]
          },
          averageTime: {
            $cond: [{ $eq: [{ $size: "$studentResults" }, 0] }, 0, { $avg: "$studentResults.averageTime" }]
          },
          remedialStudentCount: {
            $size: {
              $filter: {
                input: "$studentResults",
                as: "res",
                cond: { $lt: ["$$res.latestScore", 70] }
              }
            }
          }
        }
      },
      {
        $addFields: {
          averageTimeInSeconds: { $round: ["$averageTime", 0] },
          averageScore: { $round: ["$averageScore", 1] },
          remedialRate: {
            $round: [
              {
                $cond: [
                  { $eq: ["$totalStudents", 0] }, 0,
                  { $multiply: [{ $divide: ["$remedialStudentCount", "$totalStudents"] }, 100] }
                ]
              },
              0
            ]
          },
          scorePoints: {
            $switch: {
              branches: [
                { case: { $lt: ["$averageScore", 65] }, then: 2 }, // Buruk
                { case: { $lt: ["$averageScore", 80] }, then: 1 }, // Sedang
              ],
              default: 0 // Baik
            }
          },
          timePoints: {
            $switch: {
              branches: [
                { case: { $gt: ["$averageTime", overallAverageTime * 1.4] }, then: 2 }, // Buruk (sangat lambat)
                { case: { $gt: ["$averageTime", overallAverageTime * 1.1] }, then: 1 }, // Sedang (agak lambat)
              ],
              default: 0 // Baik
            }
          },
        }
      },
      {
        $addFields: {
          remedialPoints: {
            $switch: {
              branches: [
                { case: { $gt: ["$remedialRate", 25] }, then: 2 },
                { case: { $gt: ["$remedialRate", 10] }, then: 1 },
              ],
              default: 0
            }
          }
        }
      },
      {
        $addFields: {
          weightedScore: {
            $add: [
              { $multiply: ["$scorePoints", 0.5] },
              { $multiply: ["$remedialPoints", 0.3] },
              { $multiply: ["$timePoints", 0.2] }
            ]
          }
        }
      }
    ]);

    // --- 9. Analitik per Topik (untuk Tabel) ---
    const topicAnalytics = await Result.aggregate([
      // Tahap 1: Filter hanya post-test-topik
      {
        $match: {
          testType: "post-test-topik",
          topikId: { $exists: true, $ne: null },
        },
      },
      // Tahap 2: Urutkan untuk mendapatkan skor terbaru per user per topik
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { topikId: "$topikId", userId: "$userId" },
          latestScore: { $first: "$score" },
          averageTime: { $avg: "$timeTaken" }
        }
      },
      // Tahap 3: Kelompokkan berdasarkan topik untuk agregasi
      {
        $group: {
          _id: "$_id.topikId",
          averageScore: { $avg: "$latestScore" },
          averageTime: { $avg: "$averageTime" },
          totalStudents: { $sum: 1 },
          remedialStudentCount: { // Tambahkan perhitungan remedialStudentCount
            $sum: { $cond: [{ $lt: ["$latestScore", 70] }, 1, 0] }
          }
        }
      },
      // Tahap 4: Lookup detail topik dan modul
      { $lookup: { from: "topiks", localField: "_id", foreignField: "_id", as: "topikDetails" } },
      { $unwind: "$topikDetails" },
      { $lookup: { from: "moduls", localField: "topikDetails.modulId", foreignField: "_id", as: "modulDetails" } },
      { $unwind: "$modulDetails" },
      // Tahap 5: Bentuk output akhir
      {
        $project: {
          _id: 0,
          topicTitle: "$topikDetails.title",
          moduleTitle: "$modulDetails.title",
          averageTimeInSeconds: { $round: ["$averageTime", 0] },
          averageScore: { $round: ["$averageScore", 1] },
          remedialRate: {
            $round: [
              { $cond: [
                  { $eq: ["$totalStudents", 0] }, 0, 
                  { $multiply: [{ $divide: ["$remedialStudentCount", "$totalStudents"] }, 100] }] },
              0
            ]
          },
          // Kalkulasi Skor Berbobot (sama seperti modul)
          scorePoints: { $switch: { branches: [ { case: { $lt: ["$averageScore", 65] }, then: 2 }, { case: { $lt: ["$averageScore", 80] }, then: 1 }, ], default: 0 } },
          timePoints: { $switch: { branches: [ { case: { $gt: ["$averageTime", overallAverageTime * 1.4] }, then: 2 }, { case: { $gt: ["$averageTime", overallAverageTime * 1.1] }, then: 1 }, ], default: 0 } },
        }
      },
      {
        $addFields: {
          remedialPoints: {
            $switch: {
              branches: [
                { case: { $gt: ["$remedialRate", 25] }, then: 2 },
                { case: { $gt: ["$remedialRate", 10] }, then: 1 },
              ],
              default: 0
            }
          }
        }
      },
      {
        $addFields: {
          weightedScore: { $add: [ { $multiply: ["$scorePoints", 0.5] }, { $multiply: ["$remedialPoints", 0.3] }, { $multiply: ["$timePoints", 0.2] } ] }
        }
      }
    ]);

    res.status(200).json({
      totalStudyHours,
      averageProgress,
      overallAverageScore,
      totalUsers,
      weakestTopicOverall,
      moduleLearningSpeed, // Tambahkan data baru ke respons
      moduleScoreDistribution,
      moduleAnalytics,
      topicAnalytics, // Tambahkan data analitik topik
    });

  } catch (error) {
    console.error("Error fetching admin analytics:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get a list of all users (for selection)
 * @route   GET /api/analytics/users-list
 * @access  Private (Admin)
 */
export const getUsersList = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('_id name').sort({ name: 1 });
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users list:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Get analytics data for a specific student
 * @route   GET /api/analytics/student-analytics/:userId
 * @access  Private (Admin)
 */
export const getStudentAnalytics = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'Siswa tidak ditemukan.' });
    }

    // 1. Progress Belajar
    const totalTopics = await Topik.countDocuments();
    const progress = totalTopics > 0 ? Math.round((user.topicCompletions.length / totalTopics) * 100) : 0;

    // 2. Rata-rata Waktu & Topik Terlemah
    const userTestResults = await Result.aggregate([
      { $match: { userId: user._id, testType: { $in: ["post-test-topik", "post-test-modul"] } } },
    ]);

    const averageTimeInSeconds = userTestResults.length > 0
      ? Math.round(userTestResults.reduce((sum, r) => sum + r.timeTaken, 0) / userTestResults.length)
      : 0;

    const topicResults = userTestResults.filter(r => r.testType === 'post-test-topik');
    let weakestTopic = null;
    if (topicResults.length > 0) {
      const weakestResult = topicResults.sort((a, b) => a.score - b.score)[0];
      const topicDetails = await Topik.findById(weakestResult.topikId).select('title');
      if (topicDetails) {
        weakestTopic = {
          topicTitle: topicDetails.title,
          score: weakestResult.score,
        };
      }
    }

    // 3. Ambil semua hasil tes topik siswa untuk digabungkan nanti
    const topicPerformances = await Result.aggregate([
      {
        $match: {
          userId: user._id,
          testType: "post-test-topik",
          topikId: { $exists: true, $ne: null }
        }
      },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$topikId",
          latestScore: { $first: "$score" },
          averageTime: { $avg: "$timeTaken" },
          modulId: { $first: "$modulId" } // Ambil modulId
        }
      },
      { $lookup: { from: "topiks", localField: "_id", foreignField: "_id", as: "topicDetails" } },
      { $unwind: "$topicDetails" }
    ]);
    const topicPerformancesMap = new Map(topicPerformances.map(p => [p._id.toString(), p]));

    // 3. Detail Performa per Modul
     const performanceByModule = await Result.aggregate([
       {
         $match: {
           userId: user._id,
           modulId: { $exists: true, $ne: null },
           testType: { $in: ["post-test-topik", "post-test-modul"] }
         }
       },
       { $sort: { timestamp: -1 } },
       {
         $group: {
           _id: "$modulId",
           // Ambil skor tes modul terbaru
           moduleScore: {
             $first: { $cond: [{ $eq: ["$testType", "post-test-modul"] }, "$score", "$$REMOVE"] }
           },
           // Hitung skor rata-rata tes topik
           avgTopicScore: {
             $avg: { $cond: [{ $eq: ["$testType", "post-test-topik"] }, "$score", "$$REMOVE"] }
           },
           // Hitung waktu rata-rata dari semua tes di modul
           averageTime: { $avg: "$timeTaken" },
           // Kumpulkan semua ID topik yang dikerjakan dalam modul ini
           topicIds: {
             $addToSet: {
               $cond: [
                 { $eq: ["$testType", "post-test-topik"] },
                 "$topikId",
                 "$$REMOVE"
               ]
             }
           }
         }
       },
       { $lookup: { from: "moduls", localField: "_id", foreignField: "_id", as: "modulDetails" } },
       { $unwind: "$modulDetails" },
       {
         $project: {
           _id: 0,
           moduleTitle: "$modulDetails.title",
           moduleId: "$_id", // Kirim ID modul untuk pencocokan
           moduleScore: { $ifNull: [{ $round: ["$moduleScore", 0] }, 0] },
           topicScore: { $ifNull: [{ $round: ["$avgTopicScore", 0] }, 0] },
           timeInSeconds: { $round: ["$averageTime", 0] },
           topicIds: 1 // Teruskan ID topik
         }
       },
       { $sort: { moduleTitle: 1 } }
     ]);

    // Gabungkan data topik ke dalam data modul
    const detailedPerformance = performanceByModule.map(modulePerf => {
      const topics = (modulePerf.topicIds || [])
        .map((topicId) => {
          const topicData = topicPerformancesMap.get(topicId.toString());
          if (!topicData) return null;
          return {
            topicTitle: topicData.topicDetails.title,
            score: Math.round(topicData.latestScore),
            timeInSeconds: Math.round(topicData.averageTime),
          };
        })
        .filter(Boolean); // Hapus entri null
      return { ...modulePerf, topics };
    });

    res.status(200).json({
      progress,
      averageTimeInSeconds,
      weakestTopic,
      detailedPerformance: detailedPerformance.map(({ moduleId, topicIds, ...rest }) => rest), // Hapus properti internal
    });

  } catch (error) {
    console.error("Error fetching student analytics:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};