import express from "express";
import { getModules, getModuleById, createModule, updateModul, deleteModul, getModulesWithProgress, getModuleDetailsForUser } from "../controllers/modulController.js";
import { upload } from "../middlewares/upload.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getModules);
router.get("/progress", protect, getModulesWithProgress); // Rute untuk user melihat modul dengan progres
router.get("/user-view/:slug", protect, getModuleDetailsForUser); // Rute untuk halaman detail modul user
router.get("/:idOrSlug", getModuleById);
router.post("/", upload.single("icon"), createModule);
router.put("/:id", upload.single("icon"), updateModul);
router.delete("/:id", deleteModul); // Tambahkan route DELETE

export default router;
