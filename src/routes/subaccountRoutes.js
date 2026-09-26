const { Router } = require("express");
const multer = require("multer");
const subaccountController = require("../controllers/subaccount/subaccountController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

// Documentos de identificação/societários — mesmo padrão de limite usado
// pra arquivos de aluno (10MB).
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(authMiddleware);
router.use(subscriptionGuard);
router.use(requirePermission(["configuracoes", "informacoes_bancarias"]));

router.get("/:branchId", subaccountController.getStatus);
router.post("/:branchId", subaccountController.createSubaccount);
router.get("/:branchId/documents", subaccountController.getPendingDocuments);
router.post(
  "/:branchId/documents/:documentId",
  uploadDocument.single("document"),
  subaccountController.uploadDocument,
);
router.post("/:branchId/sync-status", subaccountController.syncStatus);

module.exports = router;
