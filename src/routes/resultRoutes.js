import express from "express";
const router = express.Router();
import { 
    createResult, 
    getResults, 
    getResultsByUser, 
    submitTest, 
    logStudyTime, 
    getStudyTime, 
    getAnalytics, 
    getDailyStreak, 
    getWeeklyActivity, 
    getModuleScores, 
    getComparisonAnalytics, 
    getLearningRecommendations, 
    getTopicsToReinforce, 
    saveProgress, 
    getProgress, 
    getLatestResultByTopic,
    getLatestResultByType,
    deleteProgress // Import controller yang hilang
} from "../controllers/resultController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";

// Rute untuk mengambil hasil tes terakhir berdasarkan tipenya
router.route("/latest-by-type/:testType").get(protect, getLatestResultByType);
router.route("/latest-by-topic").get(protect, getLatestResultByTopic);

// Gabungkan semua metode untuk path '/progress'
router.route("/progress")
    .get(protect, getProgress)
    .post(protect, saveProgress)
    .delete(protect, deleteProgress); // Tambahkan metode DELETE yang hilang

router.route("/log-study-time").post(protect, logStudyTime);
router.route("/study-time").get(protect, getStudyTime);
router.route("/submit-test").post(protect, submitTest);
router.route("/user/:userId").get(protect, getResultsByUser);

// Gabungkan semua metode untuk path root '/'
router.route("/").get(protect, admin, getResults).post(protect, createResult);

router.route("/analytics").get(protect, getAnalytics);
router.route("/weekly-activity").get(protect, getWeeklyActivity);
router.route("/module-scores").get(protect, getModuleScores);
router.route("/comparison-analytics").get(protect, getComparisonAnalytics);
router.route("/recommendations").get(protect, getLearningRecommendations);
router.route("/topics-to-reinforce").get(protect, getTopicsToReinforce);
router.route("/streak").get(protect, getDailyStreak); // <-- Tambahkan rute yang hilang

// Tambahkan rute-rute Anda yang lain di sini...

export default router;