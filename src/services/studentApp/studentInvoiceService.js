const supabase = require("../../config/db");

/**
 * Faturas do aluno (todas as academias em que ele tem matrícula, já que
 * a conta é global), separadas em pendentes e atrasadas.
 */
const listInvoices = async (studentAccountId) => {
  const { data: enrollments, error: enrollError } = await supabase
    .from("alunos")
    .select("id_aluno")
    .eq("id_aluno_app", studentAccountId);

  if (enrollError) {
    throw new Error(
      `Erro ao buscar matrículas do aluno: ${enrollError.message}`,
    );
  }

  const alunoIds = (enrollments || []).map((e) => e.id_aluno);
  if (alunoIds.length === 0) {
    return { pending: [], overdue: [] };
  }

  const { data: payments, error } = await supabase
    .from("pagamentos")
    .select(
      `
      id_pagamento, status, valor, data_vencimento, confirmado_em, tipo_pagamento,
      link_pagamento, receipt_url, plano, criado_em,
      filiais(nome_filial)
    `,
    )
    .in("aluno_id", alunoIds)
    .in("status", ["PENDING", "OVERDUE"])
    .order("data_vencimento", { ascending: true });

  if (error) {
    throw new Error(`Erro ao buscar faturas: ${error.message}`);
  }

  const formatted = (payments || []).map((p) => ({
    id: p.id_pagamento,
    status: p.status,
    value: p.valor,
    dueDate: p.data_vencimento,
    paidAt: p.confirmado_em,
    billingType: p.tipo_pagamento,
    checkoutUrl: p.link_pagamento,
    receiptUrl: p.receipt_url,
    plan: p.plano,
    academyName: p.filiais?.nome_filial || null,
  }));

  return {
    pending: formatted.filter((p) => p.status === "PENDING"),
    overdue: formatted.filter((p) => p.status === "OVERDUE"),
  };
};

module.exports = { listInvoices };
