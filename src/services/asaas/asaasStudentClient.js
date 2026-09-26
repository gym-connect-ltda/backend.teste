const axios = require("axios");

/**
 * Cliente Asaas para cobrança de ALUNO — toda chamada aqui é autenticada
 * com a apiKey da SUBCONTA da filial (nunca a master, nunca a de billing
 * SaaS). A apiKey é sempre passada explicitamente pelo chamador
 * (studentPaymentService), nunca lida diretamente daqui.
 */

const BASE_URL = process.env.ASAAS_API_BASE_URL;

function extractAsaasError(error) {
  const asaasErrors = error?.response?.data?.errors;
  if (Array.isArray(asaasErrors) && asaasErrors.length > 0) {
    return asaasErrors.map((e) => e.description).join(" | ");
  }
  return error?.message || "Erro desconhecido na comunicação com o Asaas.";
}

async function request({ method, url, data, accessToken }) {
  try {
    const response = await axios.request({
      method,
      url: `${BASE_URL}${url}`,
      data,
      headers: {
        access_token: accessToken,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    });
    return response.data;
  } catch (error) {
    const message = extractAsaasError(error);
    const err = new Error(`Asaas (${method.toUpperCase()} ${url}): ${message}`);
    err.asaasStatus = error?.response?.status;
    err.asaasRaw = error?.response?.data;
    throw err;
  }
}

const CYCLE_MAP = {
  Mensal: "MONTHLY",
  Trimestral: "QUARTERLY",
  Anual: "YEARLY",
};

// ---------------------------------------------------------------------------
// Clientes (o aluno, cadastrado na subconta da filial)
// ---------------------------------------------------------------------------

const createCustomer = async (
  apiKey,
  { name, cpfCnpj, email, mobilePhone, externalReference },
) => {
  return request({
    method: "post",
    url: "/customers",
    accessToken: apiKey,
    data: { name, cpfCnpj, email, mobilePhone, externalReference },
  });
};

// ---------------------------------------------------------------------------
// Tokenização de cartão
// ---------------------------------------------------------------------------

const tokenizeCreditCard = async (
  apiKey,
  { customer, creditCard, creditCardHolderInfo, remoteIp },
) => {
  return request({
    method: "post",
    url: "/creditCard/tokenizeCreditCard",
    accessToken: apiKey,
    data: { customer, creditCard, creditCardHolderInfo, remoteIp },
  });
};

// ---------------------------------------------------------------------------
// Mensalidade recorrente (assinatura) — Pix ou cartão de crédito tokenizado
// ---------------------------------------------------------------------------

const createSubscription = async (
  apiKey,
  {
    customer,
    billingType,
    value,
    nextDueDate,
    cycle,
    description,
    externalReference,
    creditCardToken,
    remoteIp,
  },
) => {
  const payload = {
    customer,
    billingType,
    value,
    nextDueDate,
    cycle: CYCLE_MAP[cycle] || cycle,
    description,
    externalReference,
  };

  if (billingType === "CREDIT_CARD") {
    payload.creditCardToken = creditCardToken;
    payload.remoteIp = remoteIp;
  }

  return request({
    method: "post",
    url: "/subscriptions",
    accessToken: apiKey,
    data: payload,
  });
};

const updateSubscriptionValue = async (
  apiKey,
  subscriptionId,
  { value, cycle, description },
) => {
  const payload = {};
  if (value !== undefined) payload.value = value;
  if (cycle !== undefined) payload.cycle = CYCLE_MAP[cycle] || cycle;
  if (description !== undefined) payload.description = description;

  return request({
    method: "put",
    url: `/subscriptions/${subscriptionId}`,
    accessToken: apiKey,
    data: payload,
  });
};

const cancelSubscription = async (apiKey, subscriptionId) => {
  return request({
    method: "delete",
    url: `/subscriptions/${subscriptionId}`,
    accessToken: apiKey,
  });
};

// ---------------------------------------------------------------------------
// Cobrança avulsa (à vista, sem recorrência) — Pix, cartão de crédito, ou
// UNDEFINED (habilita a tela hospedada do Asaas com opção de débito)
// ---------------------------------------------------------------------------

const createPayment = async (
  apiKey,
  {
    customer,
    billingType,
    value,
    dueDate,
    description,
    externalReference,
    creditCardToken,
    remoteIp,
  },
) => {
  const payload = {
    customer,
    billingType,
    value,
    dueDate,
    description,
    externalReference,
  };

  if (billingType === "CREDIT_CARD" && creditCardToken) {
    payload.creditCardToken = creditCardToken;
    payload.remoteIp = remoteIp;
  }

  return request({
    method: "post",
    url: "/payments",
    accessToken: apiKey,
    data: payload,
  });
};

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

const getPayment = async (apiKey, paymentId) => {
  return request({
    method: "get",
    url: `/payments/${paymentId}`,
    accessToken: apiKey,
  });
};

const getPixQrCode = async (apiKey, paymentId) => {
  return request({
    method: "get",
    url: `/payments/${paymentId}/pixQrCode`,
    accessToken: apiKey,
  });
};

const getSubscription = async (apiKey, subscriptionId) => {
  return request({
    method: "get",
    url: `/subscriptions/${subscriptionId}`,
    accessToken: apiKey,
  });
};

const listSubscriptionPayments = async (apiKey, subscriptionId) => {
  return request({
    method: "get",
    url: `/subscriptions/${subscriptionId}/payments`,
    accessToken: apiKey,
  });
};

module.exports = {
  createCustomer,
  tokenizeCreditCard,
  createSubscription,
  updateSubscriptionValue,
  cancelSubscription,
  createPayment,
  getPayment,
  getPixQrCode,
  getSubscription,
  listSubscriptionPayments,
  CYCLE_MAP,
};
