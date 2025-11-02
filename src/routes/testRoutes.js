import express from "express";
import { createQuestion, getQuestions, getQuestionById, checkPostTestByModulAndTopik } from "../controllers/questionController.js";
import Question from "../models/Question.js";

const router = express.Router();

// ✅ Ambil semua soal pre-test global
router.get("/pre-test", async (req, res) => {
  try {
    const questions = await Question.find({
      testType: "pre-test-global",
    });
    // Mengembalikan array kosong jika tidak ada, dan array berisi soal jika ada.
    res.json({ questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data pre-test" });
  }
});

// ✅ Update semua soal pre-test global
router.put("/pre-test", async (req, res) => {
  try {
    const { questions } = req.body;

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ message: "Data soal tidak valid." });
    }

    // Hapus semua soal pre-test lama
    await Question.deleteMany({ testType: "pre-test-global" });

    // Simpan ulang soal baru
    const inserted = await Question.insertMany(
      questions.map((q) => ({ ...q, testType: "pre-test-global" }))
    );

    res.json({ message: "Pre-test berhasil diperbarui", data: inserted });
  } catch (err) {
    console.error("❌ Gagal memperbarui pre-test:", err);
    res.status(500).json({ message: "Gagal memperbarui pre-test." });
  }
});

// ✅ Post test per modul
router.post("/post-test-modul", createQuestion);

// ✅ Post test per topik
router.post("/post-test-topik", createQuestion);

// optional: routes untuk get/update/delete
router.get("/", getQuestions);
router.get("/:id", getQuestionById);

// ✅ Cek apakah modul sudah punya post test
router.get("/check/:modulId", async (req, res) => {
  try {
    const postTest = await Question.findOne({
      modulId: req.params.modulId,
      testType: "post-test-modul"
    });

    res.json({ exists: !!postTest });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/check/:modulId/:topikId", checkPostTestByModulAndTopik);

// ✅ Ambil semua soal post-test modul
router.get("/post-test-modul/:modulId", async (req, res) => {
  try {
    const questions = await Question.find({
      modulId: req.params.modulId,
      testType: "post-test-modul",
    });
    res.json({ questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data post test modul" });
  }
});

// ✅ Update semua soal post-test modul
router.put("/post-test-modul/:modulId", async (req, res) => {
  try {
    const { modulId } = req.params;
    const { questions } = req.body;

    // Validasi input
    if (!modulId || modulId === 'undefined') {
      return res.status(400).json({ message: "Modul ID tidak valid atau tidak ada." });
    }

    // Hapus semua soal lama dulu
    await Question.deleteMany({ modulId: modulId, testType: "post-test-modul" });

    // Simpan ulang soal baru
    const inserted = await Question.insertMany(
      questions.map((q) => ({
        ...q,
        modulId: req.params.modulId,
        testType: "post-test-modul",
      })),
    );

    res.json({ message: "Post test modul diperbarui", data: inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal memperbarui post test modul" });
  }
});

// ✅ Ambil semua soal post-test topik
router.get("/post-test-topik/:modulId/:topikId", async (req, res) => {
  try {
    const { modulId, topikId } = req.params;
    const questions = await Question.find({
      modulId,
      topikId,
      testType: "post-test-topik",
    });

    if (!questions.length) {
      return res.status(404).json({ message: "Belum ada soal post test untuk topik ini." });
    }

    res.json({ questions });
  } catch (err) {
    console.error("❌ Gagal mengambil post test topik:", err);
    res.status(500).json({ message: "Gagal mengambil data post test topik." });
  }
});

// ✅ Update semua soal post-test topik
router.put("/post-test-topik/:modulId/:topikId", async (req, res) => {
  try {
    const { modulId, topikId } = req.params;
    const { questions } = req.body;

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ message: "Data soal tidak valid." });
    }

    // Hapus semua soal lama untuk topik ini
    await Question.deleteMany({ modulId, topikId, testType: "post-test-topik" });

    // Simpan ulang soal baru
    const inserted = await Question.insertMany(
      questions.map((q) => ({
        ...q,
        modulId,
        topikId,
        testType: "post-test-topik",
      }))
    );

    res.json({ message: "Post test topik diperbarui", data: inserted });
  } catch (err) {
    console.error("❌ Gagal memperbarui post test topik:", err);
    res.status(500).json({ message: "Gagal memperbarui post test topik." });
  }
});


export default router;
