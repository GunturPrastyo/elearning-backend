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
    getLatestResultByType // <-- Pastikan ini di-import
} from "../controllers/resultController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";

// Rute untuk mengambil hasil tes terakhir berdasarkan tipenya
router.route("/latest-by-type/:testType").get(protect, getLatestResultByType);
router.route("/latest-by-topic").get(protect, getLatestResultByTopic);
router.route("/progress").post(protect, saveProgress);
router.route("/progress").get(protect, getProgress);
router.route("/log-study-time").post(protect, logStudyTime);
router.route("/study-time").get(protect, getStudyTime);
router.route("/submit-test").post(protect, submitTest);
router.route("/user/:userId").get(protect, getResultsByUser);
router.route("/").post(protect, createResult);
router.route("/").get(protect, admin, getResults); // Hanya admin yang bisa melihat semua hasil
router.route("/analytics").get(protect, getAnalytics);
router.route("/weekly-activity").get(protect, getWeeklyActivity);
router.route("/module-scores").get(protect, getModuleScores);
router.route("/comparison-analytics").get(protect, getComparisonAnalytics);
router.route("/recommendations").get(protect, getLearningRecommendations);
router.route("/topics-to-reinforce").get(protect, getTopicsToReinforce);
router.route("/streak").get(protect, getDailyStreak);

// Tambahkan rute-rute Anda yang lain di sini...

export default router;