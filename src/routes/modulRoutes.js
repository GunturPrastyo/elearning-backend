import express from "express";
import {
  getModules,
  getModuleById,
  createModule,
  updateModul,
  deleteModul,
  getModulesWithProgress,
  getModuleDetailsForUser,
  updateModulOrder,
  getModuleFeatureWeights,
  updateModuleFeatureWeights,
} from "../controllers/modulController.js";
import { protect, admin } from "../middlewares/authMiddleware.js"; // Asumsi middleware ada di sini
import { upload } from "../middlewares/upload.js";

const router = express.Router();

// Rute untuk user
router.get("/progress", protect, getModulesWithProgress);
router.get("/user-view/:slug", protect, getModuleDetailsForUser);

// Rute untuk admin
router.get("/", protect, admin, getModules);
router.post("/", protect, admin, upload.single("icon"), createModule);
router.put("/update-order", protect, admin, updateModulOrder); // Rute spesifik harus di atas
router.get("/byslug/:slug", protect, admin, getModuleById); // Rute eksplisit untuk slug
router.get("/:idOrSlug", protect, admin, getModuleById); // Rute dinamis/umum di bawah
router.put("/:id", protect, admin, upload.single("icon"), updateModul);

// Rute untuk mengelola fitur pada modul
router.route("/:id/feature-weights")
  .get(protect, admin, getModuleFeatureWeights)
  .put(protect, admin, updateModuleFeatureWeights);

router.delete("/:id", protect, admin, deleteModul);

export default router;