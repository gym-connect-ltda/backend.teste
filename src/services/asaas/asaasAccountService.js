const supabase = require("../../config/db");
const { encrypt, decrypt } = require("../../utils/encryption");

/**
 * Camada de acesso a dados pra contas Asaas (matriz ou filial). Não faz
 * nenhuma chamada à API do Asaas em si — isso fica pra quando a
 * integração de verdade for construída. Por enquanto só lê/grava os
 * dados da sub-conta no nosso banco.
 *
 * asaas_api_key e asaas_webhook_secret ficam criptografados em repouso
 * (AES-256-GCM, ver utils/encryption.js) — mesmo que alguém leia a
 * tabela direto no banco, sem a ENCRYPTION_KEY do servidor esses campos
 * são inúteis.
 */

function mapAccount(row) {
  if (!row) return null;

  return {
    id: row.id,
    companyId: row.id_empresa,
    branchId: row.id_filial,
    asaasAccountId: row.asaas_account_id,
    asaasWalletId: row.asaas_wallet_id,
    onboardingStatus: row.asaas_onboarding_status,
    onboardingLink: row.asaas_onboarding_link,
    splitEnabled: row.asaas_split_enabled,
    createdAt: row.asaas_created_at,
    // asaas_api_key e asaas_webhook_secret NUNCA saem daqui — são lidos
    // (e descriptografados) só pelas funções getApiKeyBy*/getWebhookSecretBy*
    // abaixo, de uso exclusivo do backend na hora de chamar o Asaas de
    // verdade. Nunca repassados pro frontend nem incluídos neste mapeamento.
  };
}

const getAccountByCompany = async (companyId) => {
  const { data, error } = await supabase
    .from("asaas_accounts")
    .select("*")
    .eq("id_empresa", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar conta Asaas da empresa: ${error.message}`);
  }

  return mapAccount(data);
};

const getAccountByBranch = async (branchId) => {
  const { data, error } = await supabase
    .from("asaas_accounts")
    .select("*")
    .eq("id_filial", branchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar conta Asaas da filial: ${error.message}`);
  }

  return mapAccount(data);
};

/**
 * Busca e descriptografa a chave de API da conta Asaas — de uso
 * exclusivo do backend, na hora de efetivamente chamar a API do Asaas.
 * Nunca expor o retorno disso numa rota/resposta HTTP.
 */
const getApiKeyByCompany = async (companyId) => {
  const { data, error } = await supabase
    .from("asaas_accounts")
    .select("asaas_api_key")
    .eq("id_empresa", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar chave Asaas da empresa: ${error.message}`);
  }

  return data?.asaas_api_key ? decrypt(data.asaas_api_key) : null;
};

const getApiKeyByBranch = async (branchId) => {
  const { data, error } = await supabase
    .from("asaas_accounts")
    .select("asaas_api_key")
    .eq("id_filial", branchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar chave Asaas da filial: ${error.message}`);
  }

  return data?.asaas_api_key ? decrypt(data.asaas_api_key) : null;
};

/**
 * Busca e descriptografa o segredo de webhook — usado só na hora de
 * validar a assinatura de um webhook recebido do Asaas.
 */
const getWebhookSecretByCompany = async (companyId) => {
  const { data, error } = await supabase
    .from("asaas_accounts")
    .select("asaas_webhook_secret")
    .eq("id_empresa", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar segredo de webhook da empresa: ${error.message}`);
  }

  return data?.asaas_webhook_secret ? decrypt(data.asaas_webhook_secret) : null;
};

const getWebhookSecretByBranch = async (branchId) => {
  const { data, error } = await supabase
    .from("asaas_accounts")
    .select("asaas_webhook_secret")
    .eq("id_filial", branchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar segredo de webhook da filial: ${error.message}`);
  }

  return data?.asaas_webhook_secret ? decrypt(data.asaas_webhook_secret) : null;
};

/**
 * Cria ou atualiza a conta Asaas da empresa (matriz). Respeita o UNIQUE
 * do banco via upsert — nunca cria uma segunda linha pra mesma empresa.
 */
const upsertCompanyAccount = async (companyId, fields) => {
  const payload = buildPayload(fields);

  const { data, error } = await supabase
    .from("asaas_accounts")
    .upsert({ id_empresa: companyId, ...payload }, { onConflict: "id_empresa" })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao salvar conta Asaas da empresa: ${error.message}`);
  }

  return mapAccount(data);
};

const upsertBranchAccount = async (branchId, fields) => {
  const payload = buildPayload(fields);

  const { data, error } = await supabase
    .from("asaas_accounts")
    .upsert({ id_filial: branchId, ...payload }, { onConflict: "id_filial" })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao salvar conta Asaas da filial: ${error.message}`);
  }

  return mapAccount(data);
};

function buildPayload(fields) {
  const payload = { atualizado_em: new Date().toISOString() };

  if (fields.asaasAccountId !== undefined) payload.asaas_account_id = fields.asaasAccountId;
  if (fields.asaasWalletId !== undefined) payload.asaas_wallet_id = fields.asaasWalletId;
  // Criptografa antes de gravar — nunca guarda o valor em texto puro.
  if (fields.asaasApiKey !== undefined) payload.asaas_api_key = encrypt(fields.asaasApiKey);
  if (fields.asaasWebhookSecret !== undefined) payload.asaas_webhook_secret = encrypt(fields.asaasWebhookSecret);
  if (fields.onboardingStatus !== undefined) payload.asaas_onboarding_status = fields.onboardingStatus;
  if (fields.onboardingLink !== undefined) payload.asaas_onboarding_link = fields.onboardingLink;
  if (fields.splitEnabled !== undefined) payload.asaas_split_enabled = fields.splitEnabled;

  return payload;
}

module.exports = {
  getAccountByCompany,
  getAccountByBranch,
  getApiKeyByCompany,
  getApiKeyByBranch,
  getWebhookSecretByCompany,
  getWebhookSecretByBranch,
  upsertCompanyAccount,
  upsertBranchAccount,
};