const axios = require("axios");
const FormData = require("form-data");

/**
 * Cliente Asaas para o fluxo de SUBCONTAS (aluno → filial), modelo BaaS.
 *
 * Duas autenticações diferentes coexistem aqui, dependendo da operação:
 * - Criar subconta: usa a chave da conta MASTER (ASAAS_ROOT_API_KEY) —
 *   só a conta raiz pode criar contas-filhas.
 * - Tudo que acontece DEPOIS da subconta existir (documentos, cobranças
 *   de aluno, saldo, etc.): usa a apiKey PRÓPRIA daquela subconta,
 *   passada explicitamente em cada chamada (nunca a master).
 *
 * Isolado de asaasSaasClient.js (billing SaaS) de propósito — são
 * contas e domínios de negócio completamente diferentes.
 */

const BASE_URL = process.env.ASAAS_API_BASE_URL;

function extractAsaasError(error) {
  const asaasErrors = error?.response?.data?.errors;
  if (Array.isArray(asaasErrors) && asaasErrors.length > 0) {
    return asaasErrors.map((e) => e.description).join(" | ");
  }
  return error?.message || "Erro desconhecido na comunicação com o Asaas.";
}

async function request({ method, url, data, accessToken, headers = {} }) {
  try {
    const response = await axios.request({
      method,
      url: `${BASE_URL}${url}`,
      data,
      headers: {
        access_token: accessToken,
        ...headers,
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

// ---------------------------------------------------------------------------
// Criação de subconta (conta master)
// ---------------------------------------------------------------------------

/**
 * Cria a subconta BaaS da filial. Usa a chave MASTER — é a conta raiz
 * quem tem permissão de criar contas-filhas.
 *
 * @returns {object} inclui id, apiKey (só vem nesta resposta, nunca mais)
 *          e walletId.
 */
const createSubaccount = async ({
  name,
  email,
  cpfCnpj,
  mobilePhone,
  phone,
  incomeValue,
  companyType,
  address,
  addressNumber,
  complement,
  province,
  postalCode,
}) => {
  return request({
    method: "post",
    url: "/accounts",
    accessToken: process.env.ASAAS_ROOT_API_KEY,
    data: {
      name,
      email,
      cpfCnpj,
      mobilePhone,
      phone,
      incomeValue,
      companyType, // MEI | LIMITED | INDIVIDUAL | ASSOCIATION — obrigatório pra CNPJ
      address,
      addressNumber,
      complement,
      province,
      postalCode,
      // Configura o webhook de situação cadastral já na criação — garante
      // que nenhum evento de aprovação/reprovação se perca entre a
      // criação da subconta e uma configuração manual posterior.
      webhooks: [
        {
          name: "Situação cadastral da subconta",
          url: process.env.ASAAS_SUBACCOUNT_WEBHOOK_URL,
          email: process.env.ASAAS_SUBACCOUNT_WEBHOOK_EMAIL,
          enabled: true,
          interrupted: false,
          apiVersion: 3,
          authToken: process.env.ASAAS_SUBACCOUNT_WEBHOOK_TOKEN,
          sendType: "SEQUENTIALLY",
          events: [
            "ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL",
            "ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING",
            "ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED",
            "ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED",
            "ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL",
            "ACCOUNT_STATUS_DOCUMENT_APPROVED",
            "ACCOUNT_STATUS_DOCUMENT_REJECTED",
            "ACCOUNT_STATUS_DOCUMENT_PENDING",
            "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL",
            "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED",
            "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED",
            "ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING",
            "ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL",
            "ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED",
            "ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED",
            "ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING",
          ],
        },
      ],
    },
  });
};

// ---------------------------------------------------------------------------
// Documentos (autenticado com a apiKey da PRÓPRIA subconta)
// ---------------------------------------------------------------------------

/**
 * Lista os documentos pendentes da subconta (tipo exigido, id do
 * documento pra usar no upload, etc).
 *
 * ATENÇÃO (regra do Asaas): espere ao menos 15 segundos depois de criar
 * a subconta antes de chamar isso — se chamar antes, a lista pode vir
 * incompleta/errada porque o cadastro ainda está sendo processado.
 */
const listPendingDocuments = async (subaccountApiKey) => {
  return request({
    method: "get",
    url: "/myAccount/documents",
    accessToken: subaccountApiKey,
  });
};

/**
 * Envia (upload) um documento específico da subconta.
 *
 * @param {string} subaccountApiKey - apiKey da subconta (descriptografada)
 * @param {string} documentId - id do documento pendente (vem de listPendingDocuments)
 * @param {Buffer} fileBuffer - conteúdo do arquivo (req.file.buffer do multer)
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} type - um dos enums do Asaas, ex: "IDENTIFICATION", "SOCIAL_CONTRACT"
 */
const sendDocument = async ({
  subaccountApiKey,
  documentId,
  fileBuffer,
  fileName,
  mimeType,
  type,
}) => {
  const form = new FormData();
  form.append("documentFile", fileBuffer, {
    filename: fileName,
    contentType: mimeType,
  });
  form.append("type", type);

  return request({
    method: "post",
    url: `/myAccount/documents/${documentId}`,
    accessToken: subaccountApiKey,
    data: form,
    headers: form.getHeaders(),
  });
};

/**
 * Consulta a situação cadastral/aprovação da subconta.
 */
const getAccountStatus = async (subaccountApiKey) => {
  return request({
    method: "get",
    url: "/myAccount/status",
    accessToken: subaccountApiKey,
  });
};

module.exports = {
  createSubaccount,
  listPendingDocuments,
  sendDocument,
  getAccountStatus,
};
