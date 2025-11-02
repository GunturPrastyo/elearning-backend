import multer from "multer";
import path from "path";
import fs from "fs";

// Tentukan folder penyimpanan
const uploadFolder = path.join(process.cwd(), "public", "uploads");

// Buat folder jika belum ada
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

// Konfigurasi penyimpanan file
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  },
});

// Filter hanya file gambar yang diperbolehkan
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Hanya file gambar yang diperbolehkan"), false);
  }
};

// Ekspor sebagai named export
export const upload = multer({ storage, fileFilter });
