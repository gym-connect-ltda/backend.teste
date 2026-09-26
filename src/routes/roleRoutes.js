const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { Router } = require("express");
const roleController = require("../controllers/role/roleController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

router.use(authMiddleware);
router.use(subscriptionGuard);

// GET fica sem exigir "perfis" — é usado como dropdown na tela de criar
// usuário, mesmo por quem não gerencia perfis diretamente.
router.post(
  "/",
  requirePermission(["configuracoes", "perfis"]),
  roleController.createNewRole,
);
router.get("/", roleController.getCompanyRoles);
router.put(
  "/:id",
  requirePermission(["configuracoes", "perfis"]),
  roleController.editCompanyRole,
);

module.exports = router;
