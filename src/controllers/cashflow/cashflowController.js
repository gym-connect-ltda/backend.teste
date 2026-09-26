const categoryService = require("../../services/cashflow/categoryService");
const transactionService = require("../../services/cashflow/transactionService");
const studentPaymentsService = require("../../services/cashflow/studentPaymentsService");
const auditService = require("../../services/audit/auditService");

// --- Categorias ---------------------------------------------------------

const getCategories = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const categories = await categoryService.listCategories(companyId, req.user);
    return res.json(categories);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createCategory = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { name, branchId } = req.body;

  // Usuário restrito só pode criar categoria da própria filial — nunca
  // geral (afetaria outras filiais) nem de uma filial que não é a dele.
  if (!req.user.allBranchesAccess && (!branchId || Number(branchId) !== Number(userBranchId))) {
    return res.status(403).json({
      message: "Você só pode criar categorias para a sua própria filial.",
    });
  }

  try {
    const category = await categoryService.createCategory(companyId, name, branchId);

    auditService.logAction({
      companyId,
      userId,
      branchId: branchId || userBranchId,
      action: "Cadastrou/Importou",
      description: `Cadastrou a categoria financeira "${category.name}"${category.branch ? ` (filial: ${category.branch})` : " (geral)"}`,
    });

    return res.status(201).json({ message: "Categoria cadastrada com sucesso!", ...category });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const updateCategory = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { id } = req.params;
  const { name, branchId } = req.body;

  if (!req.user.allBranchesAccess && (!branchId || Number(branchId) !== Number(userBranchId))) {
    return res.status(403).json({
      message: "Você só pode editar categorias para a sua própria filial.",
    });
  }

  try {
    const category = await categoryService.updateCategory(id, companyId, name, branchId);

    auditService.logAction({
      companyId,
      userId,
      branchId: branchId || userBranchId,
      action: "Editou",
      description: `Editou a categoria financeira "${category.name}"${category.branch ? ` (filial: ${category.branch})` : " (geral)"}`,
    });

    return res.json({ message: "Categoria atualizada com sucesso!", ...category });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const deleteCategory = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { id } = req.params;

  try {
    await categoryService.deleteCategory(id, companyId, req.user);

    auditService.logAction({
      companyId,
      userId,
      branchId: userBranchId,
      action: "Removeu",
      description: `Removeu uma categoria financeira (id ${id})`,
    });

    return res.json({ message: "Categoria excluída com sucesso!" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// --- Transações ----------------------------------------------------------

const getTransactions = async (req, res) => {
  const { id_empresa: companyId } = req.user;
  const { branchId, month, year } = req.query;

  try {
    const transactions = await transactionService.listTransactions(companyId, {
      branchId,
      month,
      year,
    }, req.user);
    return res.json(transactions);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const createTransaction = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const {
    value,
    date,
    categoryId,
    branchId,
    allBranches,
    paymentMethod,
    type,
    description,
    recurring,
    startDate,
    endDate,
  } = req.body;

  if (!req.user.allBranchesAccess) {
    if (allBranches) {
      return res.status(403).json({
        message: "Você não tem permissão para lançar em todas as filiais.",
      });
    }
    if (branchId) {
      try {
        assertBranchAllowed(req.user, branchId);
      } catch (err) {
        return res.status(403).json({ message: err.message });
      }
    }
  }

  try {
    const result = await transactionService.createTransaction({
      companyId,
      userId,
      value,
      date,
      categoryId,
      branchId,
      allBranches,
      paymentMethod,
      type,
      description,
      recurring,
      startDate,
      endDate,
    });

    auditService.logAction({
      companyId,
      userId,
      branchId: branchId || userBranchId,
      action: "Cadastrou/Importou",
      description: `Cadastrou ${result.count} lançamento(s) financeiro(s) (${type})`,
    });

    return res.status(201).json({
      message:
        result.count > 1
          ? `${result.count} lançamentos cadastrados com sucesso!`
          : "Lançamento cadastrado com sucesso!",
      count: result.count,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const editTransaction = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { id } = req.params;

  try {
    const transaction = await transactionService.updateTransaction(id, companyId, req.body, req.user);

    auditService.logAction({
      companyId,
      userId,
      branchId: userBranchId,
      action: "Editou",
      description: `Editou um lançamento financeiro (id ${id})`,
    });

    return res.json({ message: "Lançamento atualizado com sucesso!", ...transaction });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

const removeTransaction = async (req, res) => {
  const { id_empresa: companyId, id_usuario: userId, id_filial: userBranchId } = req.user;
  const { id } = req.params;

  try {
    await transactionService.deleteTransaction(id, companyId, req.user);

    auditService.logAction({
      companyId,
      userId,
      branchId: userBranchId,
      action: "Removeu",
      description: `Removeu um lançamento financeiro (id ${id})`,
    });

    return res.json({ message: "Lançamento excluído com sucesso!" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// --- Mensalidades (leitura de pagamentos já existentes) -------------------

const getStudentPayments = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const grouped = await studentPaymentsService.listStudentPayments(companyId);
    return res.json(grouped);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getTransactions,
  createTransaction,
  editTransaction,
  removeTransaction,
  getStudentPayments,
};