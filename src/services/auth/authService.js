const supabase = require("../../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { validateStrongPassword } = require("../../utils/validators");

const login = async (email, password) => {
  const { data: user, error: userError } = await supabase
    .from("usuarios")
    .select(
      `
      id_usuario, nome_usuario, id_empresa, email_usuario, senha_usuario, id_filial, id_perfil, status_usuario,
      permissoes_usuario, acesso_todas_filiais,
      primeiro_acesso_usuario, aceitou_termos, data_aceite_termos, ip_aceite_termos, versao_termos_aceitos
    `,
    )
    .eq("email_usuario", email)
    .single();

  if (userError || !user) throw new Error("Credenciais inválidas");

  if (!user.status_usuario) {
    throw new Error("Usuário inativo, sem permissão para acessar o sistema!");
  }

  const isPasswordValid = await bcrypt.compare(password, user.senha_usuario);

  if (!isPasswordValid) throw new Error("Credenciais inválidas");

  const { data: profile } = await supabase
    .from("perfis")
    .select("nome_perfil")
    .eq("id_perfil", user.id_perfil)
    .maybeSingle();

  const permissions = user.permissoes_usuario || {};

  const { data: company } = await supabase
    .from("empresas")
    .select("nome_empresa")
    .eq("id_empresa", user.id_empresa)
    .single();

  const { data: branch } = await supabase
    .from("filiais")
    .select("nome_filial")
    .eq("id_filial", user.id_filial)
    .maybeSingle();

  const tokenPayload = {
    id_usuario: user.id_usuario,
    id_empresa: user.id_empresa,
    id_filial: user.id_filial,
    id_perfil: user.id_perfil,
    nome_usuario: user.nome_usuario,
    email_usuario: user.email_usuario,
    permissions,
    allBranchesAccess: user.acesso_todas_filiais || false,
    nome_empresa: company?.nome_empresa,
    nome_filial: branch?.nome_filial,
    perfil_usuario: profile?.nome_perfil,
    primeiro_acesso_usuario: user.primeiro_acesso_usuario,
    aceitou_termos: user.aceitou_termos,
    data_aceite_termos: user.data_aceite_termos,
    ip_aceite_termos: user.ip_aceite_termos,
    versao_termos_aceitos: user.versao_termos_aceitos,
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
    expiresIn: "8h",
  });

  return { token, user: tokenPayload };
};

const getProfile = async (userId) => {
  const { data, error } = await supabase
    .from("usuarios")
    .select(
      `
      id_usuario, nome_usuario, email_usuario, avatar_url,
      perfil:perfis (id_perfil, nome_perfil),
      empresa:empresas (id_empresa, nome_empresa, cnpj_empresa),
      filial:filiais (id_filial, nome_filial, endereco)
    `,
    )
    .eq("id_usuario", userId)
    .single();

  if (error || !data)
    throw new Error("Usuário/Empresa/Filial/Perfil não encontrado(s)");

  const { empresa, filial, perfil, ...user } = data;
  return { user, company: empresa, branch: filial, profile: perfil };
};

const changePassword = async (userId, currentPassword, newPassword) => {
  if (!validateStrongPassword(newPassword)) {
    throw new Error(
      "A senha deve ter no mínimo 6 caracteres, incluindo letra, número e caractere especial.",
    );
  }

  const { data: user, error } = await supabase
    .from("usuarios")
    .select("senha_usuario")
    .eq("id_usuario", userId)
    .single();

  if (error || !user) throw new Error("Usuário não encontrado.");

  const isPasswordCorrect = await bcrypt.compare(
    currentPassword,
    user.senha_usuario,
  );
  if (!isPasswordCorrect) throw new Error("Senha atual incorreta.");

  const hashedNewPassword = await bcrypt.hash(newPassword, 10);

  const { error: updateError } = await supabase
    .from("usuarios")
    .update({ senha_usuario: hashedNewPassword })
    .eq("id_usuario", userId);

  if (updateError)
    throw new Error("Erro ao atualizar senha no banco de dados.");
  return true;
};

// Nome do bucket no Supabase Storage usado para fotos de perfil.
// Caso ainda não exista, crie um bucket PÚBLICO com este nome no painel do
// Supabase (Storage > New bucket > "avatars", marcar como Public).
const AVATAR_BUCKET = "avatars";

const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const uploadAvatar = async (userId, file) => {
  if (!file) {
    throw new Error("Nenhum arquivo de imagem foi enviado.");
  }

  if (!ALLOWED_AVATAR_TYPES.includes(file.mimetype)) {
    throw new Error("Formato inválido. Envie uma imagem JPG, PNG ou WEBP.");
  }

  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    throw new Error("A imagem deve ter no máximo 5MB.");
  }

  const extension =
    file.mimetype === "image/png"
      ? "png"
      : file.mimetype === "image/webp"
        ? "webp"
        : "jpg";
  const filePath = `${userId}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `Erro ao enviar imagem para o Storage: ${uploadError.message}`,
    );
  }

  const { data: publicUrlData } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(filePath);

  const avatarUrl = publicUrlData?.publicUrl;

  if (!avatarUrl) {
    throw new Error("Não foi possível gerar a URL pública da imagem.");
  }

  const { error: updateError } = await supabase
    .from("usuarios")
    .update({ avatar_url: avatarUrl, atualizado_em: new Date().toISOString() })
    .eq("id_usuario", userId);

  if (updateError) {
    throw new Error(`Erro ao salvar a foto no perfil: ${updateError.message}`);
  }

  return avatarUrl;
};

const acceptTerms = async (userId, version, ip) => {
  const acceptDate = new Date().toISOString();
  const currentVersion = version || "1.0";

  const { error } = await supabase
    .from("usuarios")
    .update({
      primeiro_acesso_usuario: false,
      aceitou_termos: true,
      data_aceite_termos: acceptDate,
      ip_aceite_termos: ip,
      versao_termos_aceitos: currentVersion,
    })
    .eq("id_usuario", userId);

  if (error) throw new Error("Erro ao registrar aceite.");

  return {
    primeiro_acesso_usuario: false,
    aceitou_termos: true,
    data_aceite_termos: acceptDate,
    ip_aceite_termos: ip,
    versao_termos_aceitos: currentVersion,
  };
};

module.exports = {
  login,
  getProfile,
  changePassword,
  acceptTerms,
  uploadAvatar,
};
