const authService = require("../../services/auth/authService");
const auditService = require("../../services/audit/auditService");
const { getClientIp } = require("../../utils/getClientIp");

const login = async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ message: "Preencha todos os campos." });
  }

  try {
    const data = await authService.login(email, senha);

    auditService.logAction({
      companyId: data.user.id_empresa,
      userId: data.user.id_usuario,
      branchId: data.user.id_filial,
      action: "Login",
      description: `${data.user.nome_usuario} fez login no sistema`,
    });

    return res.json(data);
  } catch (err) {
    const status =
      err.message.includes("Credenciais") || err.message.includes("inativo")
        ? 401
        : 500;
    return res.status(status).json({ message: err.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const { id_usuario } = req.user;
    const profile = await authService.getProfile(id_usuario);
    return res.json(profile);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const { id_usuario, id_empresa, id_filial, nome_usuario } = req.user;

  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ message: "Preencha todos os campos de senha." });
  }

  try {
    await authService.changePassword(id_usuario, currentPassword, newPassword);

    auditService.logAction({
      companyId: id_empresa,
      userId: id_usuario,
      branchId: id_filial,
      action: "Editou",
      description: `${nome_usuario ?? "Usuário"} alterou a própria senha`,
    });

    return res.json({ message: "Senha alterada com sucesso!" });
  } catch (err) {
    const status = err.message.includes("incorreta")
      ? 401
      : err.message.includes("mínimo")
        ? 400
        : 500;
    return res.status(status).json({ message: err.message });
  }
};

const uploadAvatar = async (req, res) => {
  const { id_usuario, id_empresa, id_filial, nome_usuario } = req.user;

  try {
    const avatarUrl = await authService.uploadAvatar(id_usuario, req.file);

    auditService.logAction({
      companyId: id_empresa,
      userId: id_usuario,
      branchId: id_filial,
      action: "Editou",
      description: `${nome_usuario ?? "Usuário"} atualizou a foto de perfil`,
    });

    return res.json({
      message: "Foto de perfil atualizada com sucesso!",
      avatar_url: avatarUrl,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const acceptTerms = async (req, res) => {
  try {
    const { id_usuario } = req.user;
    const { versao_termos } = req.body;
    const ip = getClientIp(req);

    const result = await authService.acceptTerms(id_usuario, versao_termos, ip);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  login,
  getProfile,
  changePassword,
  acceptTerms,
  uploadAvatar,
};
