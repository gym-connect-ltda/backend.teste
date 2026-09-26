const axios = require("axios");

/**
 * Cliente Asaas EXCLUSIVO da conta MASTER (root) — usado apenas pelo módulo
 * de billing SaaS (empresa cliente → dono do sistema).
 *
 * Isolado de propósito do fluxo aluno→empresa (services/asaas/asaasAccountService.js),
 * que usa a API key de cada SUBCONTA (empresa/filial). Nunca importar esse
 * arquivo em código relacionado a pagamento de aluno, e nunca importar
 * asaasAccountService aqui — são contas Asaas diferentes.
 *
 * Autenticação: header "access_token" com a chave da conta master
 * (ASAAS_ROOT_API_KEY no .env). Diferente do header Authorization/Bearer
 * usado no restante da API interna do projeto.
 */

const api = axios.create({
  baseURL: process.env.ASAAS_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    access_token: process.env.ASAAS_ROOT_API_KEY,
  },
  timeout: 60000, // Asaas recomenda timeout mínimo de 60s em operações de cartão
});

/**
 * Centraliza o tratamento de erro do Asaas. A API retorna:
 * { errors: [{ code, description }] } em respostas 400.
 */
function extractAsaasError(error) {
  const asaasErrors = error?.response?.data?.errors;
  if (Array.isArray(asaasErrors) && asaasErrors.length > 0) {
    return asaasErrors.map((e) => e.description).join(" | ");
  }
  return error?.message || "Erro desconhecido na comunicação com o Asaas.";
}

async function request(method, url, data) {
  try {
    const response = await api.request({ method, url, data });
    return response.data;
  } catch (error) {
    const message = extractAsaasError(error);
    const err = new Error(`Asaas (${method.toUpperCase()} ${url}): ${message}`);
    err.asaasStatus = error?.response?.status;
    err.asaasRaw = error?.response?.data;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Clientes (customer = a EMPRESA cliente do seu SaaS, na conta master)
// ---------------------------------------------------------------------------

/**
 * Cria o cliente na conta master do Asaas, representando a empresa (tenant)
 * que vai pagar a assinatura do seu SaaS.
 */
const createCustomer = async ({
  name,
  cpfCnpj,
  email,
  phone,
  externalReference,
}) => {
  return request("post", "/customers", {
    name,
    cpfCnpj,
    email,
    phone,
    externalReference, // guardamos aqui o id_empresa, pra rastreabilidade no painel Asaas
  });
};

// ---------------------------------------------------------------------------
// Tokenização de cartão
// ---------------------------------------------------------------------------

/**
 * Tokeniza o cartão do cliente. Retorna { creditCardToken, creditCardBrand, ... }.
 * O token fica atrelado ao customerId informado — não é reutilizável para
 * outro cliente.
 *
 * IMPORTANTE: em produção esse endpoint depende de habilitação/análise do
 * Asaas (livre apenas em Sandbox). Confirme com o suporte deles antes de ir
 * pra produção.
 *
 * @param {string} remoteIp - IP do CLIENTE final (nunca do seu servidor).
 */
const tokenizeCreditCard = async ({
  customer,
  creditCard,
  creditCardHolderInfo,
  remoteIp,
}) => {
  return request("post", "/creditCard/tokenizeCreditCard", {
    customer,
    creditCard,
    creditCardHolderInfo,
    remoteIp,
  });
};

// ---------------------------------------------------------------------------
// Assinaturas
// ---------------------------------------------------------------------------

const CYCLE_MAP = {
  Mensal: "MONTHLY",
  Semestral: "SEMIANNUALLY",
  Anual: "YEARLY",
};

/**
 * Cria assinatura recorrente via PIX. A cada ciclo o Asaas gera uma nova
 * cobrança; o QR Code de cada cobrança é obtido depois via getPixQrCode.
 */
const createSubscriptionPix = async ({
  customer,
  value,
  nextDueDate,
  cycle,
  description,
  externalReference,
}) => {
  return request("post", "/subscriptions", {
    customer,
    billingType: "PIX",
    value,
    nextDueDate,
    cycle: CYCLE_MAP[cycle] || cycle,
    description,
    externalReference,
  });
};

/**
 * Cria assinatura recorrente via cartão de crédito tokenizado.
 * Exige remoteIp do cliente (não do servidor).
 */
const createSubscriptionCreditCard = async ({
  customer,
  value,
  nextDueDate,
  cycle,
  description,
  externalReference,
  creditCardToken,
  remoteIp,
}) => {
  return request("post", "/subscriptions", {
    customer,
    billingType: "CREDIT_CARD",
    value,
    nextDueDate,
    cycle: CYCLE_MAP[cycle] || cycle,
    description,
    externalReference,
    creditCardToken,
    remoteIp,
  });
};

/**
 * Atualiza o valor (e opcionalmente o ciclo) de uma assinatura existente.
 * Conforme o comportamento padrão do Asaas, isso NÃO altera cobranças já
 * geradas — passa a valer a partir da próxima cobrança gerada. É exatamente
 * o comportamento que definimos para upgrade de plano (efetivo na próxima
 * fatura, sem cobrança imediata de diferença).
 */
const updateSubscriptionValue = async (
  subscriptionId,
  { value, cycle, description },
) => {
  const payload = {};
  if (value !== undefined) payload.value = value;
  if (cycle !== undefined) payload.cycle = CYCLE_MAP[cycle] || cycle;
  if (description !== undefined) payload.description = description;

  return request("put", `/subscriptions/${subscriptionId}`, payload);
};

const cancelSubscription = async (subscriptionId) => {
  return request("delete", `/subscriptions/${subscriptionId}`);
};

const getSubscription = async (subscriptionId) => {
  return request("get", `/subscriptions/${subscriptionId}`);
};

const listSubscriptionPayments = async (subscriptionId) => {
  return request("get", `/subscriptions/${subscriptionId}/payments`);
};

// ---------------------------------------------------------------------------
// Cobranças (payments) — usado para consultar status/QR Code de uma fatura
// ---------------------------------------------------------------------------

const getPayment = async (paymentId) => {
  return request("get", `/payments/${paymentId}`);
};

/**
 * Retorna { encodedImage (base64 do QR), payload (copia-e-cola), expirationDate }.
 */
const getPixQrCode = async (paymentId) => {
  return request("get", `/payments/${paymentId}/pixQrCode`);
};

module.exports = {
  createCustomer,
  tokenizeCreditCard,
  createSubscriptionPix,
  createSubscriptionCreditCard,
  updateSubscriptionValue,
  cancelSubscription,
  getSubscription,
  listSubscriptionPayments,
  getPayment,
  getPixQrCode,
  CYCLE_MAP,
};
