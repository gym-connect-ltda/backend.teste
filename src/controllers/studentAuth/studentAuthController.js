const studentAuthService = require("../../services/studentAuth/studentAuthService");

const register = async (req, res) => {
  const { nome, cpf, email, password } = req.body;

  try {
    const result = await studentAuthService.register({
      nome,
      cpf,
      email,
      password,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Informe e-mail e senha." });
  }

  try {
    const result = await studentAuthService.login(email, password);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(401).json({ message: err.message });
  }
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Informe o e-mail." });
  }

  try {
    await studentAuthService.requestPasswordReset(email);
    // Mensagem genérica de propósito (não revela se o e-mail existe).
    return res.status(200).json({
      message: "Se o e-mail existir, enviamos um link de redefinição.",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ message: "Informe o token e a nova senha." });
  }

  try {
    await studentAuthService.resetPassword(token, newPassword);
    return res.status(200).json({ message: "Senha redefinida com sucesso!" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const profile = await studentAuthService.getProfile(
      req.student.id_aluno_app,
    );
    return res.status(200).json(profile);
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
};

const updateProfile = async (req, res) => {
  const { nome, telefone, email } = req.body;

  try {
    const profile = await studentAuthService.updateProfile(
      req.student.id_aluno_app,
      { nome, telefone, email },
    );
    return res.status(200).json({ message: "Perfil atualizado!", profile });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res
      .status(400)
      .json({ message: "Informe a senha atual e a nova senha." });
  }

  try {
    await studentAuthService.changePassword(
      req.student.id_aluno_app,
      currentPassword,
      newPassword,
    );
    return res.status(200).json({ message: "Senha alterada com sucesso!" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const uploadPhoto = async (req, res) => {
  try {
    const photoUrl = await studentAuthService.uploadPhoto(
      req.student.id_aluno_app,
      req.file,
    );
    return res.status(200).json({ message: "Foto atualizada!", photoUrl });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  changePassword,
  uploadPhoto,
};
