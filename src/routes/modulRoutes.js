import express from "express";
import {
  getModules,
  getModuleById,
  createModule,
  updateModul,
  deleteModul,
  getModulesWithProgress,
  getModuleDetailsForUser,
  updateModulOrder, // <-- Impor fungsi baru
} from "../controllers/modulController.js";
import { protect, admin } from "../middlewares/authMiddleware.js"; // Asumsi middleware ada di sini
import upload from "../middlewares/multerMiddleware.js"; // Asumsi middleware upload ada di sini

const router = express.Router();

// Rute untuk user
router.get("/progress", protect, getModulesWithProgress);
router.get("/user-view/:slug", protect, getModuleDetailsForUser);

// Rute untuk admin
router.get("/", protect, admin, getModules);
router.post("/", protect, admin, upload.single("icon"), createModule);
router.put("/update-order", protect, admin, updateModulOrder); // Rute spesifik harus di atas
router.get("/:idOrSlug", protect, admin, getModuleById); // Rute dinamis/umum di bawah
router.put("/:id", protect, admin, upload.single("icon"), updateModul);
router.delete("/:id", protect, admin, deleteModul);

export default router;