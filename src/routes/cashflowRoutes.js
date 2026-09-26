const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { Router } = require("express");
const cashflowController = require("../controllers/cashflow/cashflowController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

router.use(authMiddleware);
router.use(subscriptionGuard);

// Categorias — GET fica só com "fluxo_caixa" (é usado como dropdown ao
// criar um lançamento), gerenciar (criar/editar/excluir) exige a
// permissão mais específica de categorias.
router.get(
  "/categories",
  requirePermission(["fluxo_caixa"]),
  cashflowController.getCategories,
);
router.post(
  "/categories",
  requirePermission(["ajuste_fluxo_caixa", "categorias"]),
  cashflowController.createCategory,
);
router.put(
  "/categories/:id",
  requirePermission(["ajuste_fluxo_caixa", "categorias"]),
  cashflowController.updateCategory,
);
router.delete(
  "/categories/:id",
  requirePermission(["ajuste_fluxo_caixa", "categorias"]),
  cashflowController.deleteCategory,
);

// Transações
router.use(requirePermission(["fluxo_caixa"]));

router.get("/transactions", cashflowController.getTransactions);
router.post("/transactions", cashflowController.createTransaction);
router.put("/transactions/:id", cashflowController.editTransaction);
router.delete("/transactions/:id", cashflowController.removeTransaction);

// Mensalidades (leitura de pagamentos de alunos já existentes — sem Asaas)
router.get("/student-payments", cashflowController.getStudentPayments);

module.exports = router;
