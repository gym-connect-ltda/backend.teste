const supabase = require("../../config/db");
const bcrypt = require("bcryptjs");
const { validateStrongPassword, validateEmail } = require("../../utils/validators");

function mapUser(row) {
  return {
    id: row.id_usuario,
    name: row.nome_usuario,
    email: row.email_usuario,
    profile: row.perfis?.nome_perfil ?? "",
    profileId: row.id_perfil,
    branch: row.filiais?.nome_filial ?? "",
    branchId: row.id_filial,
    status: row.status_usuario ? "Ativo" : "Inativo",
    avatarUrl: row.avatar_url ?? null,
    permissions: row.permissoes_usuario ?? {},
    allBranchesAccess: row.acesso_todas_filiais ?? false,
  };
}

async function assertBranchBelongsToCompany(branchId, companyId) {
  const { data: branch, error } = await supabase
    .from("filiais")
    .select("id_filial")
    .eq("id_filial", branchId)
    .eq("id_empresa", companyId)
    .single();

  if (error || !branch) {
    throw new Error("Filial inválida para esta empresa.");
  }
}

async function assertProfileBelongsToCompany(profileId, companyId) {
  const { data: profile, error } = await supabase
    .from("perfis")
    .select("id_perfil")
    .eq("id_perfil", profileId)
    .eq("id_empresa", companyId)
    .single();

  if (error || !profile) {
    throw new Error("Perfil inválido para esta empresa.");
  }
}

const listUsers = async (companyId) => {
  const { data: users, error } = await supabase
    .from("usuarios")
    .select("*, perfis(nome_perfil), filiais(nome_filial)")
    .eq("id_empresa", companyId)
    .order("criado_em", { ascending: false });

  if (error) {
    throw new Error(`Erro ao listar usuários do banco: ${error.message}`);
  }

  return users.map(mapUser);
};

const createUser = async ({
  companyId,
  name,
  email,
  password,
  branchId,
  profileId,
  permissions,
  allBranchesAccess,
}) => {
  if (!validateEmail(email)) {
    throw new Error("Informe um e-mail válido.");
  }

  if (!validateStrongPassword(password)) {
    throw new Error(
      "A senha deve ter no mínimo 6 caracteres, incluindo letra, número e caractere especial.",
    );
  }

  await assertBranchBelongsToCompany(branchId, companyId);
  await assertProfileBelongsToCompany(profileId, companyId);

  const { data: existingUser } = await supabase
    .from("usuarios")
    .select("id_usuario")
    .eq("email_usuario", email)
    .maybeSingle();

  if (existingUser) {
    throw new Error("Já existe um usuário cadastrado com este e-mail.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { data: user, error } = await supabase
    .from("usuarios")
    .insert({
      id_empresa: companyId,
      id_filial: branchId,
      id_perfil: profileId,
      nome_usuario: name,
      email_usuario: email,
      senha_usuario: hashedPassword,
      status_usuario: true,
      primeiro_acesso_usuario: true,
      // Permissão é copiada do perfil escolhido no momento da criação
      // (o frontend já manda o valor pré-preenchido, possivelmente
      // ajustado pela pessoa antes de enviar) — daqui em diante, é
      // independente do perfil.
      permissoes_usuario: permissions ?? {},
      acesso_todas_filiais: Boolean(allBranchesAccess),
    })
    .select("*, perfis(nome_perfil), filiais(nome_filial)")
    .single();

  if (error || !user) {
    throw new Error(`Erro ao cadastrar usuário no banco de dados: ${error?.message}`);
  }

  return mapUser(user);
};

const updateUser = async (
  userId,
  companyId,
  { name, email, branchId, profileId, status, permissions, allBranchesAccess },
) => {
  if (branchId) await assertBranchBelongsToCompany(branchId, companyId);
  if (profileId) await assertProfileBelongsToCompany(profileId, companyId);

  const updatePayload = { atualizado_em: new Date().toISOString() };

  if (typeof name === "string") updatePayload.nome_usuario = name;
  if (typeof email === "string") {
    if (!validateEmail(email)) {
      throw new Error("Informe um e-mail válido.");
    }
    updatePayload.email_usuario = email;
  }
  if (branchId) updatePayload.id_filial = branchId;
  if (profileId) updatePayload.id_perfil = profileId;
  if (typeof status === "string") {
    updatePayload.status_usuario = status === "Ativo";
  }
  if (permissions) updatePayload.permissoes_usuario = permissions;
  if (typeof allBranchesAccess === "boolean") {
    updatePayload.acesso_todas_filiais = allBranchesAccess;
  }

  const { data: user, error } = await supabase
    .from("usuarios")
    .update(updatePayload)
    .eq("id_usuario", userId)
    .eq("id_empresa", companyId)
    .select("*, perfis(nome_perfil), filiais(nome_filial)")
    .single();

  if (error || !user) {
    throw new Error(`Erro ao atualizar o usuário no banco: ${error?.message}`);
  }

  return mapUser(user);
};

module.exports = {
  listUsers,
  createUser,
  updateUser,
};