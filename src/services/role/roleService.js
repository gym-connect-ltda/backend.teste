const supabase = require("../../config/db");

function mapRole(row) {
  return {
    id: row.id_perfil,
    name: row.nome_perfil,
    branch: row.filiais?.nome_filial ?? "",
    branchId: row.id_filial ?? null,
    status: row.status_perfil ? "Ativo" : "Inativo",
    permissions: row.permissoes_perfil ?? {},
    allBranchesAccess: row.acesso_todas_filiais ?? false,
  };
}

/**
 * Garante (quando informada) que a filial pertence à empresa autenticada.
 */
async function assertBranchBelongsToCompany(branchId, companyId) {
  if (!branchId) return;

  const { data: branch, error } = await supabase
    .from("filiais")
    .select("id_filial")
    .eq("id_filial", branchId)
    .eq("id_empresa", companyId)
    .single();

  if (error || !branch) {
    throw new Error("Filial inválida para esta empresa.");
  }
}

const listRoles = async (companyId) => {
  const { data: roles, error } = await supabase
    .from("perfis")
    .select("*, filiais(nome_filial)")
    .eq("id_empresa", companyId)
    .order("criado_em", { ascending: false });

  if (error) {
    throw new Error(`Erro ao listar perfis do banco: ${error.message}`);
  }

  return roles.map(mapRole);
};

const createRole = async ({ companyId, name, branchId, permissions, allBranchesAccess }) => {
  await assertBranchBelongsToCompany(branchId, companyId);

  const { data: role, error } = await supabase
    .from("perfis")
    .insert({
      id_empresa: companyId,
      id_filial: branchId || null,
      nome_perfil: name,
      permissoes_perfil: permissions,
      status_perfil: true,
      acesso_todas_filiais: Boolean(allBranchesAccess),
    })
    .select("*, filiais(nome_filial)")
    .single();

  if (error || !role) {
    throw new Error(`Erro ao cadastrar perfil no banco de dados: ${error?.message}`);
  }

  return mapRole(role);
};

const updateRole = async (
  roleId,
  companyId,
  { name, branchId, permissions, status, allBranchesAccess },
) => {
  if (branchId) {
    await assertBranchBelongsToCompany(branchId, companyId);
  }

  const updatePayload = {
    atualizado_em: new Date().toISOString(),
  };

  if (typeof name === "string") updatePayload.nome_perfil = name;
  if (branchId) updatePayload.id_filial = branchId;
  if (permissions) updatePayload.permissoes_perfil = permissions;
  if (typeof status === "string") {
    updatePayload.status_perfil = status === "Ativo";
  }
  if (typeof allBranchesAccess === "boolean") {
    updatePayload.acesso_todas_filiais = allBranchesAccess;
  }

  const { data: role, error } = await supabase
    .from("perfis")
    .update(updatePayload)
    .eq("id_perfil", roleId)
    .eq("id_empresa", companyId)
    .select("*, filiais(nome_filial)")
    .single();

  if (error || !role) {
    throw new Error(`Erro ao atualizar o perfil no banco: ${error?.message}`);
  }

  return mapRole(role);
};

module.exports = {
  listRoles,
  createRole,
  updateRole,
};