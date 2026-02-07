import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  googleAuth,
  getUserProfile,
  updateUserProfile,
  changePassword,
  completeTopic,
  getCompetencyProfile,
  getAllUsers,
  createUser,
  deleteUser,
  forgotPassword,
  resetPassword,
  verifyEmail,
} from "../controllers/userController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";
import { upload } from "../middlewares/upload.js";

const router = express.Router();

// Rute Autentikasi
router.post("/register", registerUser);
router.post("/verify-email", verifyEmail); // Rute verifikasi email
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword); // Rute baru
router.put("/reset-password/:token", resetPassword); // Rute reset password
router.post("/google-auth", googleAuth); // Menggunakan rute dan controller terpadu
router.post("/logout", logoutUser);

// Rute Profil Pengguna (Dilindungi)
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, upload.single("avatar"), updateUserProfile);
router.put("/change-password", protect, changePassword);

router.post("/complete-topic", protect, completeTopic);
router.get("/competency-profile", protect, getCompetencyProfile);

// Rute Admin (Dilindungi oleh middleware 'protect' dan 'admin')
router.route("/")
  .get(protect, admin, getAllUsers)    // GET /api/users
  .post(protect, admin, createUser);   // POST /api/users

router.route("/:id").delete(protect, admin, deleteUser); // DELETE /api/users/:id

export default router;