import path from "path";

/**
 * @desc    Upload image for rich text editor
 * @route   POST /api/upload/image
 * @access  Private/Admin
 */
export const uploadImage = (req, res) => {
  if (req.file) {
    res.status(200).json({
      // Ensure this URL matches how you serve static files
      // In server.js, you use '/uploads', so the path will be like this
      imageUrl: `/uploads/${req.file.filename}`,
    });
  } else {
    res.status(400).json({ message: "Gagal mengunggah gambar, tidak ada file yang diterima." });
  }
};