const { Router } = require("express");
const multer = require("multer");
const branchController = require("../controllers/branch/branchController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// Todas as rotas de filiais exigem autenticação ativa
router.use(authMiddleware);
router.use(subscriptionGuard);

// GET fica sem exigir a permissão "filiais" — é usado como utilitário
// (dropdown de filial) por outras telas, mesmo por quem não gerencia
// filiais diretamente. Só criar/editar exige a permissão de verdade.
router.post(
  "/",
  requirePermission(["filiais"]),
  branchController.createNewBranch,
);
router.get("/", branchController.getCompanyBranches);
router.put(
  "/:id",
  requirePermission(["filiais"]),
  branchController.editCompanyBranch,
);

// Upload de imagem da filial — :kind é "banner" ou "perfil"
router.post(
  "/:id/image/:kind",
  requirePermission(["filiais"]),
  uploadImage.single("image"),
  branchController.uploadBranchImage,
);

module.exports = router;
