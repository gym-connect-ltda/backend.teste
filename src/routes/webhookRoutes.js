const { Router } = require("express");
const webhookController = require("../controllers/billing/webhookController");
const subaccountWebhookController = require("../controllers/subaccount/subaccountWebhookController");

const router = Router();

// SEM authMiddleware de propósito — quem chama é o servidor do Asaas, não
// um usuário logado no seu sistema. A autenticidade é validada dentro do
// controller via header "asaas-access-token" (ver ASAAS_WEBHOOK_TOKEN).
router.post("/asaas", webhookController.handleAsaasWebhook);

// Situação cadastral das subcontas (aluno -> filial). Token separado do
// de cima (ASAAS_SUBACCOUNT_WEBHOOK_TOKEN) — contas Asaas diferentes.
router.post(
  "/asaas-subaccounts",
  subaccountWebhookController.handleAccountStatusWebhook,
);

module.exports = router;
