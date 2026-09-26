const pricingService = require("../../services/pricing/pricingService");
const auditService = require("../../services/audit/auditService");

const getCompanyPricing = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const pricing = await pricingService.listPricing(companyId);
    return res.json(pricing);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createNewPricing = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId, id_filial: actorBranchId } = req.user;
  const { cycle, value } = req.body;

  if (!cycle || typeof value !== "number") {
    return res.status(400).json({ message: "Informe o ciclo e o valor." });
  }

  try {
    const pricing = await pricingService.createPricing({ companyId, cycle, value });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: actorBranchId,
      action: "Cadastrou/Importou",
      description: `Cadastrou a precificação do ciclo ${cycle}`,
    });

    return res.status(201).json({ message: "Precificação cadastrada com sucesso!", ...pricing });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const editCompanyPricing = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId, id_filial: actorBranchId } = req.user;
  const { id: pricingId } = req.params;
  const { cycle, value } = req.body;

  try {
    const pricing = await pricingService.updatePricing(pricingId, companyId, { cycle, value });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: actorBranchId,
      action: "Editou",
      description: `Editou a precificação do ciclo ${pricing.cycle}`,
    });

    return res.json({ message: "Precificação atualizada com sucesso!", ...pricing });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const deleteCompanyPricing = async (req, res) => {
  const { id_empresa: companyId, id_usuario: actorId, id_filial: actorBranchId } = req.user;
  const { id: pricingId } = req.params;

  try {
    await pricingService.deletePricing(pricingId, companyId);

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId: actorBranchId,
      action: "Removeu",
      description: `Removeu uma precificação (id ${pricingId})`,
    });

    return res.json({ message: "Precificação removida com sucesso!" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = {
  getCompanyPricing,
  createNewPricing,
  editCompanyPricing,
  deleteCompanyPricing,
};
