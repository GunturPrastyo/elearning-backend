import express from "express";
import {
  createQuestion,
  getQuestions,
  getQuestionById,
  checkPostTestByModulAndTopik,
  checkPostTestByModul,
  getPreTestQuestions,
  updatePreTestQuestions,
  getPostTestModulQuestions,
  updatePostTestModulQuestions,
  getPostTestTopikQuestions,
  updatePostTestTopikQuestions,
  
} from "../controllers/questionController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// --- Rute Publik ---
router.route("/pre-test")
  .get(getPreTestQuestions);


router.use(protect);

// --- Rute Generik ---
router.route("/")
  .get(getQuestions) // Ambil semua soal (admin)
  .post(createQuestion); // Buat soal baru (admin)

router.route("/:id")
  .get(getQuestionById); // Ambil soal by ID (admin)

// --- Rute Pre-Test (Update) ---
router.route("/pre-test")
  .put(updatePreTestQuestions); 

// --- Rute Post-Test Modul ---
router.route("/post-test-modul")
  .post(createQuestion); 

router.route("/post-test-modul/:modulId")
  .get(getPostTestModulQuestions) // Ambil soal post-test modul (admin/user)
  .put(updatePostTestModulQuestions); // Update soal post-test modul (admin)

// --- Rute Post-Test Topik ---
router.route("/post-test-topik")
  .post(createQuestion); // Buat soal post-test topik (admin)

router.route("/post-test-topik/:modulId/:topikId")
  .get(getPostTestTopikQuestions) // Ambil soal post-test topik (admin/user)
  .put(updatePostTestTopikQuestions); // Update soal post-test topik (admin)

// --- Rute Pengecekan (Check) ---
router.get("/check/:modulId", checkPostTestByModul); // Cek apakah modul punya post-test
router.get("/check/:modulId/:topikId", checkPostTestByModulAndTopik); // Cek apakah topik punya post-test

export default router;
