import express from "express";
import {
  getFeatures,
  createFeature,
  updateFeature,
  deleteFeature,
} from "../controllers/featureController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.route("/").get(protect, getFeatures).post(protect, admin, createFeature);
router
  .route("/:id")
  .put(protect, admin, updateFeature)
  .delete(protect, admin, deleteFeature);

export default router;