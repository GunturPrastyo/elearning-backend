import express from "express";
import { getTopik, getTopikByModul, createTopik, deleteTopik, getTopikBySlugs, updateTopikOrder } from "../controllers/topikController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getTopik);
router.put("/update-order", protect, admin, updateTopikOrder);
router.get("/modul/:modulId", getTopikByModul); 
router.get("/modul-slug/:modulSlug/topik-slug/:topikSlug", getTopikBySlugs); 
router.post("/", createTopik);
router.delete("/:id", deleteTopik);

export default router;
