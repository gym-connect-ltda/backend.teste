const supabase = require("../../config/db");
const { fetchAllRows } = require("../../utils/supabasePagination");
const { groupOverdueByPeriod, sumOverdueByBranch } = require("../../utils/delinquencyHistory");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Calculates the percentage change between two values, rounded to 1
 * decimal place. Returns null when it can't be calculated (zero base).
 */
function percentChange(current, previous) {
  if (!previous) return null;
  const change = ((current - previous) / previous) * 100;
  return Math.round(change * 10) / 10;
}

/**
 * Builds the dashboard indicators (total/active/inactive students and
 * overdue students), filtered by company and, optionally, by branch.
 */
const getDashboardMetrics = async (companyId, branchId, user) => {
  // Usuário restrito a uma filial nunca vê número de outra — ignora
  // qualquer branchId pedido e força a própria filial dele.
  const effectiveBranchId = user && !user.allBranchesAccess ? user.id_filial : branchId;

  // 1. Students (lightweight: only the fields needed to count in memory)
  // Paginated fetch: Supabase caps at 1000 rows per request by default,
  // and a large gym could have way more students than that.
  const students = await fetchAllRows(() => {
    let query = supabase
      .from("alunos")
      .select("id_aluno, status_aluno, data_cadastro_aluno")
      .eq("id_empresa", companyId);

    if (effectiveBranchId) {
      query = query.eq("id_filial", effectiveBranchId);
    }

    return query;
  });

  const totalStudents = students.length;
  const activeStudents = students.filter((s) => s.status_aluno).length;
  const inactiveStudents = totalStudents - activeStudents;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);

  const totalStudentsThirtyDaysAgo = students.filter((s) => {
    if (!s.data_cadastro_aluno) return false;
    return new Date(s.data_cadastro_aluno) <= thirtyDaysAgo;
  }).length;

  const totalTrend = percentChange(totalStudents, totalStudentsThirtyDaysAgo);

  // 2. Overdue: students with an unpaid, past-due payment
  const overduePayments = await fetchAllRows(() => {
    let query = supabase
      .from("pagamentos")
      .select("aluno_id, data_vencimento, confirmado_em")
      .eq("id_empresa", companyId)
      .is("confirmado_em", null)
      .lt("data_vencimento", now.toISOString().slice(0, 10));

    if (effectiveBranchId) {
      query = query.eq("id_filial", effectiveBranchId);
    }

    return query;
  });

  const overdueStudentIds = new Set((overduePayments ?? []).map((p) => p.aluno_id));
  const overdueStudents = overdueStudentIds.size;

  return {
    totalStudents: { value: totalStudents, trend: totalTrend },
    active: {
      value: activeStudents,
      percentage: totalStudents ? Math.round((activeStudents / totalStudents) * 1000) / 10 : 0,
    },
    inactive: {
      value: inactiveStudents,
      percentage: totalStudents ? Math.round((inactiveStudents / totalStudents) * 1000) / 10 : 0,
    },
    overdue: {
      value: overdueStudents,
      percentage: totalStudents
        ? Math.round((overdueStudents / totalStudents) * 1000) / 10
        : 0,
    },
  };
};

/**
 * Builds the delinquency (overdue payments) history comparison — monthly,
 * semester and yearly — broken down by branch, plus the grand total per
 * branch.
 *
 * IMPORTANT: since the database doesn't keep a daily snapshot of who was
 * overdue in the past, this reflects payments that REMAIN unpaid today,
 * grouped by the month/year they originally became due — it's not a
 * historical time series of the delinquency rate (if a student paid
 * later, they drop out of the history, which is the correct behavior:
 * they're no longer overdue).
 */
const getDelinquencyHistory = async (companyId, user) => {
  const isRestricted = user && !user.allBranchesAccess;

  const [branches, overduePayments] = await Promise.all([
    (() => {
      let query = supabase
        .from("filiais")
        .select("id_filial, nome_filial")
        .eq("id_empresa", companyId);

      if (isRestricted) {
        query = query.eq("id_filial", user.id_filial);
      }

      return query.then(({ data, error }) => {
        if (error) throw new Error(`Erro ao buscar filiais: ${error.message}`);
        return data;
      });
    })(),
    fetchAllRows(() => {
      let query = supabase
        .from("pagamentos")
        .select("id_filial, data_vencimento")
        .eq("id_empresa", companyId)
        .is("confirmado_em", null)
        .lt("data_vencimento", new Date().toISOString().slice(0, 10));

      if (isRestricted) {
        query = query.eq("id_filial", user.id_filial);
      }

      return query;
    }),
  ]);

  const branchIds = branches.map((b) => b.id_filial);

  const monthly = groupOverdueByPeriod(overduePayments, "month", 12, branchIds);
  const semesterly = groupOverdueByPeriod(overduePayments, "semester", 8, branchIds);
  const yearly = groupOverdueByPeriod(overduePayments, "year", 5, branchIds);

  const totalsByBranchMap = sumOverdueByBranch(overduePayments);
  const totalByBranch = branches.map((b) => ({
    id: b.id_filial,
    name: b.nome_filial,
    total: totalsByBranchMap.get(b.id_filial) || 0,
  }));

  const grandTotal = overduePayments.length;

  return {
    branches: branches.map((b) => ({ id: b.id_filial, name: b.nome_filial })),
    monthly,
    semesterly,
    yearly,
    totalByBranch,
    grandTotal,
  };
};

module.exports = { getDashboardMetrics, getDelinquencyHistory };
