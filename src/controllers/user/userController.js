const userService = require("../../services/user/userService");
const auditService = require("../../services/audit/auditService");
const { assertBranchAllowed } = require("../../utils/branchScope");

const createNewUser = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId, id_filial: actorBranchId } = req.user;
  const { name, email, password, branchId, profileId, permissions, allBranchesAccess } = req.body;

  if (!name || !email || !password || !branchId || !profileId) {
    return res
      .status(400)
      .json({ message: "Preencha todos os campos obrigatórios." });
  }

  try {
    assertBranchAllowed(req.user, branchId);
  } catch (err) {
    return res.status(403).json({ message: err.message });
  }

  try {
    const user = await userService.createUser({
      companyId,
      name,
      email,
      password,
      branchId,
      profileId,
      permissions,
      allBranchesAccess,
    });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: branchId || actorBranchId,
      action: "Cadastrou/Importou",
      description: `Cadastrou o usuário ${name}`,
    });

    return res.status(201).json({ message: "Usuário cadastrado com sucesso!", ...user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const getCompanyUsers = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const users = await userService.listUsers(companyId);
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const editCompanyUser = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId, id_filial: actorBranchId } = req.user;
  const { id: userId } = req.params;
  const { name, email, branchId, profileId, status, permissions, allBranchesAccess } = req.body;

  if (branchId) {
    try {
      assertBranchAllowed(req.user, branchId);
    } catch (err) {
      return res.status(403).json({ message: err.message });
    }
  }

  try {
    const user = await userService.updateUser(userId, companyId, {
      name,
      email,
      branchId,
      profileId,
      status,
      permissions,
      allBranchesAccess,
    });

    let action = "Editou";
    if (status === "Ativo") action = "Ativou";
    if (status === "Inativo") action = "Inativou";

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: branchId || actorBranchId,
      action,
      description: `${action} o usuário ${user.name}`,
    });

    return res.json({ message: "Usuário atualizado com sucesso!", ...user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = {
  createNewUser,
  getCompanyUsers,
  editCompanyUser,
};
