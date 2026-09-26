const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");

const { Router } = require("express");

const branchController = require("../controllers/branch/branchController");

const authMiddleware = require("../middlewares/auth/authMiddleware");

const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

// Todas as rotas de filiais exigem autenticação ativa
router.use(authMiddleware);

router.use(subscriptionGuard);

// GET fica sem exigir a permissão "filiais" — é usado como utilitário
// (dropdown de filial) por outras telas, mesmo por quem não gerencia
// filiais diretamente. Só criar/editar/inativar exige a permissão de verdade.

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

router.patch(
  "/:id/deactivate",
  requirePermission(["filiais"]),
  branchController.deactivateBranch,
);

module.exports = router;
