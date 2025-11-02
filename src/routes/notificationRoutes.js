import express from "express";
import {
  getNotifications,
  createNotification,
  markAsRead,
  deleteNotification,
} from "../controllers/notificationController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.route("/").get(protect, getNotifications).post(protect, createNotification);
router.route("/read").put(protect, markAsRead);
router.route("/:id").delete(protect, deleteNotification);

export default router;