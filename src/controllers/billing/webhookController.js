const supabase = require("../../config/db");
const asaas = require("../../services/asaas/asaasSaasClient");

/**
 * Mapa de evento Asaas -> status interno de saas_faturas.
 * Eventos não listados aqui são apenas logados (processado=true, sem ação).
 */
const PAYMENT_STATUS_MAP = {
  PAYMENT_CREATED: "pending",
  PAYMENT_UPDATED: "pending",
  PAYMENT_CONFIRMED: "confirmed",
  PAYMENT_RECEIVED: "received",
  PAYMENT_OVERDUE: "overdue",
  PAYMENT_DELETED: "canceled",
  PAYMENT_REFUNDED: "refunded",
};

/**
 * Eventos que devem levar a assinatura (saas_assinaturas) para 'active'.
 */
const ACTIVATES_SUBSCRIPTION = new Set([
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
]);

/**
 * Eventos que devem levar a assinatura para 'overdue'.
 */
const MARKS_SUBSCRIPTION_OVERDUE = new Set(["PAYMENT_OVERDUE"]);

/**
 * Garante existência da fatura local (saas_faturas) correspondente ao
 * payment do Asaas, criando na primeira vez que vemos esse asaas_payment_id
 * (normalmente no evento PAYMENT_CREATED) e atualizando status nas vezes
 * seguintes.
 */
async function upsertInvoiceFromPayment(payment, eventType) {
  const status = PAYMENT_STATUS_MAP[eventType];
  if (!status) return null; // evento que não mexe em fatura (ex: SUBSCRIPTION_*)

  // Localiza a assinatura local pelo asaas_subscription_id do payment.
  const { data: subscriptionRow, error: subError } = await supabase
    .from("saas_assinaturas")
    .select("id_assinatura, id_empresa")
    .eq("asaas_subscription_id", payment.subscription)
    .maybeSingle();

  if (subError) {
    throw new Error(`Erro ao localizar assinatura local: ${subError.message}`);
  }
  if (!subscriptionRow) {
    // Payment de uma assinatura que não reconhecemos (pode ser do fluxo
    // aluno->empresa, que usa outra conta Asaas — não deveria vir nesse
    // webhook, mas por segurança apenas ignoramos em vez de quebrar).
    return null;
  }

  const payload = {
    id_assinatura: subscriptionRow.id_assinatura,
    id_empresa: subscriptionRow.id_empresa,
    asaas_payment_id: payment.id,
    status,
    forma_pagamento: payment.billingType,
    valor: payment.value,
    vencimento: payment.dueDate,
    link_pagamento: payment.invoiceUrl || null,
  };

  if (status === "confirmed" || status === "received") {
    payload.pago_em = new Date().toISOString();
  }

  // Pix: busca o QR Code pra exibir na tela de billing enquanto pendente.
  if (payment.billingType === "PIX" && status === "pending") {
    try {
      const qr = await asaas.getPixQrCode(payment.id);
      payload.qr_code_pix = qr.payload || null;
    } catch (err) {
      // Não trava o processamento do webhook por causa do QR Code —
      // a tela de billing pode buscar de novo sob demanda se faltar.
      console.error(
        `[webhook] Falha ao buscar QR Code Pix (payment ${payment.id}):`,
        err.message,
      );
    }
  }

  const { error: upsertError } = await supabase
    .from("saas_faturas")
    .upsert(payload, { onConflict: "asaas_payment_id" });

  if (upsertError) {
    throw new Error(`Erro ao salvar fatura local: ${upsertError.message}`);
  }

  return subscriptionRow;
}

async function updateSubscriptionStatus(subscriptionRow, eventType) {
  if (!subscriptionRow) return;

  let newStatus = null;
  if (ACTIVATES_SUBSCRIPTION.has(eventType)) newStatus = "active";
  else if (MARKS_SUBSCRIPTION_OVERDUE.has(eventType)) newStatus = "overdue";

  if (!newStatus) return;

  const updatePayload = {
    status: newStatus,
    atualizado_em: new Date().toISOString(),
  };

  // Ao confirmar pagamento, sincroniza o próximo vencimento direto do
  // Asaas (fonte da verdade), em vez de recalcular ciclo aqui no backend.
  if (newStatus === "active") {
    try {
      const { data: row } = await supabase
        .from("saas_assinaturas")
        .select("asaas_subscription_id")
        .eq("id_assinatura", subscriptionRow.id_assinatura)
        .single();

      if (row?.asaas_subscription_id) {
        const asaasSubscription = await asaas.getSubscription(
          row.asaas_subscription_id,
        );
        if (asaasSubscription?.nextDueDate) {
          updatePayload.periodo_atual_fim = asaasSubscription.nextDueDate;
        }
      }
    } catch (err) {
      console.error(`[webhook] Falha ao sincronizar nextDueDate:`, err.message);
    }
  }

  const { error } = await supabase
    .from("saas_assinaturas")
    .update(updatePayload)
    .eq("id_assinatura", subscriptionRow.id_assinatura);

  if (error) {
    throw new Error(`Erro ao atualizar status da assinatura: ${error.message}`);
  }
}

/**
 * Endpoint público (sem authMiddleware) chamado pelo Asaas. Validação de
 * autenticidade via header "asaas-access-token", comparado ao
 * ASAAS_WEBHOOK_TOKEN configurado no .env — esse token PRECISA ser o mesmo
 * cadastrado como "authToken" na configuração do webhook no painel/API do
 * Asaas (ver nota no chat sobre a variável de ambiente faltante).
 */
const handleAsaasWebhook = async (req, res) => {
  const receivedToken = req.headers["asaas-access-token"];
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;

  if (!expectedToken) {
    console.error(
      "[webhook] ASAAS_WEBHOOK_TOKEN não configurado no .env — recusando todos os webhooks.",
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
  const payment = event?.payment;

  // Loga o evento bruto SEMPRE, mesmo que o processamento abaixo falhe —
  // é o que permite reprocessar manualmente se algo der errado.
  const { data: logRow, error: logError } = await supabase
    .from("saas_webhook_eventos")
    .insert({
      evento: eventType || "UNKNOWN",
      asaas_payment_id: payment?.id || null,
      payload: event,
    })
    .select()
    .single();

  if (logError) {
    console.error("[webhook] Falha ao gravar log do evento:", logError.message);
    // Segue tentando processar mesmo assim — logging é auxiliar, não crítico.
  }

  try {
    if (payment) {
      const subscriptionRow = await upsertInvoiceFromPayment(
        payment,
        eventType,
      );
      await updateSubscriptionStatus(subscriptionRow, eventType);
    }

    if (logRow) {
      await supabase
        .from("saas_webhook_eventos")
        .update({ processado: true })
        .eq("id", logRow.id);
    }

    // Sempre 200 pra evitar que o Asaas entre em backoff/penalização de
    // webhook por engano — erros já ficam registrados em saas_webhook_eventos.
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(
      `[webhook] Erro ao processar evento ${eventType}:`,
      err.message,
    );

    if (logRow) {
      await supabase
        .from("saas_webhook_eventos")
        .update({ erro: err.message })
        .eq("id", logRow.id);
    }

    return res.status(200).json({ received: true, processed: false });
  }
};

module.exports = { handleAsaasWebhook };
