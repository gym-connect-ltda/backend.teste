const billingService = require("../../services/billing/billingService");

/**
 * Bloqueia o acesso às rotas do sistema quando a empresa está com o trial
 * expirado ou a assinatura inadimplente/cancelada.
 *
 * Roda DEPOIS de authMiddleware (precisa de req.user.id_empresa já
 * decodificado do JWT). Não faz nenhuma chamada ao Asaas — decide só com o
 * que está salvo em saas_assinaturas, então é rápido e não trava o sistema
 * inteiro se o Asaas estiver fora do ar.
 *
 * Resposta 402 (Payment Required) com um "code" fixo — o frontend usa esse
 * code pra saber que deve redirecionar pra tela de billing, sem depender de
 * parsear a mensagem em português.
 */
const subscriptionGuard = async (req, res, next) => {
  const companyId = req.user?.id_empresa;

  if (!companyId) {
    // Não deveria acontecer se authMiddleware rodou antes, mas falha
    // fechado por segurança.
    return res.status(401).json({ message: "Usuário não autenticado." });
  }

  try {
    const subscription =
      await billingService.getSubscriptionByCompany(companyId);
    const allowed = billingService.isAccessAllowed(subscription);

    if (!allowed) {
      return res.status(402).json({
        code: "SUBSCRIPTION_BLOCKED",
        status: subscription?.status || "unknown",
        message:
          subscription?.status === "trialing"
            ? "Seu período gratuito de teste terminou. Escolha um plano para continuar usando o sistema."
            : "Sua assinatura está com pendência de pagamento. Regularize para continuar usando o sistema.",
      });
    }

    return next();
  } catch (err) {
    // Erro ao consultar o banco: por segurança, NÃO libera o acesso —
    // mas também não derruba o request com 500 genérico sem contexto.
    console.error(
      `[subscriptionGuard] Erro ao checar assinatura da empresa ${companyId}:`,
      err.message,
    );
    return res.status(503).json({
      message:
        "Não foi possível validar o status da sua assinatura no momento. Tente novamente em instantes.",
    });
  }
};

module.exports = subscriptionGuard;
