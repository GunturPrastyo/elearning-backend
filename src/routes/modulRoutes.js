import express from "express";
import { getModules, getModuleById, createModule, updateModul, deleteModul, getModulesWithProgress, getModuleDetailsForUser } from "../controllers/modulController.js";
import { upload } from "../middlewares/upload.js";
import { protect, admin } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getModules); // <-- Tambahkan 'protect' untuk konsistensi
router.get("/progress", protect, getModulesWithProgress); // Rute untuk user melihat modul dengan progres
router.get("/user-view/:slug", protect, getModuleDetailsForUser); // Rute untuk halaman detail modul user
router.get("/:idOrSlug", getModuleById);
router.post("/", protect, admin, upload.single("icon"), createModule);
router.put("/:id", protect, admin, upload.single("icon"), updateModul);
router.delete("/:id", protect, admin, deleteModul); // Tambahkan middleware protect dan admin

export default router;
