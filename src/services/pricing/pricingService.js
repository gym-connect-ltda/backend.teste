const supabase = require("../../config/db");

function mapPricing(row) {
  return {
    id: row.id_precificacao,
    cycle: row.ciclo,
    value: Number(row.valor),
  };
}

/**
 * Lista as precificações (ciclo + valor) cadastradas pela empresa autenticada.
 */
const listPricing = async (companyId) => {
  const { data, error } = await supabase
    .from("precificacao")
    .select("*")
    .eq("id_empresa", companyId)
    .order("ciclo", { ascending: true });

  if (error) {
    throw new Error(`Erro ao listar precificações do banco: ${error.message}`);
  }

  return data.map(mapPricing);
};

const createPricing = async ({ companyId, cycle, value }) => {
  const { data, error } = await supabase
    .from("precificacao")
    .insert({
      id_empresa: companyId,
      ciclo: cycle,
      valor: value,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`Já existe uma precificação cadastrada para o ciclo "${cycle}".`);
    }
    throw new Error(`Erro ao cadastrar precificação no banco: ${error.message}`);
  }

  return mapPricing(data);
};

const updatePricing = async (pricingId, companyId, { cycle, value }) => {
  const updatePayload = { atualizado_em: new Date().toISOString() };
  if (cycle) updatePayload.ciclo = cycle;
  if (typeof value === "number") updatePayload.valor = value;

  const { data, error } = await supabase
    .from("precificacao")
    .update(updatePayload)
    .eq("id_precificacao", pricingId)
    .eq("id_empresa", companyId)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new Error(`Já existe uma precificação cadastrada para o ciclo "${cycle}".`);
    }
    throw new Error(`Erro ao atualizar precificação no banco: ${error?.message}`);
  }

  return mapPricing(data);
};

const deletePricing = async (pricingId, companyId) => {
  const { error } = await supabase
    .from("precificacao")
    .delete()
    .eq("id_precificacao", pricingId)
    .eq("id_empresa", companyId);

  if (error) {
    throw new Error(`Erro ao excluir precificação no banco: ${error.message}`);
  }

  return true;
};

module.exports = { listPricing, createPricing, updatePricing, deletePricing };
