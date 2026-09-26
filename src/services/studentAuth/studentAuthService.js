const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const supabase = require("../../config/db");
const {
  validateStrongPassword,
  validateEmail,
} = require("../../utils/validators");
const { sendPasswordResetEmail } = require("../email/resendClient");

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

/**
 * Validação simples de CPF (dígitos verificadores). O projeto ainda não
 * tinha um validador de CPF no backend (só CNPJ, no frontend).
 */
function isValidCpf(cpf) {
  const digits = (cpf || "").replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  const calcCheckDigit = (base) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += parseInt(base[i], 10) * (base.length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const d1 = calcCheckDigit(digits.slice(0, 9));
  const d2 = calcCheckDigit(digits.slice(0, 10));
  return d1 === parseInt(digits[9], 10) && d2 === parseInt(digits[10], 10);
}

function signToken(account) {
  const payload = {
    id_aluno_app: account.id_aluno_app,
    nome: account.nome,
    email: account.email,
    cpf: account.cpf,
  };
  return jwt.sign(payload, process.env.JWT_STUDENT_SECRET, {
    expiresIn: "30d",
  });
}

// ---------------------------------------------------------------------------
// Cadastro / Login
// ---------------------------------------------------------------------------

const register = async ({ nome, cpf, email, password }) => {
  if (!nome || !cpf || !email || !password) {
    throw new Error("Preencha nome, CPF, e-mail e senha.");
  }
  if (!validateEmail(email)) {
    throw new Error("E-mail inválido.");
  }
  if (!isValidCpf(cpf)) {
    throw new Error("CPF inválido.");
  }
  if (!validateStrongPassword(password)) {
    throw new Error(
      "A senha deve ter no mínimo 6 caracteres, incluindo letra, número e caractere especial.",
    );
  }

  const cleanCpf = cpf.replace(/\D/g, "");

  const { data: existing } = await supabase
    .from("alunos_app")
    .select("id_aluno_app")
    .or(`email.eq.${email},cpf.eq.${cleanCpf}`)
    .maybeSingle();

  if (existing) {
    throw new Error("Já existe uma conta com este e-mail ou CPF.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { data: account, error } = await supabase
    .from("alunos_app")
    .insert({
      nome,
      cpf: cleanCpf,
      email,
      senha_aluno: hashedPassword,
    })
    .select("id_aluno_app, nome, email, cpf")
    .single();

  if (error) {
    throw new Error(`Erro ao criar conta: ${error.message}`);
  }

  const token = signToken(account);
  return { token, account };
};

const login = async (email, password) => {
  const { data: account, error } = await supabase
    .from("alunos_app")
    .select("id_aluno_app, nome, email, cpf, senha_aluno, foto_url, telefone")
    .eq("email", email)
    .single();

  if (error || !account) {
    throw new Error("Credenciais inválidas.");
  }

  const isValid = await bcrypt.compare(password, account.senha_aluno);
  if (!isValid) {
    throw new Error("Credenciais inválidas.");
  }

  const token = signToken(account);
  const safeAccount = { ...account };
  delete safeAccount.senha_aluno;

  return { token, account: safeAccount };
};

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

const getProfile = async (accountId) => {
  const { data, error } = await supabase
    .from("alunos_app")
    .select("id_aluno_app, nome, email, cpf, telefone, foto_url, criado_em")
    .eq("id_aluno_app", accountId)
    .single();

  if (error || !data) {
    throw new Error("Conta não encontrada.");
  }
  return data;
};

const updateProfile = async (accountId, { nome, telefone, email }) => {
  const updates = { atualizado_em: new Date().toISOString() };
  if (nome) updates.nome = nome;
  if (telefone) updates.telefone = telefone;

  if (email) {
    if (!validateEmail(email)) {
      throw new Error("E-mail inválido.");
    }
    const { data: existing } = await supabase
      .from("alunos_app")
      .select("id_aluno_app")
      .eq("email", email)
      .neq("id_aluno_app", accountId)
      .maybeSingle();

    if (existing) {
      throw new Error("Este e-mail já está em uso por outra conta.");
    }
    updates.email = email;
  }

  const { data, error } = await supabase
    .from("alunos_app")
    .update(updates)
    .eq("id_aluno_app", accountId)
    .select("id_aluno_app, nome, email, cpf, telefone, foto_url")
    .single();

  if (error) {
    throw new Error(`Erro ao atualizar perfil: ${error.message}`);
  }
  return data;
};

const changePassword = async (accountId, currentPassword, newPassword) => {
  if (!validateStrongPassword(newPassword)) {
    throw new Error(
      "A senha deve ter no mínimo 6 caracteres, incluindo letra, número e caractere especial.",
    );
  }

  const { data: account, error } = await supabase
    .from("alunos_app")
    .select("senha_aluno")
    .eq("id_aluno_app", accountId)
    .single();

  if (error || !account) throw new Error("Conta não encontrada.");

  const isCorrect = await bcrypt.compare(currentPassword, account.senha_aluno);
  if (!isCorrect) throw new Error("Senha atual incorreta.");

  const hashed = await bcrypt.hash(newPassword, 10);

  const { error: updateError } = await supabase
    .from("alunos_app")
    .update({ senha_aluno: hashed, atualizado_em: new Date().toISOString() })
    .eq("id_aluno_app", accountId);

  if (updateError) throw new Error("Erro ao atualizar senha.");
  return true;
};

// ---------------------------------------------------------------------------
// Esqueci minha senha
// ---------------------------------------------------------------------------

const requestPasswordReset = async (email) => {
  const { data: account } = await supabase
    .from("alunos_app")
    .select("id_aluno_app, nome, email")
    .eq("email", email)
    .maybeSingle();

  // Não revela se o e-mail existe ou não (evita enumeração de contas) —
  // sempre retorna sucesso pro chamador, só envia e-mail se achar de fato.
  if (!account) return true;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiraEm = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  const { error } = await supabase.from("alunos_app_reset_senha").insert({
    id_aluno_app: account.id_aluno_app,
    token_hash: tokenHash,
    expira_em: expiraEm,
  });

  if (error) {
    throw new Error(`Erro ao gerar token de redefinição: ${error.message}`);
  }

  const resetLink = `${process.env.STUDENT_PASSWORD_RESET_URL}?token=${rawToken}`;

  await sendPasswordResetEmail({
    to: account.email,
    name: account.nome,
    resetLink,
  });

  return true;
};

const resetPassword = async (rawToken, newPassword) => {
  if (!validateStrongPassword(newPassword)) {
    throw new Error(
      "A senha deve ter no mínimo 6 caracteres, incluindo letra, número e caractere especial.",
    );
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const { data: resetRow, error } = await supabase
    .from("alunos_app_reset_senha")
    .select("id, id_aluno_app, expira_em, usado")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !resetRow) {
    throw new Error("Link de redefinição inválido.");
  }
  if (resetRow.usado) {
    throw new Error("Este link já foi utilizado.");
  }
  if (new Date(resetRow.expira_em).getTime() < Date.now()) {
    throw new Error("Este link expirou. Solicite a redefinição novamente.");
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  const { error: updateError } = await supabase
    .from("alunos_app")
    .update({ senha_aluno: hashed, atualizado_em: new Date().toISOString() })
    .eq("id_aluno_app", resetRow.id_aluno_app);

  if (updateError) throw new Error("Erro ao redefinir senha.");

  await supabase
    .from("alunos_app_reset_senha")
    .update({ usado: true })
    .eq("id", resetRow.id);

  return true;
};

// ---------------------------------------------------------------------------
// Foto de perfil (Supabase Storage — mesmo padrão do authService de usuários)
// ---------------------------------------------------------------------------

const PHOTO_BUCKET = "aluno-fotos"; // criar como bucket PÚBLICO no Supabase Storage
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

const uploadPhoto = async (accountId, file) => {
  if (!file) throw new Error("Nenhum arquivo de imagem foi enviado.");
  if (!ALLOWED_PHOTO_TYPES.includes(file.mimetype)) {
    throw new Error("Formato inválido. Envie uma imagem JPG, PNG ou WEBP.");
  }
  if (file.size > MAX_PHOTO_SIZE_BYTES) {
    throw new Error("A imagem deve ter no máximo 5MB.");
  }

  const extension =
    file.mimetype === "image/png"
      ? "png"
      : file.mimetype === "image/webp"
        ? "webp"
        : "jpg";
  const filePath = `${accountId}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Erro ao enviar imagem: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(filePath);
  const photoUrl = publicUrlData?.publicUrl;
  if (!photoUrl)
    throw new Error("Não foi possível gerar a URL pública da imagem.");

  const { error: updateError } = await supabase
    .from("alunos_app")
    .update({ foto_url: photoUrl, atualizado_em: new Date().toISOString() })
    .eq("id_aluno_app", accountId);

  if (updateError)
    throw new Error(`Erro ao salvar foto no perfil: ${updateError.message}`);

  return photoUrl;
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
  uploadPhoto,
  isValidCpf,
};
