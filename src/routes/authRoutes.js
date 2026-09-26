const { Router } = require("express");
const authController = require("../controllers/auth/authController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const multer = require("multer");

// Mantém o arquivo em memória (buffer) para repassar direto ao Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});
const router = Router();

router.post("/login", authController.login);

// Rotas protegidas por Token JWT
router.use(authMiddleware);

router.get("/profile", authController.getProfile);
router.post("/change-password", authController.changePassword);
router.post("/accept-terms", authController.acceptTerms);
router.post("/avatar", upload.single("avatar"), authController.uploadAvatar);

module.exports = router;
