const supabase = require("../../config/db");
const { applyBranchScope } = require("../../utils/branchScope");
const { geocodeAddress } = require("../geocoding/geocodingService");

/**
 * Geocodifica o endereço e salva lat/long na filial. Best-effort: se
 * falhar, só loga — nunca lança erro pro chamador (cadastrar/editar
 * filial não pode travar por causa disso).
 */
async function geocodeAndSave(branchId, addressJson) {
  try {
    const coords = await geocodeAddress(addressJson);
    if (!coords) return;

    await supabase
      .from("filiais")
      .update({
        latitude: coords.latitude,
        longitude: coords.longitude,
        geocoded_em: new Date().toISOString(),
      })
      .eq("id_filial", branchId);
  } catch (err) {
    console.error(
      `[branchService] Falha ao geocodificar filial ${branchId}:`,
      err.message,
    );
  }
}

/**
 * Cadastra uma nova filial vinculada à empresa do usuário logado.
 */
const createBranch = async ({
  companyId,
  branchName,
  branchCnpj,
  branchPhone,
  zipCode,
  street,
  number,
  neighborhood,
  city,
  state,
}) => {
  const addressJson = {
    zipCode,
    street,
    number,
    neighborhood,
    city,
    state,
  };

  const { data: branch, error } = await supabase
    .from("filiais")
    .insert({
      id_empresa: companyId,
      nome_filial: branchName,
      cnpj_filial: branchCnpj,
      telefone_filial: branchPhone,
      endereco: addressJson,
      tipo_filial: "filial",
      status_filial: true,
      criado_em: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !branch) {
    throw new Error(
      `Erro ao cadastrar filial no banco de dados: ${error?.message}`,
    );
  }

  // Não usa "await" de propósito — geocodificar não deve atrasar a
  // resposta do cadastro. Roda em segundo plano e salva quando terminar.
  geocodeAndSave(branch.id_filial, addressJson);

  return branch;
};

const listBranches = async (companyId, user) => {
  let query = supabase
    .from("filiais")
    .select(
      "id_filial, nome_filial, cnpj_filial, telefone_filial, tipo_filial, status_filial, endereco, latitude, longitude, horario_atendimento, foto_banner_url, foto_perfil_url",
    )
    .eq("id_empresa", companyId);

  query = applyBranchScope(query, user);

  const { data: branches, error } = await query.order("criado_em", {
    ascending: false,
  });

  if (error) {
    throw new Error(`Erro ao listar filiais do banco: ${error.message}`);
  }

  // Mapeia e traduz o retorno para chaves em inglês que o front-end espera
  return branches.map((b) => ({
    id: b.id_filial,
    name: b.nome_filial,
    taxId: b.cnpj_filial,
    phone: b.telefone_filial,
    type: b.tipo_filial,
    isActive: b.status_filial,
    address: b.endereco,
    latitude: b.latitude,
    longitude: b.longitude,
    businessHours: b.horario_atendimento,
    bannerUrl: b.foto_banner_url,
    photoUrl: b.foto_perfil_url,
  }));
};

/**
 * Atualiza os dados cadastrais e o endereço de uma filial específica.
 */
const updateBranch = async (
  branchId,
  companyId,
  {
    branchName,
    branchCnpj,
    branchPhone,
    zipCode,
    street,
    number,
    neighborhood,
    city,
    state,
  },
) => {
  const addressJson = { zipCode, street, number, neighborhood, city, state };

  const { data: branch, error } = await supabase
    .from("filiais")
    .update({
      nome_filial: branchName,
      cnpj_filial: branchCnpj,
      telefone_filial: branchPhone,
      endereco: addressJson,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id_filial", branchId)
    .eq("id_empresa", companyId)
    .select()
    .single();

  if (error || !branch) {
    throw new Error(`Erro ao atualizar a filial no banco: ${error?.message}`);
  }

  // Endereço pode ter mudado — regeocodifica em segundo plano.
  geocodeAndSave(branch.id_filial, addressJson);

  return branch;
};

module.exports = {
  createBranch,
  listBranches,
  updateBranch,
  uploadBranchImage,
};

// ---------------------------------------------------------------------------
// Fotos da filial (banner + foto de perfil da academia) — Supabase Storage
// ---------------------------------------------------------------------------

const BRANCH_PHOTO_BUCKET = "academia-fotos"; // criar como bucket PÚBLICO no Supabase Storage
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

/**
 * @param {"banner"|"perfil"} kind - qual das duas imagens da filial
 */
async function uploadBranchImage(branchId, file, kind) {
  if (!file) throw new Error("Nenhuma imagem foi enviada.");
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    throw new Error("Formato inválido. Envie uma imagem JPG, PNG ou WEBP.");
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("A imagem deve ter no máximo 8MB.");
  }
  if (kind !== "banner" && kind !== "perfil") {
    throw new Error('Tipo de imagem inválido (use "banner" ou "perfil").');
  }

  const extension =
    file.mimetype === "image/png"
      ? "png"
      : file.mimetype === "image/webp"
        ? "webp"
        : "jpg";
  const filePath = `${branchId}/${kind}-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BRANCH_PHOTO_BUCKET)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Erro ao enviar imagem: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(BRANCH_PHOTO_BUCKET)
    .getPublicUrl(filePath);
  const imageUrl = publicUrlData?.publicUrl;
  if (!imageUrl)
    throw new Error("Não foi possível gerar a URL pública da imagem.");

  const column = kind === "banner" ? "foto_banner_url" : "foto_perfil_url";

  const { error: updateError } = await supabase
    .from("filiais")
    .update({ [column]: imageUrl, atualizado_em: new Date().toISOString() })
    .eq("id_filial", branchId);

  if (updateError)
    throw new Error(`Erro ao salvar imagem na filial: ${updateError.message}`);

  return imageUrl;
}
