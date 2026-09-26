/**
 * O Supabase/PostgREST retorna no máximo 1000 linhas por requisição por
 * padrão, mesmo que a tabela tenha muito mais registros — não é um erro,
 * é o limite padrão de paginação da API (max-rows). Esse helper busca
 * TODAS as linhas de uma consulta, paginando em blocos até não sobrar
 * mais nada.
 *
 * @param {() => import("@supabase/supabase-js").PostgrestFilterBuilder} buildQuery
 *   Função que retorna uma NOVA instância do query builder a cada chamada
 *   (com os filtros/order já aplicados, mas sem `.range()`), porque o
 *   builder do supabase-js não pode ser reutilizado depois de executado.
 * @param {number} pageSize
 */
async function fetchAllRows(buildQuery, pageSize = 1000) {
  let allRows = [];
  let from = 0;

  // Segurança: nunca faz mais de 1000 páginas (10 milhões de linhas),
  // evitando loop infinito em caso de comportamento inesperado da API.
  const MAX_PAGES = 1000;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    allRows = allRows.concat(data);

    if (data.length < pageSize) {
      break; // última página (veio menos que o tamanho do bloco)
    }

    from += pageSize;
  }

  return allRows;
}

module.exports = { fetchAllRows };
