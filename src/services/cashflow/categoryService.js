const supabase = require("../../config/db");

function mapCategory(row) {
  return {
    id: row.id_categoria,
    name: row.nome_categoria,
    branchId: row.id_filial ?? null,
    branch: row.filiais?.nome_filial ?? null,
  };
}

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

/**
 * Checa duplicidade de nome dentro do mesmo escopo (mesma empresa E mesma
 * filial — ou mesma empresa E "todas as filiais", quando branchId é nulo).
 * Isso permite, por exemplo, "Manutenção" existir tanto como categoria
 * geral da empresa quanto como categoria específica de uma filial.
 */
async function findDuplicateCategory(companyId, name, branchId, excludeId) {
  let query = supabase
    .from("categorias_fluxo_caixa")
    .select("id_categoria")
    .eq("id_empresa", companyId)
    .eq("nome_categoria", name.trim());

  query = branchId ? query.eq("id_filial", branchId) : query.is("id_filial", null);

  if (excludeId) {
    query = query.neq("id_categoria", excludeId);
  }

  const { data } = await query.maybeSingle();
  return data;
}

const listCategories = async (companyId, user) => {
  let query = supabase
    .from("categorias_fluxo_caixa")
    .select("id_categoria, nome_categoria, id_filial, filiais(nome_filial)")
    .eq("id_empresa", companyId);

  // Usuário restrito a uma filial vê as categorias gerais (sem filial) +
  // as específicas da própria filial — nunca as de outra filial.
  if (!user.allBranchesAccess) {
    query = query.or(`id_filial.is.null,id_filial.eq.${user.id_filial}`);
  }

  const { data, error } = await query.order("nome_categoria", { ascending: true });

  if (error) {
    throw new Error(`Erro ao listar categorias: ${error.message}`);
  }

  return data.map(mapCategory);
};

const createCategory = async (companyId, name, branchId) => {
  if (!name || !name.trim()) {
    throw new Error("O nome da categoria é obrigatório.");
  }

  await assertBranchBelongsToCompany(branchId, companyId);

  const existing = await findDuplicateCategory(companyId, name, branchId);
  if (existing) {
    throw new Error(
      branchId
        ? "Esta categoria já existe para esta filial."
        : "Esta categoria já existe (geral, para todas as filiais).",
    );
  }

  const { data, error } = await supabase
    .from("categorias_fluxo_caixa")
    .insert({
      id_empresa: companyId,
      nome_categoria: name.trim(),
      id_filial: branchId || null,
    })
    .select("id_categoria, nome_categoria, id_filial, filiais(nome_filial)")
    .single();

  if (error) {
    throw new Error(`Erro ao cadastrar categoria: ${error.message}`);
  }

  return mapCategory(data);
};

const updateCategory = async (categoryId, companyId, name, branchId) => {
  if (!name || !name.trim()) {
    throw new Error("O nome da categoria é obrigatório.");
  }

  await assertBranchBelongsToCompany(branchId, companyId);

  const existing = await findDuplicateCategory(companyId, name, branchId, categoryId);
  if (existing) {
    throw new Error(
      branchId
        ? "Já existe outra categoria com este nome para esta filial."
        : "Já existe outra categoria geral com este nome.",
    );
  }

  const { data, error } = await supabase
    .from("categorias_fluxo_caixa")
    .update({
      nome_categoria: name.trim(),
      id_filial: branchId || null,
    })
    .eq("id_categoria", categoryId)
    .eq("id_empresa", companyId)
    .select("id_categoria, nome_categoria, id_filial, filiais(nome_filial)")
    .single();

  if (error || !data) {
    throw new Error(`Erro ao atualizar categoria: ${error?.message}`);
  }

  return mapCategory(data);
};

const deleteCategory = async (categoryId, companyId, user) => {
  const { data: existing, error: checkError } = await supabase
    .from("categorias_fluxo_caixa")
    .select("id_categoria, id_filial")
    .eq("id_categoria", categoryId)
    .eq("id_empresa", companyId)
    .single();

  if (checkError || !existing) {
    throw new Error("Categoria não encontrada.");
  }

  if (
    user &&
    !user.allBranchesAccess &&
    (existing.id_filial === null || Number(existing.id_filial) !== Number(user.id_filial))
  ) {
    throw new Error("Você só pode excluir categorias da sua própria filial.");
  }

  const { error } = await supabase
    .from("categorias_fluxo_caixa")
    .delete()
    .eq("id_categoria", categoryId)
    .eq("id_empresa", companyId);

  if (error) {
    // 23503 = foreign key violation (categoria em uso por alguma transação)
    if (error.code === "23503") {
      throw new Error(
        "Não é possível excluir: existem lançamentos usando esta categoria.",
      );
    }
    throw new Error(`Erro ao excluir categoria: ${error.message}`);
  }

  return true;
};

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };