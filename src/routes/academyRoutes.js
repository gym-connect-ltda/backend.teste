const { Router } = require("express");
const academyController = require("../controllers/studentApp/academyController");
const studentPaymentController = require("../controllers/studentApp/studentPaymentController");
const studentAuthMiddleware = require("../middlewares/studentAuth/studentAuthMiddleware");

const router = Router();

// Públicas de propósito — o app deixa navegar/buscar academia antes de
// pedir login (só exige conta na hora de contratar um plano).
router.get("/", academyController.listNearby);
router.get("/:branchId", academyController.getDetail);
router.get("/:branchId/plans", academyController.getPlans);

// Protegida — exige login do aluno.
router.post(
  "/:branchId/subscribe",
  studentAuthMiddleware,
  studentPaymentController.subscribe,
);

module.exports = router;
