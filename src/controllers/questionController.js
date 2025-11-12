import Question from "../models/Question.js";
import mongoose from "mongoose";

// ✅ Create Multiple Questions
export const createQuestion = async (req, res) => {
  try {
    const { modulId, topikId, questions, testType } = req.body;

    if (!questions || questions.length === 0) {
      return res.status(400).json({ message: "Pertanyaan tidak boleh kosong." });
    }

    // Simpan semua pertanyaan
    const createdQuestions = await Promise.all(
      questions.map((q) => {
        const questionData = {
          questionText: q.questionText,
          options: q.options,
          answer: q.answer,
          modulId: modulId || null,
          topikId: topikId || null,
          testType,
          durationPerQuestion: q.durationPerQuestion || 60, // Simpan durasi
          subMateriId: q.subMateriId || null, // Simpan subMateriId
        };
        return Question.create(questionData);
      })
    );

    res.status(201).json({
      message: `Pertanyaan ${testType} berhasil disimpan.`,
      data: createdQuestions,
    });
  } catch (error) {
    console.error("Error createQuestion:", error);
    res.status(500).json({ message: "Gagal menyimpan pertanyaan.", error });
  }
};

// ✅ Get all Questions
export const getQuestions = async (req, res) => {
  try {
    const questions = await Question.find()
      .populate("modulId", "title")
      .populate("topikId", "title")
      .populate("testId", "title type");

    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ Get Question by ID
export const getQuestionById = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id)
      .populate("modulId", "title")
      .populate("topikId", "title")
      .populate("testId", "title type");

    if (!question)
      return res.status(404).json({ message: "Question not found" });

    res.json(question);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Get all global pre-test questions
 * @route   GET /api/questions/pre-test
 * @access  Public
 */
export const getPreTestQuestions = async (req, res) => {
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
};

/**
 * @desc    Update all global pre-test questions
 * @route   PUT /api/questions/pre-test
 * @access  Private/Admin
 */
export const updatePreTestQuestions = async (req, res) => {
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
};

/**
 * @desc    Get all module post-test questions
 * @route   GET /api/questions/post-test-modul/:modulId
 * @access  Private
 */
export const getPostTestModulQuestions = async (req, res) => {
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
};

/**
 * @desc    Update all module post-test questions
 * @route   PUT /api/questions/post-test-modul/:modulId
 * @access  Private/Admin
 */
export const updatePostTestModulQuestions = async (req, res) => {
  try {
    const { modulId } = req.params;
    const { questions } = req.body;

    // Validasi input
    if (!modulId || !mongoose.Types.ObjectId.isValid(modulId)) {
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
};

// 🔹 Cek post-test berdasarkan modulId & topikId
export const checkPostTestByModulAndTopik = async (req, res) => {
  try {
    const { modulId, topikId } = req.params;

    const postTest = await Question.findOne({
      modulId,
      topikId,
      testType: "post-test-topik"
    });

    res.json({ exists: !!postTest });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * @desc    Cek post-test berdasarkan modulId
 * @route   GET /api/questions/check-modul-test/:modulId
 * @access  Private/Admin
 */
export const checkPostTestByModul = async (req, res) => {
  try {
    const { modulId } = req.params;
    const postTest = await Question.findOne({
      modulId,
      testType: "post-test-modul",
    });
    res.json({ exists: !!postTest });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// ✅ Update Question
export const updateQuestion = async (req, res) => {
  try {
    const { questions } = req.body;
    const { modulId, topikId } = req.params;

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ message: "Format data pertanyaan tidak valid." });
    }

    // Hapus pertanyaan lama yang terkait dengan topik ini
    await Question.deleteMany({ modulId, topikId, testType: "post-test-topik" });

    // Buat pertanyaan baru dengan data yang diperbarui (termasuk durasi dan subMateriId)
    const newQuestions = questions.map(q => ({
      ...q,
      modulId,
      topikId,
      testType: "post-test-topik",
      durationPerQuestion: q.durationPerQuestion || 60,
      subMateriId: q.subMateriId || null,
    }));

    const createdQuestions = await Question.insertMany(newQuestions);

    res.status(200).json({ message: "Post test berhasil diperbarui", data: createdQuestions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ Delete Question
export const deleteQuestion = async (req, res) => {
  try {
    const deleted = await Question.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Question not found" });

    res.json({ message: "Question deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Get all questions for a specific topic post-test (for editing)
 * @route   GET /api/questions/post-test-topik/:modulId/:topikId
 * @access  Private/Admin
 */
export const getPostTestTopikQuestions = async (req, res) => {
  try {
    const { modulId, topikId } = req.params;

    const questions = await Question.find({
      modulId,
      topikId,
      testType: "post-test-topik",
    }).select("+answer"); // <-- Kunci perbaikan ada di sini

    if (!questions || questions.length === 0) {
      // Bukan error jika belum ada soal, kirim array kosong
      return res.status(200).json({ questions: [] });
    }

    res.status(200).json({ questions });
  } catch (error) {
    console.error("Error getting questions by topic:", error);
    res.status(500).json({ message: "Gagal mengambil data soal." });
  }
};

/**
 * @desc    Update all topic post-test questions
 * @route   PUT /api/questions/post-test-topik/:modulId/:topikId
 * @access  Private/Admin
 */
export const updatePostTestTopikQuestions = async (req, res) => {
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
};
