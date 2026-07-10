import multer from 'multer';
import path from 'path';

// Menggunakan memoryStorage agar file buffer bisa diakses untuk diunggah ke Vercel Blob
const storage = multer.memoryStorage();

// Fungsi untuk memfilter tipe file (hanya gambar)
function checkFileType(file, cb) {
  const filetypes = /jpeg|jpg|png|gif|svg|ico|webp/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Error: Hanya file gambar yang diizinkan!'));
  }
}

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => checkFileType(file, cb),
  limits: { fileSize: 5 * 1024 * 1024 } // Batas ukuran file 5MB
});

export default upload;