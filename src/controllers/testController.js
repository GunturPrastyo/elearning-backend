import Question from "../models/Question.js";
import mongoose from "mongoose";

/**
 * @desc    Get questions for a specific context (pre-test-global, post-test-modul, post-test-topik)
 * @route   GET /api/questions/:testType/:modulId?/:topikId?
 * @access  Private
 */
export const getQuestions = async (req, res) => {
  try {
    const { testType, modulId, topikId } = req.params;

    // Remap 'pre-test-global' from the route to 'pre-test' for DB query
    const queryTestType = testType === 'pre-test-global' ? 'pre-test' : testType;

    const query = { testType: queryTestType };
    if (modulId) {
      if (!mongoose.Types.ObjectId.isValid(modulId)) {
        return res.status(400).json({ message: "Modul ID tidak valid." });
      }
      query.modulId = modulId;
    }
    if (topikId) {
      if (!mongoose.Types.ObjectId.isValid(topikId)) {
        return res.status(400).json({ message: "Topik ID tidak valid." });
      }
      query.topikId = topikId;
    }

    const questions = await Question.find(query);

    if (!questions || questions.length === 0) {
      return res.status(404).json({ message: "Tidak ada soal yang ditemukan untuk konteks ini." });
    }

    res.status(200).json({ questions });
  } catch (error) {
    console.error("Gagal mengambil soal tes:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

/**
 * @desc    Upsert (create or update) questions for a test.
 *          This single endpoint handles creating new questions and updating existing ones.
 * @route   PUT /api/questions/:testType/:modulId?/:topikId?
 * @access  Private/Admin
 */
export const upsertQuestions = async (req, res) => {
  try {
    const { testType, modulId, topikId } = req.params;
    const { questions } = req.body;

    if (!testType || !Array.isArray(questions)) {
      return res.status(400).json({ message: "Test type and questions array are required." });
    }

    const contextQuery = { testType };
    if (modulId) contextQuery.modulId = modulId;
    if (topikId) contextQuery.topikId = topikId;

    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const existingQuestions = await Question.find(contextQuery).session(session);
      const existingQuestionIds = new Set(existingQuestions.map(q => q._id.toString()));
      const incomingQuestionIds = new Set(questions.filter(q => q._id).map(q => q._id));

      // 1. Delete questions that are no longer in the list
      const questionsToDelete = [...existingQuestionIds].filter(id => !incomingQuestionIds.has(id));
      if (questionsToDelete.length > 0) {
        await Question.deleteMany({ _id: { $in: questionsToDelete } }).session(session);
      }

      // 2. Update existing questions and create new ones
      const upsertOperations = questions.map(q => {
        const questionData = {
          ...contextQuery,
          questionText: q.questionText,
          options: q.options,
          answer: q.answer,
          code: q.code,
        };

        if (q._id) {
          // Update existing question
          return {
            updateOne: {
              filter: { _id: q._id },
              update: { $set: questionData },
            },
          };
        } else {
          // Insert new question
          return {
            insertOne: {
              document: questionData,
            },
          };
        }
      });

      if (upsertOperations.length > 0) {
        await Question.bulkWrite(upsertOperations, { session });
      }
    });

    session.endSession();

    res.status(200).json({ message: "Test questions saved successfully." });
  } catch (error) {
    console.error("Error upserting questions:", error);
    res.status(500).json({ message: "Server error while saving questions." });
  }
};

/**
 * @desc    Delete all questions for a specific test context.
 * @route   DELETE /api/questions/:testType/:modulId?/:topikId?
 * @access  Private/Admin
 */
export const deleteTest = async (req, res) => {
  try {
    const { testType, modulId, topikId } = req.params;

    const contextQuery = { testType };
    if (modulId) contextQuery.modulId = modulId;
    if (topikId) contextQuery.topikId = topikId;

    const { deletedCount } = await Question.deleteMany(contextQuery);

    if (deletedCount === 0) {
      return res.status(404).json({ message: "No test found to delete for this context." });
    }

    res.status(200).json({ message: `Successfully deleted ${deletedCount} questions.` });
  } catch (error) {
    console.error("Error deleting test questions:", error);
    res.status(500).json({ message: "Server error while deleting questions." });
  }
};
