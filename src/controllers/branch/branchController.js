const branchService = require("../../services/branch/branchService");
const billingService = require("../../services/billing/billingService");
const auditService = require("../../services/audit/auditService");
const { assertBranchAllowed } = require("../../utils/branchScope");

const createNewBranch = async (req, res) => {
  const {
    id_empresa: companyId,
    id_usuario: actorId,
    id_filial: actorBranchId,
  } = req.user; // Captura do Token JWT logado

  const {
    branchName,
    branchCnpj,
    branchPhone,
    zipCode,
    street,
    number,
    neighborhood,
    city,
    state,
    confirmUpgrade, // true quando o frontend já mostrou o alerta e o usuário confirmou
  } = req.body;

  // Validação de campos obrigatórios no servidor
  if (
    !branchName ||
    !branchCnpj ||
    !branchPhone ||
    !zipCode ||
    !street ||
    !number ||
    !neighborhood ||
    !city ||
    !state
  ) {
    return res
      .status(400)
      .json({ message: "Preencha todos os campos obrigatórios." });
  }

  try {
    // Checa se essa nova filial estoura o limite do plano atual ANTES de
    // criar qualquer coisa.
    const limitCheck = await billingService.checkBranchLimit(companyId);

    if (!limitCheck.withinLimit) {
      if (!confirmUpgrade) {
        // Não cria a filial ainda — devolve os dados pro frontend montar o
        // alerta de confirmação ("upgrade automático, cobrado na próxima
        // fatura, se der ok ele cria").
        return res.status(409).json({
          code: "BRANCH_LIMIT_REACHED",
          message: `Limite de ${limitCheck.currentPlan.limite_academias} academias do plano ${limitCheck.currentPlan.nome} atingido. Confirme o upgrade para continuar.`,
          currentPlan: limitCheck.currentPlan,
          suggestedPlan: limitCheck.suggestedPlan,
          newValue: limitCheck.newValue,
        });
      }

      // Usuário já confirmou: aplica o upgrade (efetivo já no limite,
      // cobrança do novo valor só na próxima fatura) antes de criar a filial.
      await billingService.scheduleUpgrade(
        companyId,
        limitCheck.suggestedPlan.id_plano,
      );

      auditService.logAction({
        companyId,
        userId: actorId,
        branchId: actorBranchId,
        action: "Alterou plano",
        description: `Upgrade automático para ${limitCheck.suggestedPlan.nome} ao ultrapassar limite de academias.`,
      });
    }

    const branch = await branchService.createBranch({
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
    });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: branch.id_filial || actorBranchId,
      action: "Cadastrou/Importou",
      description: `Cadastrou a filial ${branchName}`,
    });

    return res.status(201).json({
      message: "Filial cadastrada com sucesso!",
      branch,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getCompanyBranches = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const branches = await branchService.listBranches(companyId, req.user);
    return res.json(branches);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const editCompanyBranch = async (req, res) => {
  const {
    id_empresa: companyId,
    id_usuario: actorId,
    id_filial: actorBranchId,
  } = req.user;
  const { id: branchId } = req.params;

  const {
    branchName,
    branchCnpj,
    branchPhone,
    zipCode,
    street,
    number,
    neighborhood,
    city,
    state,
  } = req.body;

  if (!branchName || !branchCnpj || !branchPhone) {
    return res
      .status(400)
      .json({ message: "Os campos de identificação são obrigatórios." });
  }

  try {
    assertBranchAllowed(req.user, branchId);
  } catch (err) {
    return res.status(403).json({ message: err.message });
  }

  try {
    const branch = await branchService.updateBranch(branchId, companyId, {
      branchName,
      branchCnpj,
      branchPhone,
      zipCode,
      street,
      number,
      neighborhood,
      city,
      state,
    });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: branchId || actorBranchId,
      action: "Editou",
      description: `Editou a filial ${branchName}`,
    });

    return res.json({ message: "Filial atualizada com sucesso!", branch });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const uploadBranchImage = async (req, res) => {
  const { id: branchId } = req.params;
  const { kind } = req.params; // "banner" | "perfil"
  const {
    id_empresa: companyId,
    id_usuario: actorId,
    id_filial: actorBranchId,
  } = req.user;

  try {
    assertBranchAllowed(req.user, branchId);
  } catch (err) {
    return res.status(403).json({ message: err.message });
  }

  try {
    const imageUrl = await branchService.uploadBranchImage(
      branchId,
      req.file,
      kind,
    );

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: branchId || actorBranchId,
      action: "Atualizou imagem da filial",
      description: `Enviou nova imagem (${kind}) para a filial.`,
    });

    return res
      .status(200)
      .json({ message: "Imagem atualizada com sucesso!", imageUrl });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = {
  createNewBranch,
  getCompanyBranches,
  editCompanyBranch,
  uploadBranchImage,
};
