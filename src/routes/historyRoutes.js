const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { Router } = require("express");
const historyController = require("../controllers/audit/historyController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

router.use(authMiddleware);
router.use(subscriptionGuard);
router.use(requirePermission(["configuracoes", "historico_usuario"]));

router.get("/", historyController.getCompanyHistory);

module.exports = router;
