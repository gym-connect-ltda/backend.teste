const supabase = require("../../config/db");
const { fetchAllRows } = require("../../utils/supabasePagination");
const { generateRecurringDates } = require("../../utils/recurringDates");
const { applyBranchScope } = require("../../utils/branchScope");

function mapTransaction(row) {
  return {
    id: row.id,
    value: Number(row.valor),
    date: row.data,
    categoryId: row.id_categoria,
    category: row.categorias_fluxo_caixa?.nome_categoria ?? "",
    branchId: row.id_filial,
    branch: row.filiais?.nome_filial ?? "",
    paymentMethod: row.tipo_pagamento,
    type: row.tipo,
    description: row.descricao,
    recurring: row.recorrente || false,
    startDate: row.data_inicio || null,
    endDate: row.data_fim || null,
    user: row.usuarios?.nome_usuario ?? "-",
    createdAt: row.criado_em,
  };
}

/**
 * Lista transações da empresa, com filtro opcional por filial e por
 * mês/ano (baseado num intervalo de datas reais — a versão anterior
 * tentava filtrar por colunas que não existem na tabela, então nunca
 * funcionava de verdade).
 */
const listTransactions = async (companyId, { branchId, month, year } = {}, user) => {
  const transactions = await fetchAllRows(() => {
    let query = supabase
      .from("fluxo_caixa")
      .select(
        `
        id, valor, data, id_categoria, id_filial, tipo_pagamento, tipo,
        descricao, recorrente, data_inicio, data_fim, criado_em,
        categorias_fluxo_caixa(nome_categoria),
        filiais(nome_filial),
        usuarios(nome_usuario)
      `,
      )
      .eq("id_empresa", companyId)
      .order("data", { ascending: false });

    if (branchId) {
      query = query.eq("id_filial", branchId);
    }

    // Aplica por cima do filtro opcional acima — se o usuário for
    // restrito a uma filial, nunca vê lançamento de outra, mesmo que o
    // filtro pedido seja diferente (nesse caso, o resultado é vazio, não
    // um vazamento de dado de outra filial).
    query = applyBranchScope(query, user);

    if (year) {
      const y = Number(year);
      const m = month ? Number(month) : null;

      const startDate = m ? `${y}-${String(m).padStart(2, "0")}-01` : `${y}-01-01`;
      const endDate = m
        ? new Date(y, m, 0).toISOString().slice(0, 10) // último dia do mês
        : `${y}-12-31`;

      query = query.gte("data", startDate).lte("data", endDate);
    }

    return query;
  });

  return transactions.map(mapTransaction);
};

async function assertBranchBelongsToCompany(branchId, companyId) {
  const { data: branch, error } = await supabase
    .from("filiais")
    .select("id_filial")
    .eq("id_filial", branchId)
    .eq("id_empresa", companyId)
    .single();

  if (error || !branch) {
    throw new Error(`Filial inválida para esta empresa (id ${branchId}).`);
  }
}

/**
 * Cria uma ou mais transações. Se `allBranches` for true, replica a
 * transação pra cada filial da empresa. Se `recurring` for true, gera
 * uma transação por mês entre startDate e endDate (multiplicado pelas
 * filiais, se `allBranches` também estiver marcado).
 */
const createTransaction = async ({
  companyId,
  userId,
  value,
  date,
  categoryId,
  branchId,
  allBranches,
  paymentMethod,
  type,
  description,
  recurring,
  startDate,
  endDate,
}) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    throw new Error("Informe um valor válido.");
  }

  if (!categoryId) {
    throw new Error("Selecione uma categoria.");
  }

  if (!allBranches && !branchId) {
    throw new Error("Selecione uma filial ou marque 'todas as filiais'.");
  }

  if (!paymentMethod) {
    throw new Error("Selecione a forma de pagamento.");
  }

  if (type !== "entrada" && type !== "saida") {
    throw new Error("Tipo de lançamento inválido.");
  }

  if (recurring && (!startDate || !endDate)) {
    throw new Error("Informe a data inicial e final do lançamento recorrente.");
  }

  if (!recurring && !date) {
    throw new Error("Informe a data do lançamento.");
  }

  // Resolve as filiais de destino
  let branchIds = [];
  if (allBranches) {
    const { data: branches, error } = await supabase
      .from("filiais")
      .select("id_filial")
      .eq("id_empresa", companyId);

    if (error) {
      throw new Error(`Erro ao buscar filiais: ${error.message}`);
    }

    branchIds = branches.map((b) => b.id_filial);

    if (branchIds.length === 0) {
      throw new Error("Nenhuma filial cadastrada para replicar o lançamento.");
    }
  } else {
    await assertBranchBelongsToCompany(branchId, companyId);
    branchIds = [Number(branchId)];
  }

  const baseRow = {
    id_empresa: companyId,
    id_usuario: userId,
    valor: Number(value),
    id_categoria: Number(categoryId),
    tipo_pagamento: paymentMethod,
    tipo: type,
    descricao: description || null,
  };

  let rowsToInsert = [];

  if (recurring) {
    const dates = generateRecurringDates(startDate, endDate);

    if (dates.length === 0) {
      throw new Error("Período recorrente inválido — verifique as datas.");
    }

    for (const d of dates) {
      for (const bId of branchIds) {
        rowsToInsert.push({
          ...baseRow,
          id_filial: bId,
          data: d,
          recorrente: true,
          data_inicio: startDate,
          data_fim: endDate,
        });
      }
    }
  } else {
    rowsToInsert = branchIds.map((bId) => ({
      ...baseRow,
      id_filial: bId,
      data: date,
      recorrente: false,
      data_inicio: null,
      data_fim: null,
    }));
  }

  const { data, error } = await supabase
    .from("fluxo_caixa")
    .insert(rowsToInsert)
    .select();

  if (error) {
    throw new Error(`Erro ao cadastrar lançamento: ${error.message}`);
  }

  return { count: data.length, transactions: data };
};

const updateTransaction = async (transactionId, companyId, updates, user) => {
  const allowedFields = {
    valor: updates.value !== undefined ? Number(updates.value) : undefined,
    data: updates.date,
    id_categoria: updates.categoryId ? Number(updates.categoryId) : undefined,
    id_filial: updates.branchId ? Number(updates.branchId) : undefined,
    tipo_pagamento: updates.paymentMethod,
    tipo: updates.type,
    descricao: updates.description,
  };

  const updatePayload = Object.fromEntries(
    Object.entries(allowedFields).filter(([, v]) => v !== undefined),
  );

  if (Object.keys(updatePayload).length === 0) {
    throw new Error("Nenhum campo para atualizar.");
  }

  if (updatePayload.id_filial) {
    await assertBranchBelongsToCompany(updatePayload.id_filial, companyId);
  }

  let query = supabase
    .from("fluxo_caixa")
    .update(updatePayload)
    .eq("id", transactionId)
    .eq("id_empresa", companyId);

  query = applyBranchScope(query, user);

  const { data, error } = await query
    .select(
      `
      id, valor, data, id_categoria, id_filial, tipo_pagamento, tipo,
      descricao, recorrente, data_inicio, data_fim, criado_em,
      categorias_fluxo_caixa(nome_categoria),
      filiais(nome_filial),
      usuarios(nome_usuario)
    `,
    )
    .single();

  if (error || !data) {
    throw new Error(`Erro ao atualizar lançamento: ${error?.message}`);
  }

  return mapTransaction(data);
};

const deleteTransaction = async (transactionId, companyId, user) => {
  let query = supabase
    .from("fluxo_caixa")
    .delete()
    .eq("id", transactionId)
    .eq("id_empresa", companyId);

  query = applyBranchScope(query, user);

  const { error } = await query;

  if (error) {
    throw new Error(`Erro ao excluir lançamento: ${error.message}`);
  }

  return true;
};

module.exports = {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
};