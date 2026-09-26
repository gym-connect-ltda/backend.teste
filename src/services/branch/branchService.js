const supabase = require("../../config/db");
const { applyBranchScope } = require("../../utils/branchScope");

/**
 * Cadastra uma nova filial vinculada à empresa do usuário logado.
 */
const createBranch = async ({
  companyId,
  branchName,
  branchCnpj,
  branchPhone,
  zipCode,
  street,
  number,
  neighborhood,
  city,
  state,
}) => {
  const addressJson = {
    zipCode,
    street,
    number,
    neighborhood,
    city,
    state,
  };

  const { data: branch, error } = await supabase
    .from("filiais")
    .insert({
      id_empresa: companyId,
      nome_filial: branchName,
      cnpj_filial: branchCnpj,
      telefone_filial: branchPhone,
      endereco: addressJson,
      tipo_filial: "filial",
      status_filial: true,
      criado_em: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !branch) {
    throw new Error(
      `Erro ao cadastrar filial no banco de dados: ${error?.message}`,
    );
  }

  return branch;
};

const listBranches = async (companyId, user) => {
  let query = supabase
    .from("filiais")
    .select(
      "id_filial, nome_filial, cnpj_filial, telefone_filial, tipo_filial, status_filial, endereco",
    )
    .eq("id_empresa", companyId);

  query = applyBranchScope(query, user);

  const { data: branches, error } = await query.order("criado_em", {
    ascending: false,
  });

  if (error) {
    throw new Error(`Erro ao listar filiais do banco: ${error.message}`);
  }

  // Mapeia e traduz o retorno para chaves em inglês que o front-end espera
  return branches.map((b) => ({
    id: b.id_filial,
    name: b.nome_filial,
    taxId: b.cnpj_filial,
    phone: b.telefone_filial,
    type: b.tipo_filial,
    isActive: b.status_filial,
    address: b.endereco,
  }));
};

/**
 * Atualiza os dados cadastrais e o endereço de uma filial específica.
 */
const updateBranch = async (
  branchId,
  companyId,
  {
    branchName,
    branchCnpj,
    branchPhone,
    zipCode,
    street,
    number,
    neighborhood,
    city,
    state,
  },
) => {
  const addressJson = { zipCode, street, number, neighborhood, city, state };

  const { data: branch, error } = await supabase
    .from("filiais")
    .update({
      nome_filial: branchName,
      cnpj_filial: branchCnpj,
      telefone_filial: branchPhone,
      endereco: addressJson,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id_filial", branchId)
    .eq("id_empresa", companyId)
    .select()
    .single();

  if (error || !branch) {
    throw new Error(`Erro ao atualizar a filial no banco: ${error?.message}`);
  }

  return branch;
};

const deactivateBranch = async (companyId) => {
  const { error } = await supabase.rpc("inativar_empresa", {
    p_id_empresa: companyId,
  });

  if (error) {
    throw error;
  }
};

module.exports = {
  createBranch,
  listBranches,
  updateBranch,
  deactivateBranch,
};
