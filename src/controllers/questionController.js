import Question from "../models/Question.js";

// ✅ Create Multiple Questions
export const createQuestion = async (req, res) => {
  try {
    const { modulId, topikId, questions, testType } = req.body;

    if (!questions || questions.length === 0) {
      return res.status(400).json({ message: "Pertanyaan tidak boleh kosong." });
    }

    // Simpan semua pertanyaan
    const createdQuestions = await Promise.all(
      questions.map((q) =>
        Question.create({
          ...q,
          modulId: modulId || null,
          topikId: topikId || null,
          testType,
        })
      )
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


// ✅ Update Question
export const updateQuestion = async (req, res) => {
  try {
    const updated = await Question.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updated) return res.status(404).json({ message: "Question not found" });

    res.json({ message: "Question updated successfully", question: updated });
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
