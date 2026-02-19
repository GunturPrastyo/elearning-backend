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
    getClassWeeklyActivity,
    getModuleScores,
    getComparisonAnalytics,
    getLearningRecommendations,
    getTopicsToReinforce,
    saveProgress,
    getProgress,
    getLatestResultByTopic,
    getLatestResultByType,
    generateCertificate,
    deleteResultByType,
    deleteProgress,
    getCompetencyMap,
    checkPreTestStatus,
    getStreakLeaderboard,
    getUserStatus,
    updateUserStatus,
 } from "../controllers/resultController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";

router.route("/by-type/:testType").delete(protect, deleteResultByType);

router.route("/latest-by-type/:testType").get(protect, getLatestResultByType);
router.route("/latest-by-topic").get(protect, getLatestResultByTopic);

router.route("/certificate").get(protect, generateCertificate); 
router.route("/progress")
    .get(protect, getProgress)
    .post(protect, saveProgress)
    .delete(protect, deleteProgress); 

router.route("/log-study-time").post(protect, logStudyTime);
router.route("/study-time").get(protect, getStudyTime);
router.route("/streak-leaderboard").get(protect, getStreakLeaderboard);
router.route("/submit-test").post(protect, submitTest);
router.route("/user/:userId").get(protect, getResultsByUser);

router.route("/").get(protect, admin, getResults).post(protect, createResult);

router.route("/analytics").get(protect, getAnalytics);
router.route("/weekly-activity").get(protect, getWeeklyActivity);
router.route("/class-weekly-activity").get(protect, getClassWeeklyActivity);
router.route("/module-scores").get(protect, getModuleScores);
router.route("/comparison-analytics").get(protect, getComparisonAnalytics);
router.route("/recommendations").get(protect, getLearningRecommendations);
router.route("/topics-to-reinforce").get(protect, getTopicsToReinforce);
router.route("/streak").get(protect, getDailyStreak); 
router.route("/check-pre-test").get(protect, checkPreTestStatus);
router.route("/user-status").get(protect, getUserStatus).put(protect, updateUserStatus);

export default router;