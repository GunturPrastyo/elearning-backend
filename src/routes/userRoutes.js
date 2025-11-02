import express from "express";
import {
  registerUser,
  loginUser,
  googleLogin,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
  completeTopic,
} from "../controllers/userController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { upload } from "../middlewares/upload.js";

const router = express.Router();

// Rute Autentikasi
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/google-login", googleLogin);
router.post("/logout", logoutUser);

// Rute Profil Pengguna (Dilindungi)
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, upload.single("avatar"), updateUserProfile);
router.put("/change-password", protect, changePassword);

router.post("/complete-topic", protect, completeTopic);

export default router;