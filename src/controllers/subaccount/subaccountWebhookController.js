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
 * Cria ou atualiza a linha em "pagamentos" a partir de um evento de
 * pagamento (aluno → filial). Mesma lógica de upsert que usamos no
 * webhook de billing SaaS, adaptada pra essa tabela.
 */
async function upsertStudentPayment(payment) {
  const { data: existing } = await supabase
    .from("pagamentos")
    .select("id_pagamento, aluno_id, id_filial, id_empresa")
    .eq("asaas_payment_id", payment.id)
    .maybeSingle();

  const updatePayload = {
    status: payment.status,
    valor: payment.value,
    data_vencimento: payment.dueDate,
    tipo_pagamento: payment.billingType,
    link_pagamento: payment.invoiceUrl || null,
  };

  if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
    updatePayload.confirmado_em = new Date().toISOString();
    if (payment.transactionReceiptUrl)
      updatePayload.receipt_url = payment.transactionReceiptUrl;
  }

  if (existing) {
    const { error } = await supabase
      .from("pagamentos")
      .update(updatePayload)
      .eq("id_pagamento", existing.id_pagamento);
    if (error) throw new Error(`Erro ao atualizar pagamento: ${error.message}`);
    return;
  }

  // Pagamento novo (ex: renovação automática do próximo ciclo) — acha o
  // aluno/filial/empresa pelo externalReference (aluno_id, setado na
  // criação da assinatura) ou, na falta dele, por outra cobrança já
  // existente da mesma assinatura.
  let alunoId = payment.externalReference
    ? Number(payment.externalReference)
    : null;
  let branchId = null;
  let companyId = null;

  if (alunoId) {
    const { data: aluno } = await supabase
      .from("alunos")
      .select("id_aluno, id_filial, id_empresa")
      .eq("id_aluno", alunoId)
      .maybeSingle();
    if (aluno) {
      branchId = aluno.id_filial;
      companyId = aluno.id_empresa;
    }
  }

  if (!branchId && payment.subscription) {
    const { data: sibling } = await supabase
      .from("pagamentos")
      .select("aluno_id, id_filial, id_empresa")
      .eq("asaas_subscription_id", payment.subscription)
      .limit(1)
      .maybeSingle();
    if (sibling) {
      alunoId = sibling.aluno_id;
      branchId = sibling.id_filial;
      companyId = sibling.id_empresa;
    }
  }

  if (!alunoId || !branchId) {
    throw new Error(
      `Não foi possível identificar o aluno do pagamento ${payment.id} (sem referência local).`,
    );
  }

  const { error } = await supabase.from("pagamentos").insert({
    aluno_id: alunoId,
    asaas_subscription_id: payment.subscription || null,
    asaas_payment_id: payment.id,
    tipo_operacao: "RENOVACAO",
    id_filial: branchId,
    id_empresa: companyId,
    ...updatePayload,
  });

  if (error) throw new Error(`Erro ao criar pagamento: ${error.message}`);
}

/**
 * Endpoint público (sem authMiddleware) chamado pelo Asaas quando a
 * situação cadastral de uma subconta muda OU quando uma cobrança de
 * aluno muda de status — os dois tipos de evento chegam nessa mesma
 * URL, já que ambos são configurados no webhook de cada subconta.
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
  const payment = event?.payment;
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

    if (payment && eventType?.startsWith("PAYMENT_")) {
      await upsertStudentPayment(payment);
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
