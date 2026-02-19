import express from "express";
import {
  getAdminAnalytics,
  getUsersList,
  getStudentAnalytics,
  getModuleLeaderboard,
} from "../controllers/analiticController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect, admin);

router.route("/admin-analytics").get(protect, admin, getAdminAnalytics);
router.route("/users-list").get(getUsersList);
router.route("/student-analytics/:userId").get(getStudentAnalytics);
router.route("/module-leaderboard").get(getModuleLeaderboard);

export default router;