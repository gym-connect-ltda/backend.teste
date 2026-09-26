const MONTH_LABELS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/**
 * From a due date, calculates the key/label/sort order of the period
 * (month, semester or year) it belongs to.
 */
function periodOf(dateStr, granularity) {
  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-12

  if (granularity === "month") {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const label = `${MONTH_LABELS[month - 1]}/${String(year).slice(-2)}`;
    return { key, label, sortValue: year * 100 + month };
  }

  if (granularity === "semester") {
    const half = month <= 6 ? 1 : 2;
    const key = `${year}-S${half}`;
    const label = `${half}\u00BA sem/${year}`;
    return { key, label, sortValue: year * 10 + half };
  }

  // "year"
  const key = `${year}`;
  return { key, label: key, sortValue: year };
}

/**
 * Groups overdue payments (delinquency) by period (month/semester/year)
 * and by branch, returning the last `limit` periods in chronological order.
 *
 * @param {{id_filial: number, data_vencimento: string}[]} payments
 * @param {"month"|"semester"|"year"} granularity
 * @param {number} limit
 * @param {number[]} allBranchIds — ensures every period has an entry (even
 *   zero) for each branch, so the chart never has gaps.
 */
function groupOverdueByPeriod(payments, granularity, limit, allBranchIds = []) {
  const buckets = new Map(); // key -> { label, sortValue, byBranch: Map, total }

  for (const payment of payments) {
    if (!payment.data_vencimento) continue;

    const { key, label, sortValue } = periodOf(payment.data_vencimento, granularity);

    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label,
        sortValue,
        byBranch: new Map(),
        total: 0,
      });
    }

    const bucket = buckets.get(key);
    const branchId = payment.id_filial;
    bucket.byBranch.set(branchId, (bucket.byBranch.get(branchId) || 0) + 1);
    bucket.total += 1;
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => a.sortValue - b.sortValue);
  const lastN = limit ? sorted.slice(-limit) : sorted;

  return lastN.map((bucket) => {
    const byBranch = {};
    for (const branchId of allBranchIds) {
      byBranch[branchId] = bucket.byBranch.get(branchId) || 0;
    }
    // Also includes branches that showed up in the data but weren't in the list (safety net).
    for (const [branchId, count] of bucket.byBranch.entries()) {
      if (!(branchId in byBranch)) byBranch[branchId] = count;
    }

    return {
      period: bucket.key,
      label: bucket.label,
      total: bucket.total,
      byBranch,
    };
  });
}

/**
 * Total overdue payments per branch (regardless of period).
 */
function sumOverdueByBranch(payments) {
  const totals = new Map();
  for (const payment of payments) {
    totals.set(payment.id_filial, (totals.get(payment.id_filial) || 0) + 1);
  }
  return totals;
}

module.exports = { periodOf, groupOverdueByPeriod, sumOverdueByBranch };
