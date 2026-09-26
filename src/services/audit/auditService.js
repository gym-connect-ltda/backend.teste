const supabase = require("../../config/db");

/**
 * Registra uma ação na tabela de auditoria.
 * Nunca lança erro para não quebrar o fluxo principal — apenas loga no console
 * caso a inserção falhe.
 */
const logAction = async ({ companyId, userId, branchId, action, description }) => {
  try {
    const { error } = await supabase.from("auditoria").insert({
      id_empresa: companyId,
      id_usuario: userId,
      id_filial: branchId,
      acao: action,
      descricao: description,
      data_acao: new Date().toISOString(),
    });

    if (error) {
      console.error("Erro ao registrar auditoria:", error.message);
    }
  } catch (err) {
    console.error("Erro inesperado ao registrar auditoria:", err.message);
  }
};

module.exports = { logAction };
