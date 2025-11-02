import express from "express";
import { getTopik, getTopikByModul, createTopik, deleteTopik, getTopikBySlugs } from "../controllers/topikController.js";

const router = express.Router();

router.get("/", getTopik);
// router.get("/:idOrSlug", getTopikById);
router.get("/modul/:modulId", getTopikByModul); // ✅ Tambahan ini
router.get("/modul-slug/:modulSlug/topik-slug/:topikSlug", getTopikBySlugs); // ✅ Tambahan ini
router.post("/", createTopik);
router.delete("/:id", deleteTopik);

export default router;
