const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { Router } = require("express");
const dashboardController = require("../controllers/dashboard/dashboardController");
const authMiddleware = require("../middlewares/auth/authMiddleware");

const router = Router();

router.use(authMiddleware);
router.use(subscriptionGuard);

router.get("/", dashboardController.getDashboard);
router.get("/delinquency", dashboardController.getDelinquencyHistory);

module.exports = router;
