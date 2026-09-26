const subaccountService = require("../../services/subaccount/subaccountService");
const asaasAccountService = require("../../services/asaas/asaasAccountService");
const auditService = require("../../services/audit/auditService");

/**
 * Status atual da subconta da filial (ou null se ainda não foi criada).
 */
const getStatus = async (req, res) => {
  const { branchId } = req.params;

  try {
    const account = await asaasAccountService.getAccountByBranch(branchId);
    return res.status(200).json({ account });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Body esperado:
 * email, mobilePhone, incomeValue, companyType (MEI|LIMITED|INDIVIDUAL|ASSOCIATION),
 * address, addressNumber, complement, province, postalCode
 */
const createSubaccount = async (req, res) => {
  const { branchId } = req.params;
  const { id_empresa: companyId, id_usuario: actorId } = req.user;

  const {
    email,
    mobilePhone,
    incomeValue,
    companyType,
    address,
    addressNumber,
    complement,
    province,
    postalCode,
  } = req.body;

  if (
    !email ||
    !incomeValue ||
    !companyType ||
    !address ||
    !addressNumber ||
    !province ||
    !postalCode
  ) {
    return res.status(400).json({
      message:
        "Preencha e-mail, faturamento estimado, tipo societário e endereço completo.",
    });
  }

  try {
    const account = await subaccountService.createBranchSubaccount({
      branchId,
      email,
      mobilePhone,
      incomeValue,
      companyType,
      address,
      addressNumber,
      complement,
      province,
      postalCode,
    });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId,
      action: "Criou subconta Asaas",
      description: `Subconta Asaas criada para a filial (id ${branchId}).`,
    });

    return res.status(201).json({
      message:
        "Subconta criada! Agora é preciso enviar os documentos pendentes para aprovação.",
      account,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const getPendingDocuments = async (req, res) => {
  const { branchId } = req.params;

  try {
    const documents = await subaccountService.listPendingDocuments(branchId);
    return res.status(200).json(documents);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

/**
 * multipart/form-data: campo "document" (arquivo, via multer) + "type" no body.
 */
const uploadDocument = async (req, res) => {
  const { branchId, documentId } = req.params;
  const { type } = req.body;
  const { id_empresa: companyId, id_usuario: actorId } = req.user;

  if (!req.file) {
    return res.status(400).json({ message: "Nenhum arquivo enviado." });
  }
  if (!type) {
    return res
      .status(400)
      .json({ message: "Informe o tipo do documento (campo type)." });
  }

  try {
    const result = await subaccountService.uploadDocument({
      branchId,
      documentId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      type,
    });

    auditService.logAction({
      companyId,
      userId: actorId,
      branchId,
      action: "Enviou documento da subconta",
      description: `Documento (${type}) enviado para análise do Asaas.`,
    });

    return res
      .status(200)
      .json({ message: "Documento enviado com sucesso!", result });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const syncStatus = async (req, res) => {
  const { branchId } = req.params;

  try {
    const status = await subaccountService.syncAccountStatus(branchId);
    return res.status(200).json({ status });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = {
  getStatus,
  createSubaccount,
  getPendingDocuments,
  uploadDocument,
  syncStatus,
};
