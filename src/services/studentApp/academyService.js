const supabase = require("../../config/db");

/**
 * Distância em km entre duas coordenadas (fórmula de Haversine).
 */
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Lista academias (filiais) com subconta Asaas aprovada, opcionalmente
 * filtradas por proximidade (lat/lng do usuário + raio em km) e por
 * termo de busca no nome.
 */
const listNearby = async ({ lat, lng, radiusKm = 50, search }) => {
  let query = supabase
    .from("filiais")
    .select(
      `
      id_filial, nome_filial, telefone_filial, endereco, latitude, longitude,
      horario_atendimento, foto_banner_url, foto_perfil_url,
      id_empresa, empresas(nome_empresa),
      asaas_accounts!inner(asaas_onboarding_status)
    `,
    )
    .eq("status_filial", true)
    .eq("asaas_accounts.asaas_onboarding_status", "approved");

  if (search) {
    query = query.ilike("nome_filial", `%${search}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao listar academias: ${error.message}`);
  }

  let results = (data || []).map((branch) => ({
    id: branch.id_filial,
    name: branch.nome_filial,
    companyName: branch.empresas?.nome_empresa || null,
    phone: branch.telefone_filial,
    address: branch.endereco,
    latitude: branch.latitude,
    longitude: branch.longitude,
    businessHours: branch.horario_atendimento,
    bannerUrl: branch.foto_banner_url,
    photoUrl: branch.foto_perfil_url,
    distanceKm: null,
  }));

  // Só calcula/filtra por distância se o app mandou a localização do
  // usuário — sem isso, devolve a lista completa (sem ordenação por perto).
  if (lat !== undefined && lng !== undefined) {
    results = results
      .filter((branch) => branch.latitude !== null && branch.longitude !== null)
      .map((branch) => ({
        ...branch,
        distanceKm:
          Math.round(
            distanceKm(lat, lng, branch.latitude, branch.longitude) * 10,
          ) / 10,
      }))
      .filter((branch) => branch.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  return results;
};

/**
 * Detalhe completo de uma academia (filial) — usado na tela de perfil da
 * academia dentro do app.
 */
const getDetail = async (branchId) => {
  const { data, error } = await supabase
    .from("filiais")
    .select(
      `
      id_filial, nome_filial, telefone_filial, endereco, latitude, longitude,
      horario_atendimento, foto_banner_url, foto_perfil_url, status_filial,
      id_empresa, empresas(nome_empresa),
      asaas_accounts(asaas_onboarding_status)
    `,
    )
    .eq("id_filial", branchId)
    .single();

  if (error || !data) {
    throw new Error("Academia não encontrada.");
  }

  const isApproved =
    data.asaas_accounts?.asaas_onboarding_status === "approved";
  if (!data.status_filial || !isApproved) {
    throw new Error(
      "Esta academia não está disponível para novas matrículas no momento.",
    );
  }

  return {
    id: data.id_filial,
    name: data.nome_filial,
    companyName: data.empresas?.nome_empresa || null,
    phone: data.telefone_filial,
    address: data.endereco,
    latitude: data.latitude,
    longitude: data.longitude,
    businessHours: data.horario_atendimento,
    bannerUrl: data.foto_banner_url,
    photoUrl: data.foto_perfil_url,
  };
};

/**
 * Planos/preços da academia (a precificação é por EMPRESA, não por
 * filial — confirmado com o cliente: todas as filiais da mesma empresa
 * cobram o mesmo valor/ciclo).
 */
const getPlans = async (branchId) => {
  const { data: branch, error: branchError } = await supabase
    .from("filiais")
    .select("id_empresa")
    .eq("id_filial", branchId)
    .single();

  if (branchError || !branch) {
    throw new Error("Academia não encontrada.");
  }

  const { data: plans, error } = await supabase
    .from("precificacao")
    .select("id_precificacao, ciclo, valor")
    .eq("id_empresa", branch.id_empresa)
    .order("valor", { ascending: true });

  if (error) {
    throw new Error(`Erro ao buscar planos: ${error.message}`);
  }

  return plans;
};

module.exports = { listNearby, getDetail, getPlans };
