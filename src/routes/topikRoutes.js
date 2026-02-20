import express from "express";
import { getTopik, getTopikByModul, createTopik, deleteTopik, getTopikBySlugs, updateTopikOrder, updateTopik } from "../controllers/topikController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getTopik);
router.put("/update-order", protect, admin, updateTopikOrder);
router.get("/modul/:modulId", getTopikByModul); 
router.get("/modul-slug/:modulSlug/topik-slug/:topikSlug", getTopikBySlugs); 
router.post("/", createTopik);
router.put("/:id", protect, admin, updateTopik);
router.delete("/:id", deleteTopik);

export default router;
