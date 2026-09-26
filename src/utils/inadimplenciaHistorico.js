const MESES_PT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/**
 * A partir de uma data de vencimento, calcula a chave/label/ordenação
 * do período (mês, semestre ou ano) ao qual ela pertence.
 */
function periodOf(dateStr, granularity) {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-12

  if (granularity === "month") {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const label = `${MESES_PT[month - 1]}/${String(year).slice(-2)}`;
    return { key, label, sortValue: year * 100 + month };
  }

  if (granularity === "semester") {
    const sem = month <= 6 ? 1 : 2;
    const key = `${year}-S${sem}`;
    const label = `${sem}\u00BA sem/${year}`;
    return { key, label, sortValue: year * 10 + sem };
  }

  // "year"
  const key = `${year}`;
  return { key, label: key, sortValue: year };
}

/**
 * Agrupa pagamentos em aberto (inadimplência) por período (mês/semestre/ano)
 * e por filial, retornando os últimos `limit` períodos em ordem cronológica.
 *
 * @param {{id_filial: number, data_vencimento: string}[]} payments
 * @param {"month"|"semester"|"year"} granularity
 * @param {number} limit
 * @param {number[]} allBranchIds — garante que todo período tenha uma entrada
 *   (mesmo que zero) para cada filial, útil pra desenhar o gráfico sem buracos.
 */
function groupOverdueByPeriod(payments, granularity, limit, allBranchIds = []) {
  const buckets = new Map(); // key -> { label, sortValue, porFilial: Map, total }

  for (const payment of payments) {
    if (!payment.data_vencimento) continue;

    const { key, label, sortValue } = periodOf(payment.data_vencimento, granularity);

    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label,
        sortValue,
        porFilial: new Map(),
        total: 0,
      });
    }

    const bucket = buckets.get(key);
    const branchId = payment.id_filial;
    bucket.porFilial.set(branchId, (bucket.porFilial.get(branchId) || 0) + 1);
    bucket.total += 1;
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => a.sortValue - b.sortValue);
  const lastN = limit ? sorted.slice(-limit) : sorted;

  return lastN.map((bucket) => {
    const porFilial = {};
    for (const branchId of allBranchIds) {
      porFilial[branchId] = bucket.porFilial.get(branchId) || 0;
    }
    // Inclui também filiais que apareceram nos dados mas não estavam na lista (segurança)
    for (const [branchId, count] of bucket.porFilial.entries()) {
      if (!(branchId in porFilial)) porFilial[branchId] = count;
    }

    return {
      period: bucket.key,
      label: bucket.label,
      total: bucket.total,
      porFilial,
    };
  });
}

/**
 * Total de pagamentos em aberto por filial (independente de período).
 */
function totalByBranch(payments) {
  const totals = new Map();
  for (const payment of payments) {
    totals.set(payment.id_filial, (totals.get(payment.id_filial) || 0) + 1);
  }
  return totals;
}

module.exports = { periodOf, groupOverdueByPeriod, totalByBranch };
