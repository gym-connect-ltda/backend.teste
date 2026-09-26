const supabase = require("../../config/db");
const { applyBranchScope } = require("../../utils/branchScope");

function formatDate(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function mapHistory(row) {
  return {
    id: row.id_auditoria,
    date: formatDate(row.data_acao ?? row.criado_em),
    user: row.usuarios?.nome_usuario ?? "Sistema",
    action: row.acao,
    branch: row.filiais?.nome_filial ?? "",
    description: row.descricao ?? "",
  };
}

/**
 * Lista o histórico de ações da empresa autenticada, mais recentes primeiro.
 */
const listHistory = async (companyId, user) => {
  let query = supabase
    .from("auditoria")
    .select("*, usuarios(nome_usuario), filiais(nome_filial)")
    .eq("id_empresa", companyId);

  query = applyBranchScope(query, user);

  const { data: history, error } = await query
    .order("data_acao", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Erro ao listar o histórico do banco: ${error.message}`);
  }

  return history.map(mapHistory);
};

module.exports = { listHistory };
