import express from "express";
import { uploadImage } from "../controllers/uploadController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";
import { upload } from "../middlewares/upload.js"; 

const router = express.Router();

/**
 * @desc    Upload image untuk rich text editor
 * @route   POST /api/upload/image
 * @access  Private/Admin
 */
router.post("/image", protect, admin, upload.single("image"), uploadImage);

export default router;
