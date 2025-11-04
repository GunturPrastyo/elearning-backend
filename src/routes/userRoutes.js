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
  getAllUsers,
  createUser,
  deleteUser,
} from "../controllers/userController.js";
import { protect, admin } from "../middlewares/authMiddleware.js";
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

// Rute Admin (Dilindungi oleh middleware 'protect' dan 'admin')
router.route("/")
  .get(protect, admin, getAllUsers)    // GET /api/users
  .post(protect, admin, createUser);   // POST /api/users

router.route("/:id").delete(protect, admin, deleteUser); // DELETE /api/users/:id

export default router;