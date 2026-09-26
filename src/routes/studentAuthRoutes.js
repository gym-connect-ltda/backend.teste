const { Router } = require("express");
const multer = require("multer");
const studentAuthController = require("../controllers/studentAuth/studentAuthController");
const studentAuthMiddleware = require("../middlewares/studentAuth/studentAuthMiddleware");
const studentInvoiceController = require("../controllers/studentApp/studentInvoiceController");

const router = Router();

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Públicas
router.post("/register", studentAuthController.register);
router.post("/login", studentAuthController.login);
router.post("/forgot-password", studentAuthController.forgotPassword);
router.post("/reset-password", studentAuthController.resetPassword);

// Protegidas (token do aluno)
router.use(studentAuthMiddleware);
router.get("/profile", studentAuthController.getProfile);
router.put("/profile", studentAuthController.updateProfile);
router.put("/change-password", studentAuthController.changePassword);
router.post(
  "/profile/photo",
  uploadPhoto.single("photo"),
  studentAuthController.uploadPhoto,
);
router.get("/invoices", studentInvoiceController.listInvoices);

module.exports = router;
