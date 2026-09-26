const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { Router } = require("express");
const pricingController = require("../controllers/pricing/pricingController");
const authMiddleware = require("../middlewares/auth/authMiddleware");

const router = Router();

router.use(authMiddleware);
router.use(subscriptionGuard);

router.get("/", pricingController.getCompanyPricing);
router.post("/", pricingController.createNewPricing);
router.put("/:id", pricingController.editCompanyPricing);
router.delete("/:id", pricingController.deleteCompanyPricing);

module.exports = router;
