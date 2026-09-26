const supabase = require("../../config/db");
const { fetchAllRows } = require("../../utils/supabasePagination");

/**
 * Deriva o status de exibição a partir dos dados reais, em vez de confiar
 * cegamente na coluna `status` (texto livre) — mesma lógica já usada no
 * cálculo de inadimplência do dashboard, pra manter consistência em todo
 * o sistema.
 */
function deriveStatus(row) {
  if (row.confirmado_em) return "Paga";

  if (row.data_vencimento) {
    const today = new Date().toISOString().slice(0, 10);
    if (row.data_vencimento < today) return "Atrasada";
  }

  return "Pendente";
}

function mapPayment(row) {
  return {
    id: row.id_pagamento,
    studentId: row.aluno_id,
    studentName: row.alunos?.nome_aluno ?? "",
    plan: row.plano || "-",
    value: Number(row.valor),
    dueDate: row.data_vencimento,
    paidDate: row.confirmado_em,
    status: deriveStatus(row),
    paymentMethod: row.tipo_pagamento || null,
  };
}

/**
 * Lista as mensalidades (pagamentos de alunos) já existentes no banco,
 * agrupadas por aluno — é uma leitura do que já foi gerado (seed, import
 * manual, etc.), sem nenhuma integração com o Asaas: não cria, não cobra,
 * só mostra o que já está lá.
 */
const listStudentPayments = async (companyId) => {
  const payments = await fetchAllRows(() =>
    supabase
      .from("pagamentos")
      .select(
        `
        id_pagamento, aluno_id, plano, valor, data_vencimento,
        confirmado_em, tipo_pagamento,
        alunos(nome_aluno)
      `,
      )
      .eq("id_empresa", companyId)
      .order("data_vencimento", { ascending: false }),
  );

  const mapped = payments.map(mapPayment);

  const groupedByStudent = new Map();
  for (const payment of mapped) {
    if (!groupedByStudent.has(payment.studentId)) {
      groupedByStudent.set(payment.studentId, {
        studentId: payment.studentId,
        studentName: payment.studentName,
        payments: [],
      });
    }
    groupedByStudent.get(payment.studentId).payments.push(payment);
  }

  return Array.from(groupedByStudent.values());
};

module.exports = { listStudentPayments };
