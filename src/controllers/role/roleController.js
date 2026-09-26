const roleService = require("../../services/role/roleService");
const auditService = require("../../services/audit/auditService");

const createNewRole = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId, id_filial: actorBranchId } = req.user;
  const { name, branchId, permissions, allBranchesAccess } = req.body;

  if (!name || !permissions) {
    return res
      .status(400)
      .json({ message: "Preencha o nome e as permissões do perfil." });
  }

  // Nota: quem já tem acesso a "Perfis" pode ligar qualquer outra
  // permissão poderosa (fluxo_caixa, usuários, etc.) sem restrição — não
  // faz sentido proteger só este campo específico, e isso travava o
  // primeiro administrador de conseguir ligar o próprio acesso.

  try {
    const role = await roleService.createRole({
      companyId,
      name,
      branchId,
      permissions,
      allBranchesAccess,
    });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: branchId || actorBranchId,
      action: "Cadastrou/Importou",
      description: `Cadastrou o perfil ${name}`,
    });

    return res.status(201).json({ message: "Perfil cadastrado com sucesso!", ...role });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const getCompanyRoles = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const roles = await roleService.listRoles(companyId);
    return res.json(roles);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const editCompanyRole = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId, id_filial: actorBranchId } = req.user;
  const { id: roleId } = req.params;
  const { name, branchId, permissions, status, allBranchesAccess } = req.body;

  try {
    const role = await roleService.updateRole(roleId, companyId, {
      name,
      branchId,
      permissions,
      status,
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
      description: `${action} o perfil ${role.name}`,
    });

    return res.json({ message: "Perfil atualizado com sucesso!", ...role });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = {
  createNewRole,
  getCompanyRoles,
  editCompanyRole,
};