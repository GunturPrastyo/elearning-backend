import Materi from "../models/Materi.js";
import vm from "vm";
import Result from "../models/Result.js";
import User from "../models/User.js";

export const getPraktikByTopicId = async (req, res) => {
  try {
    const { topicId } = req.params;
    // Karena practices adalah array di dalam model Materi
    const materi = await Materi.findOne({ topikId: topicId }).select("practices").lean();
    
    if (!materi || !materi.practices) {
      return res.status(200).json([]);
    }

    const results = await Result.find({
      userId: req.user._id,
      topikId: topicId,
      testType: "praktik"
    });

    const completedPracticeIds = new Set(results.map(r => r.practiceId.toString()));

    const practicesWithStatus = materi.practices.map(p => ({
      ...p,
      isCompleted: completedPracticeIds.has(p._id.toString())
    }));

    res.status(200).json(practicesWithStatus);
  } catch (error) {
    console.error("Gagal mengambil data praktik:", error);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
};

export const runPractice = async (req, res) => {
  try {
    const { practiceId, code, type } = req.body;

    // Cari materi yang memiliki practice dengan ID tersebut
    const materi = await Materi.findOne({ "practices._id": practiceId });
    if (!materi) {
      return res.status(404).json({ message: "Praktik tidak ditemukan." });
    }

    // Ambil detail praktik yang spesifik
    const practice = materi.practices.find(p => p._id.toString() === practiceId);
    
    let isAnswerCorrect = false;
    let outputLogs = [];

    // Fungsi validasi berdasarkan Regex/Keyword
    const validateCode = (codeToCheck, logs) => {
      if (!practice.expectedOutputRegex || practice.expectedOutputRegex.length === 0) return true;
      
      const normalizedCode = codeToCheck.replace(/\s+/g, '').toLowerCase();
      const joinedLogs = logs.join(' ').replace(/\s+/g, '').toLowerCase();

      return practice.expectedOutputRegex.every(keyword => {
        const normalizedKeyword = keyword.replace(/\s+/g, '').toLowerCase();
        return normalizedCode.includes(normalizedKeyword) || joinedLogs.includes(normalizedKeyword);
      });
    };

    // Eksekusi jika Javascript
    if (type === 'javascript') {
      const sandbox = {
        console: {
          log: (...args) => outputLogs.push(args.map(a => String(a)).join(' ')),
          error: (...args) => outputLogs.push('Error: ' + args.join(' '))
        }
      };
      
      try {
        vm.createContext(sandbox);
        vm.runInContext(code, sandbox, { timeout: 2000 }); // Timeout 2 detik untuk mencegah infinite loop
        
        if (validateCode(code, outputLogs)) {
          isAnswerCorrect = true;
          outputLogs.push("✅ Jawaban Benar!");
        } else {
          isAnswerCorrect = true; // Abaikan jika validasi gagal
          outputLogs.push("✅ Jawaban Benar! (Validasi diabaikan)");
        }
      } catch (err) {
        // Sesuai permintaan, jika error adalah kesalahan sintaks (seperti kurang titik koma), anggap benar.
        if (err instanceof SyntaxError) {
          isAnswerCorrect = true;
          outputLogs.push("✅ Jawaban Benar! (Kesalahan sintaks diabaikan)");
          outputLogs.push(`(Info Error: ${err.message})`);
        } else {
          // Untuk error runtime lain (bukan sintaks), tetap tampilkan sebagai kesalahan
          isAnswerCorrect = false;
          outputLogs.push(err.toString());
        }
      }
    } else if (type === 'html') {
      // Untuk HTML, kita hanya memvalidasi sintaks yang ditulis
      if (validateCode(code, [])) {
        isAnswerCorrect = true;
        outputLogs.push("✅ Jawaban Benar!");
      } else {
        isAnswerCorrect = true; // Abaikan jika validasi gagal
        outputLogs.push("✅ Jawaban Benar! (Validasi diabaikan)");
      }
    }

    // Jika jawaban benar, simpan nilai keberhasilan ke dalam koleksi Result
    if (isAnswerCorrect) {
      await Result.findOneAndUpdate(
        { userId: req.user._id, practiceId: practiceId, testType: "praktik" },
        {
          userId: req.user._id,
          practiceId: practiceId,
          testType: "praktik",
          score: 100,
          correct: 1,
          total: 1,
          timeTaken: 0, // Set default 0 atau sesuaikan bila kamu melacak timer di frontend
          topikId: materi.topikId,
          modulId: materi.modulId
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Tandai topik ini sebagai selesai untuk membuka kunci topik selanjutnya
      await User.findByIdAndUpdate(req.user._id, {
        $addToSet: { topicCompletions: materi.topikId }
      });
    }

    return res.status(200).json({
      isCorrect: isAnswerCorrect,
      output: outputLogs
    });

  } catch (error) {
    console.error("Gagal mengeksekusi praktik:", error);
    return res.status(500).json({ message: "Terjadi kesalahan pada server saat mengeksekusi kode." });
  }
};