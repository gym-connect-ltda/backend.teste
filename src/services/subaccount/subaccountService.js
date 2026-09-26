const supabase = require("../../config/db");
const asaasAccountService = require("../asaas/asaasAccountService");
const asaasSubaccountClient = require("../asaas/asaasSubaccountClient");

/**
 * Orquestra o fluxo de subconta BaaS de uma filial: junta os dados da
 * filial no nosso banco com as chamadas reais ao Asaas
 * (asaasSubaccountClient) e persiste o resultado via asaasAccountService
 * (que já cuida de criptografia da apiKey).
 */

async function getBranch(branchId) {
  const { data, error } = await supabase
    .from("filiais")
    .select(
      "id_filial, id_empresa, nome_filial, cnpj_filial, telefone_filial, endereco",
    )
    .eq("id_filial", branchId)
    .single();

  if (error || !data) {
    throw new Error("Filial não encontrada.");
  }
  return data;
}

/**
 * Cria a subconta BaaS da filial no Asaas e salva o resultado
 * (id, walletId, apiKey criptografada) no banco.
 *
 * incomeValue e companyType não existem na tabela filiais — vêm do
 * formulário que o admin preenche na hora de iniciar o onboarding,
 * já que são dados regulatórios que só fazem sentido nesse momento
 * (faturamento estimado, tipo societário).
 *
 * O endereço é obrigatório em formato explícito do Asaas (rua, número,
 * bairro, CEP) — como filiais.endereco é um JSON de formato próprio do
 * projeto, pedimos os campos explicitamente aqui também, em vez de
 * tentar adivinhar a estrutura do JSON salvo.
 */
const createBranchSubaccount = async ({
  branchId,
  email,
  mobilePhone,
  incomeValue,
  companyType,
  address,
  addressNumber,
  complement,
  province,
  postalCode,
}) => {
  const branch = await getBranch(branchId);

  const existing = await asaasAccountService.getAccountByBranch(branchId);
  if (existing?.asaasAccountId) {
    throw new Error("Esta filial já possui uma subconta Asaas criada.");
  }

  if (!branch.cnpj_filial) {
    throw new Error(
      "A filial precisa ter um CNPJ cadastrado antes de criar a subconta (contas PF não podem ser subconta).",
    );
  }

  const subaccount = await asaasSubaccountClient.createSubaccount({
    name: branch.nome_filial,
    email,
    cpfCnpj: branch.cnpj_filial,
    mobilePhone: mobilePhone || branch.telefone_filial,
    incomeValue,
    companyType,
    address,
    addressNumber,
    complement,
    province,
    postalCode,
  });

  // A apiKey só vem nesta resposta, nunca mais — salvar já, sem margem
  // pra erro entre a criação e o salvamento.
  const saved = await asaasAccountService.upsertBranchAccount(branchId, {
    asaasAccountId: subaccount.id,
    asaasWalletId: subaccount.walletId,
    asaasApiKey: subaccount.apiKey,
    onboardingStatus: "pending_documents",
  });

  return saved;
};

/**
 * Lista os documentos pendentes da subconta. Respeita a regra do Asaas
 * de aguardar ~15s após a criação antes da primeira consulta — se a
 * subconta acabou de ser criada, o chamador deve tratar isso (ex: só
 * habilitar o botão de "ver documentos" alguns segundos depois na UI).
 */
const listPendingDocuments = async (branchId) => {
  const apiKey = await asaasAccountService.getApiKeyByBranch(branchId);
  if (!apiKey) {
    throw new Error("Esta filial ainda não tem uma subconta Asaas criada.");
  }

  return asaasSubaccountClient.listPendingDocuments(apiKey);
};

/**
 * Envia um documento pendente da subconta.
 */
const uploadDocument = async ({
  branchId,
  documentId,
  fileBuffer,
  fileName,
  mimeType,
  type,
}) => {
  const apiKey = await asaasAccountService.getApiKeyByBranch(branchId);
  if (!apiKey) {
    throw new Error("Esta filial ainda não tem uma subconta Asaas criada.");
  }

  return asaasSubaccountClient.sendDocument({
    subaccountApiKey: apiKey,
    documentId,
    fileBuffer,
    fileName,
    mimeType,
    type,
  });
};

/**
 * Consulta a situação cadastral da subconta no Asaas e sincroniza o
 * status local (asaas_accounts.asaas_onboarding_status).
 */
const syncAccountStatus = async (branchId) => {
  const apiKey = await asaasAccountService.getApiKeyByBranch(branchId);
  if (!apiKey) {
    throw new Error("Esta filial ainda não tem uma subconta Asaas criada.");
  }

  const status = await asaasSubaccountClient.getAccountStatus(apiKey);

  await asaasAccountService.upsertBranchAccount(branchId, {
    onboardingStatus: status.status || status.generalStatus || "unknown",
  });

  return status;
};

module.exports = {
  createBranchSubaccount,
  listPendingDocuments,
  uploadDocument,
  syncAccountStatus,
};
