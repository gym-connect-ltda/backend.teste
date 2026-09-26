/**
 * Gera as datas mensais de um lançamento recorrente entre startDate e
 * endDate (inclusive), mantendo o "dia" original — quando o mês não tem
 * esse dia (ex: dia 31 em fevereiro), cai no último dia daquele mês.
 *
 * Correção em relação à versão anterior: o avanço de mês é calculado a
 * partir de um contador numérico (ano/mês base + offset), não mutando um
 * objeto Date com dia potencialmente "estourado" — isso evitava que
 * fevereiro fosse pulado inteiro em assinaturas com vencimento no dia 31.
 */
function generateRecurringDates(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const day = start.getDate();
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();

  let offset = 0;
  while (true) {
    const year = startYear + Math.floor((startMonth + offset) / 12);
    const month = (startMonth + offset) % 12;

    let candidate = new Date(year, month, day);
    if (candidate.getMonth() !== month) {
      candidate = new Date(year, month + 1, 0); // último dia do mês
    }

    if (candidate > end) break;

    dates.push(candidate.toISOString().slice(0, 10));
    offset++;

    if (offset > 1200) break; // segurança: nunca mais que 100 anos
  }

  return dates;
}

module.exports = { generateRecurringDates };