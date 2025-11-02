import express from "express";
import {

  getMateriBySlugs,
  saveMateri,
} from "../controllers/materiController.js";

import { protect, admin } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Rute untuk mengambil materi, bisa diakses oleh user yang login
router.get("/modul/:modulSlug/topik/:topikSlug", getMateriBySlugs);

// Rute untuk menyimpan (create/update) materi, hanya untuk admin
router.post("/save", protect, admin, saveMateri);

export default router;
