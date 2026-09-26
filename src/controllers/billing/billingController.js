const billingService = require("../../services/billing/billingService");
const companyService = require("../../services/company/companyService");
const asaas = require("../../services/asaas/asaasSaasClient");
const auditService = require("../../services/audit/auditService");
const { getClientIp } = require("../../utils/getClientIp");

/**
 * Status atual da assinatura da empresa logada — usado pela tela de billing
 * E pelo subscriptionGuard (indiretamente, via billingService.isAccessAllowed).
 */
const getStatus = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const subscription =
      await billingService.getSubscriptionByCompany(companyId);
    const allowed = billingService.isAccessAllowed(subscription);

    return res.status(200).json({
      subscription,
      accessAllowed: allowed,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getPlans = async (_req, res) => {
  try {
    const plans = await billingService.listPlans();
    return res.status(200).json({ plans });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getInvoices = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const invoices = await billingService.listInvoices(companyId);
    return res.status(200).json({ invoices });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Busca os dados da empresa (nome/cnpj) — reaproveita a leitura já feita em
 * authService.getProfile não é ideal aqui (traz dados demais), então lemos
 * direto o mínimo necessário via companyService.
 */
const getCompanyForBilling = async (companyId) => {
  return companyService.getCompanyBasicInfo(companyId);
};

/**
 * Contrata o plano (converte trial em assinatura paga), via Pix ou cartão.
 *
 * Body esperado:
 * - billingType: "PIX" | "CREDIT_CARD"
 * - Se CREDIT_CARD: creditCard { holderName, number, expiryMonth, expiryYear, ccv },
 *   creditCardHolderInfo { name, email, cpfCnpj, postalCode, addressNumber, phone }
 */
const subscribe = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId } = req.user;
  const { billingType, creditCard, creditCardHolderInfo } = req.body;

  if (!billingType || !["PIX", "CREDIT_CARD"].includes(billingType)) {
    return res
      .status(400)
      .json({ message: "Informe billingType como PIX ou CREDIT_CARD." });
  }

  try {
    const company = await getCompanyForBilling(companyId);
    const remoteIp = getClientIp(req);

    let creditCardToken;
    if (billingType === "CREDIT_CARD") {
      if (!creditCard || !creditCardHolderInfo) {
        return res.status(400).json({
          message:
            "Para pagamento com cartão, informe creditCard e creditCardHolderInfo.",
        });
      }

      const subscriptionRow =
        await billingService.getSubscriptionByCompany(companyId);
      const customerId = await billingService.ensureAsaasCustomer(
        subscriptionRow,
        company,
      );

      const tokenized = await asaas.tokenizeCreditCard({
        customer: customerId,
        creditCard,
        creditCardHolderInfo,
        remoteIp,
      });
      creditCardToken = tokenized.creditCardToken;
    }

    const currentSubscription =
      await billingService.getSubscriptionByCompany(companyId);
    const isReactivation = currentSubscription?.status === "overdue";

    const subscription = isReactivation
      ? await billingService.reactivateOverdueSubscription({
          companyId,
          company,
          billingType,
          creditCardToken,
          remoteIp,
        })
      : await billingService.subscribeToPlan({
          companyId,
          company,
          billingType,
          creditCardToken,
          remoteIp,
        });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: req.user.id_filial,
      action: "Contratou plano",
      description: `Assinatura do SaaS ativada via ${billingType}.`,
    });

    return res
      .status(200)
      .json({ message: "Assinatura ativada com sucesso!", subscription });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * Upgrade manual de plano (tela de billing). Efetivo imediatamente no
 * limite de academias; o valor cobrado só muda na próxima fatura.
 */
const upgradePlan = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId } = req.user;
  const { newPlanId } = req.body;

  if (!newPlanId) {
    return res.status(400).json({ message: "Informe newPlanId." });
  }

  try {
    const subscription = await billingService.scheduleUpgrade(
      companyId,
      newPlanId,
    );

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: req.user.id_filial,
      action: "Alterou plano",
      description: `Upgrade de plano solicitado (novo id_plano: ${newPlanId}).`,
    });

    return res
      .status(200)
      .json({ message: "Plano atualizado com sucesso!", subscription });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * Checa se a empresa está no limite de academias do plano atual — chamado
 * pelo frontend ANTES de abrir o formulário de nova filial, pra decidir se
 * mostra o modal de confirmação de upgrade automático.
 */
const checkBranchLimit = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const result = await billingService.checkBranchLimit(companyId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = {
  getStatus,
  getPlans,
  getInvoices,
  subscribe,
  upgradePlan,
  checkBranchLimit,
};
