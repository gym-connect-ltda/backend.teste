const { Router } = require("express");
const billingController = require("../controllers/billing/billingController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

// Todas as rotas de billing exigem autenticação ativa
router.use(authMiddleware);

// Status e planos ficam abertos a qualquer usuário autenticado — a própria
// tela de "sistema bloqueado" (redirecionada pelo subscriptionGuard) precisa
// conseguir consultar isso mesmo sem a permissão de billing.
router.get("/status", billingController.getStatus);
router.get("/plans", billingController.getPlans);
router.get("/branch-limit-check", billingController.checkBranchLimit);

// Ações que envolvem contratação/alteração de plano exigem a permissão
// configuracoes.plano_gym_connect (só o Administrador tem, por padrão).
router.get(
  "/invoices",
  requirePermission(["configuracoes", "plano_gym_connect"]),
  billingController.getInvoices,
);
router.post(
  "/subscribe",
  requirePermission(["configuracoes", "plano_gym_connect"]),
  billingController.subscribe,
);
router.post(
  "/upgrade",
  requirePermission(["configuracoes", "plano_gym_connect"]),
  billingController.upgradePlan,
);

module.exports = router;
