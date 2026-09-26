const supabase = require("../../config/db");

/**
 * Mapeia o campo "general" do accountStatus pro nosso status interno.
 * Os outros campos (documentation, bankAccountInfo, commercialInfo)
 * ficam disponíveis no payload bruto (asaas_account_webhook_eventos)
 * pra quem precisar de detalhe granular, mas o campo que decide se a
 * subconta já pode operar de verdade é o "general".
 */
const GENERAL_STATUS_MAP = {
  AWAITING_APPROVAL: "pending_approval",
  PENDING: "pending_documents",
  APPROVED: "approved",
  REJECTED: "rejected",
};

/**
 * Endpoint público (sem authMiddleware) chamado pelo Asaas quando a
 * situação cadastral de uma subconta muda. Autenticidade validada via
 * header "asaas-access-token" comparado a ASAAS_SUBACCOUNT_WEBHOOK_TOKEN
 * — token distinto do webhook de billing SaaS, de propósito (domínios
 * diferentes, contas Asaas diferentes).
 */
const handleAccountStatusWebhook = async (req, res) => {
  const receivedToken = req.headers["asaas-access-token"];
  const expectedToken = process.env.ASAAS_SUBACCOUNT_WEBHOOK_TOKEN;

  if (!expectedToken) {
    console.error(
      "[webhook-subaccount] ASAAS_SUBACCOUNT_WEBHOOK_TOKEN não configurado — recusando.",
    );
    return res
      .status(500)
      .json({ message: "Webhook não configurado no servidor." });
  }

  if (receivedToken !== expectedToken) {
    return res.status(401).json({ message: "Token de webhook inválido." });
  }

  const event = req.body;
  const eventType = event?.event;
  const accountStatus = event?.accountStatus;
  const asaasAccountId = accountStatus?.id;

  const { data: logRow, error: logError } = await supabase
    .from("asaas_account_webhook_eventos")
    .insert({
      evento: eventType || "UNKNOWN",
      asaas_account_id: asaasAccountId || null,
      payload: event,
    })
    .select()
    .single();

  if (logError) {
    console.error(
      "[webhook-subaccount] Falha ao gravar log do evento:",
      logError.message,
    );
  }

  try {
    if (asaasAccountId && accountStatus?.general) {
      const newStatus =
        GENERAL_STATUS_MAP[accountStatus.general] || accountStatus.general;

      const { error: updateError } = await supabase
        .from("asaas_accounts")
        .update({
          asaas_onboarding_status: newStatus,
          atualizado_em: new Date().toISOString(),
        })
        .eq("asaas_account_id", asaasAccountId);

      if (updateError) {
        throw new Error(
          `Erro ao atualizar status local da subconta: ${updateError.message}`,
        );
      }
    }

    if (logRow) {
      await supabase
        .from("asaas_account_webhook_eventos")
        .update({ processado: true })
        .eq("id", logRow.id);
    }

    // Sempre 200 — evita backoff/penalização de fila no Asaas por engano.
    // Erros de processamento já ficam registrados no log pra investigação.
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(
      `[webhook-subaccount] Erro ao processar evento ${eventType}:`,
      err.message,
    );

    if (logRow) {
      await supabase
        .from("asaas_account_webhook_eventos")
        .update({ erro: err.message })
        .eq("id", logRow.id);
    }

    return res.status(200).json({ received: true, processed: false });
  }
};

module.exports = { handleAccountStatusWebhook };
