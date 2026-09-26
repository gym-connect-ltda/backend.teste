const supabase = require("../../config/db");
const asaas = require("../asaas/asaasSaasClient");

const TRIAL_DAYS = 7;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

async function getPlanById(planId) {
  const { data, error } = await supabase
    .from("saas_planos")
    .select("*, saas_planos_precos(*)")
    .eq("id_plano", planId)
    .single();

  if (error || !data) {
    throw new Error("Plano informado não foi encontrado.");
  }
  return data;
}

function getPriceForCycle(plan, cycle) {
  const price = plan.saas_planos_precos.find((p) => p.ciclo === cycle);
  if (!price) {
    throw new Error(
      `Ciclo "${cycle}" não possui preço cadastrado para o plano "${plan.nome}".`,
    );
  }
  return Number(price.valor);
}

// ---------------------------------------------------------------------------
// Cadastro / Trial
// ---------------------------------------------------------------------------

/**
 * Chamado por companyService.registerSelfService logo após a empresa ser
 * criada. Cria o customer no Asaas (best-effort — não derruba o cadastro se
 * falhar) e grava a assinatura em trial por TRIAL_DAYS dias.
 *
 * @returns {object} a linha criada em saas_assinaturas
 */
const startTrialSubscription = async ({
  companyId,
  companyName,
  companyCnpj,
  companyEmail, // empresas não tem coluna de e-mail: passe o email_usuario do admin recém-criado
  planId,
  cycle,
}) => {
  const plan = await getPlanById(planId);
  // valida que o ciclo existe pro plano, mesmo que a cobrança real só
  // aconteça depois do trial — falha cedo se o ciclo for inválido.
  getPriceForCycle(plan, cycle);

  let asaasCustomerId = null;
  try {
    const customer = await asaas.createCustomer({
      name: companyName,
      cpfCnpj: companyCnpj,
      email: companyEmail,
      externalReference: String(companyId),
    });
    asaasCustomerId = customer.id;
  } catch (err) {
    // Não bloqueia o cadastro. Log pra investigação — o customer é criado
    // sob demanda em ensureAsaasCustomer() quando o cliente for pagar.
    console.error(
      `[billing] Falha ao criar customer Asaas no cadastro (empresa ${companyId}):`,
      err.message,
    );
  }

  const trialTerminaEm = addDays(new Date(), TRIAL_DAYS);

  const { data, error } = await supabase
    .from("saas_assinaturas")
    .insert({
      id_empresa: companyId,
      id_plano: planId,
      ciclo: cycle,
      status: "trialing",
      asaas_customer_id: asaasCustomerId,
      trial_termina_em: trialTerminaEm.toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao criar assinatura em trial: ${error.message}`);
  }

  return data;
};

/**
 * empresas não tem coluna de e-mail — usamos o e-mail do usuário
 * Administrador mais antigo da empresa (fallback: qualquer usuário ativo).
 * É o e-mail que aparecerá nas cobranças/notificações do Asaas.
 */
const getCompanyBillingEmail = async (companyId) => {
  const { data, error } = await supabase
    .from("usuarios")
    .select("email_usuario, perfil:perfis(nome_perfil)")
    .eq("id_empresa", companyId)
    .eq("status_usuario", true)
    .order("criado_em", { ascending: true });

  if (error || !data || data.length === 0) {
    throw new Error(
      "Não foi possível determinar um e-mail de contato para a empresa.",
    );
  }

  const admin = data.find((u) => u.perfil?.nome_perfil === "Administrador");
  return (admin || data[0]).email_usuario;
};

/**
 * Garante que a empresa tem um customer no Asaas, criando agora caso o
 * cadastro inicial tenha falhado em criar. Usado como fallback na hora do
 * pagamento (subscribeToPlan).
 */
const ensureAsaasCustomer = async (subscriptionRow, company) => {
  if (subscriptionRow.asaas_customer_id)
    return subscriptionRow.asaas_customer_id;

  const email = await getCompanyBillingEmail(company.id_empresa);

  const customer = await asaas.createCustomer({
    name: company.nome_empresa,
    cpfCnpj: company.cnpj_empresa,
    email,
    externalReference: String(company.id_empresa),
  });

  const { error } = await supabase
    .from("saas_assinaturas")
    .update({
      asaas_customer_id: customer.id,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id_assinatura", subscriptionRow.id_assinatura);

  if (error) {
    throw new Error(
      `Customer criado no Asaas, mas falhou ao salvar no banco: ${error.message}`,
    );
  }

  return customer.id;
};

// ---------------------------------------------------------------------------
// Consulta de status (usado pelo middleware e pela tela de billing)
// ---------------------------------------------------------------------------

/**
 * Retorna a assinatura da empresa com o plano atual já populado.
 * Lança erro se a empresa não tiver assinatura (não deveria acontecer,
 * já que toda empresa ganha uma em trial no cadastro).
 */
const getSubscriptionByCompany = async (companyId) => {
  const { data, error } = await supabase
    .from("saas_assinaturas")
    .select(
      "*, plano:saas_planos!saas_assinaturas_id_plano_fkey(*), plano_pendente:saas_planos!saas_assinaturas_plano_pendente_id_fkey(*)",
    )
    .eq("id_empresa", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar assinatura da empresa: ${error.message}`);
  }
  return data;
};

/**
 * Calcula se a empresa tem acesso liberado ao sistema agora. Usado pelo
 * middleware subscriptionGuard — não faz nenhuma chamada ao Asaas, decide
 * só com o que já está no banco (rápido, sem depender da API externa estar
 * no ar pra cada request).
 */
const isAccessAllowed = (subscription) => {
  if (!subscription) return false;

  if (subscription.status === "active") return true;

  if (subscription.status === "trialing") {
    const trialEnd = new Date(subscription.trial_termina_em);
    return trialEnd.getTime() > Date.now();
  }

  // 'overdue' e 'canceled' bloqueiam.
  return false;
};

/**
 * Histórico de faturas da empresa, mais recentes primeiro.
 */
const listInvoices = async (companyId) => {
  const { data, error } = await supabase
    .from("saas_faturas")
    .select("*")
    .eq("id_empresa", companyId)
    .order("vencimento", { ascending: false });

  if (error) {
    throw new Error(`Erro ao listar faturas: ${error.message}`);
  }
  return data;
};

const listPlans = async () => {
  const { data, error } = await supabase
    .from("saas_planos")
    .select("*, saas_planos_precos(*)")
    .eq("ativo", true)
    .order("limite_academias", { ascending: true });

  if (error) {
    throw new Error(`Erro ao listar planos: ${error.message}`);
  }
  return data;
};

// ---------------------------------------------------------------------------
// Contratação (fim do trial ou troca de forma de pagamento)
// ---------------------------------------------------------------------------

/**
 * Cria a assinatura no Asaas (Pix ou cartão já tokenizado) e grava o
 * resultado em saas_assinaturas. Função interna compartilhada por
 * subscribeToPlan (trial -> ativa) e reactivateOverdueSubscription
 * (overdue -> ativa de novo).
 *
 * O status real só é confirmado depois, via webhook (PAYMENT_CONFIRMED /
 * PAYMENT_RECEIVED) — aqui deixamos 'active' de forma otimista pro Pix
 * (cobrança gerada, aguardando pagamento) e o webhook corrige se cair em
 * overdue. Para cartão, a validação já acontece na criação da assinatura.
 */
async function createAsaasSubscriptionAndSave({
  subscription,
  company,
  billingType,
  creditCardToken,
  remoteIp,
}) {
  const customerId = await ensureAsaasCustomer(subscription, company);
  const plan = await getPlanById(subscription.id_plano);
  const value = getPriceForCycle(plan, subscription.ciclo);
  const nextDueDate = toDateOnly(new Date());
  const description = `Assinatura ${plan.nome} (${subscription.ciclo}) - ${company.nome_empresa}`;

  let asaasSubscription;
  if (billingType === "PIX") {
    asaasSubscription = await asaas.createSubscriptionPix({
      customer: customerId,
      value,
      nextDueDate,
      cycle: subscription.ciclo,
      description,
      externalReference: String(company.id_empresa),
    });
  } else if (billingType === "CREDIT_CARD") {
    if (!creditCardToken) {
      throw new Error(
        "creditCardToken é obrigatório para assinatura via cartão de crédito.",
      );
    }
    asaasSubscription = await asaas.createSubscriptionCreditCard({
      customer: customerId,
      value,
      nextDueDate,
      cycle: subscription.ciclo,
      description,
      externalReference: String(company.id_empresa),
      creditCardToken,
      remoteIp,
    });
  } else {
    throw new Error(`Forma de pagamento "${billingType}" não suportada.`);
  }

  const { data, error } = await supabase
    .from("saas_assinaturas")
    .update({
      status: "active",
      forma_pagamento: billingType,
      asaas_subscription_id: asaasSubscription.id,
      credit_card_token: billingType === "CREDIT_CARD" ? creditCardToken : null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id_assinatura", subscription.id_assinatura)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Assinatura criada no Asaas, mas falhou ao salvar no banco: ${error.message}`,
    );
  }

  return data;
}

/**
 * Converte o trial em assinatura paga. Só pode ser chamado enquanto a
 * empresa ainda não tem assinatura ativa no Asaas — se já estiver
 * 'active', é bug de fluxo no frontend (usar /upgrade em vez disso). Se
 * estiver 'overdue', use reactivateOverdueSubscription.
 */
const subscribeToPlan = async ({
  companyId,
  company,
  billingType,
  creditCardToken,
  remoteIp,
}) => {
  const subscription = await getSubscriptionByCompany(companyId);
  if (!subscription) {
    throw new Error("Empresa não possui assinatura em trial para converter.");
  }

  if (subscription.status === "active") {
    throw new Error(
      "A empresa já possui uma assinatura ativa. Para trocar de plano, use a rota de upgrade.",
    );
  }

  if (subscription.status === "overdue") {
    throw new Error(
      "A assinatura está com pendência de pagamento. Use a reativação de assinatura em atraso.",
    );
  }

  return createAsaasSubscriptionAndSave({
    subscription,
    company,
    billingType,
    creditCardToken,
    remoteIp,
  });
};

/**
 * Reativa uma assinatura 'overdue'. Em vez de simplesmente criar uma
 * assinatura nova por cima (o que deixaria DUAS assinaturas ativas na
 * conta master do Asaas — uma órfã sem controle local, ainda gerando
 * cobrança), CANCELA a assinatura antiga no Asaas primeiro e só então
 * cria a nova, mantendo sempre 1 assinatura ativa por empresa.
 */
const reactivateOverdueSubscription = async ({
  companyId,
  company,
  billingType,
  creditCardToken,
  remoteIp,
}) => {
  const subscription = await getSubscriptionByCompany(companyId);
  if (!subscription) {
    throw new Error("Empresa não possui assinatura.");
  }

  if (subscription.status !== "overdue") {
    throw new Error(
      `Reativação só se aplica a assinaturas em atraso (status atual: ${subscription.status}).`,
    );
  }

  if (subscription.asaas_subscription_id) {
    try {
      await asaas.cancelSubscription(subscription.asaas_subscription_id);
    } catch (err) {
      // Se a assinatura antiga já não existir mais no Asaas (ex: cancelada
      // manualmente no painel), seguimos em frente — o objetivo é garantir
      // que não sobre lixo ativo, não travar a reativação por causa disso.
      console.error(
        `[billing] Falha ao cancelar assinatura antiga (empresa ${companyId}):`,
        err.message,
      );
    }
  }

  return createAsaasSubscriptionAndSave({
    subscription,
    company,
    billingType,
    creditCardToken,
    remoteIp,
  });
};

// ---------------------------------------------------------------------------
// Troca de plano (upgrade manual ou por limite de academias)
// ---------------------------------------------------------------------------

/**
 * Agenda a troca de plano: atualiza o limite de uso IMEDIATAMENTE
 * (id_plano muda já), mas o VALOR cobrado no Asaas só muda a partir da
 * próxima fatura gerada (comportamento padrão do updateSubscriptionValue).
 *
 * Se a empresa ainda estiver em trial (sem asaas_subscription_id), só
 * trocamos o plano local — não há assinatura no Asaas ainda pra atualizar.
 */
const scheduleUpgrade = async (companyId, newPlanId) => {
  const subscription = await getSubscriptionByCompany(companyId);
  if (!subscription) {
    throw new Error("Empresa não possui assinatura.");
  }

  const newPlan = await getPlanById(newPlanId);
  const newValue = getPriceForCycle(newPlan, subscription.ciclo);

  if (subscription.asaas_subscription_id) {
    await asaas.updateSubscriptionValue(subscription.asaas_subscription_id, {
      value: newValue,
      description: `Assinatura ${newPlan.nome} (${subscription.ciclo})`,
    });
  }

  const { data, error } = await supabase
    .from("saas_assinaturas")
    .update({
      id_plano: newPlanId, // limite de academias libera JÁ
      plano_pendente_id: null, // não há mais upgrade "pendente": já aplicamos
      atualizado_em: new Date().toISOString(),
    })
    .eq("id_assinatura", subscription.id_assinatura)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Plano atualizado no Asaas, mas falhou ao salvar no banco: ${error.message}`,
    );
  }

  return data;
};

/**
 * Quantas filiais a empresa já tem cadastradas — usado pra checar limite
 * do plano antes de criar uma nova.
 */
const countCompanyBranches = async (companyId) => {
  const { count, error } = await supabase
    .from("filiais")
    .select("id_filial", { count: "exact", head: true })
    .eq("id_empresa", companyId)
    .eq("status_filial", true);

  if (error) {
    throw new Error(`Erro ao contar filiais da empresa: ${error.message}`);
  }
  return count || 0;
};

/**
 * Verifica se criar mais uma filial estoura o limite do plano atual.
 * Retorna { withinLimit: true } se ainda cabe, ou
 * { withinLimit: false, currentPlan, suggestedPlan, newValue } se for
 * necessário confirmar upgrade antes de prosseguir.
 */
const checkBranchLimit = async (companyId) => {
  const subscription = await getSubscriptionByCompany(companyId);
  if (!subscription) {
    throw new Error("Empresa não possui assinatura.");
  }

  const currentCount = await countCompanyBranches(companyId);
  const currentPlan = subscription.plano;

  if (currentCount < currentPlan.limite_academias) {
    return { withinLimit: true };
  }

  // Busca o próximo plano com limite maior.
  const { data: nextPlans, error } = await supabase
    .from("saas_planos")
    .select("*, saas_planos_precos(*)")
    .eq("ativo", true)
    .gt("limite_academias", currentPlan.limite_academias)
    .order("limite_academias", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Erro ao buscar próximo plano: ${error.message}`);
  }

  const suggestedPlan = nextPlans?.[0];
  if (!suggestedPlan) {
    throw new Error(
      "Limite máximo de academias do maior plano disponível já foi atingido. Fale com o suporte.",
    );
  }

  const newValue = getPriceForCycle(suggestedPlan, subscription.ciclo);

  return {
    withinLimit: false,
    currentPlan,
    suggestedPlan,
    newValue,
  };
};

module.exports = {
  TRIAL_DAYS,
  startTrialSubscription,
  ensureAsaasCustomer,
  getCompanyBillingEmail,
  getSubscriptionByCompany,
  isAccessAllowed,
  listInvoices,
  listPlans,
  subscribeToPlan,
  reactivateOverdueSubscription,
  scheduleUpgrade,
  countCompanyBranches,
  checkBranchLimit,
};
