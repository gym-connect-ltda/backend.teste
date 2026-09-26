const subscriptionGuard = require("../middlewares/subscription/subscriptionGuard");
const { Router } = require("express");
const userController = require("../controllers/user/userController");
const authMiddleware = require("../middlewares/auth/authMiddleware");
const { requirePermission } = require("../middlewares/auth/requirePermission");

const router = Router();

router.use(authMiddleware);
router.use(subscriptionGuard);
router.use(requirePermission(["configuracoes", "usuarios"]));

router.post("/", userController.createNewUser);
router.get("/", userController.getCompanyUsers);
router.put("/:id", userController.editCompanyUser);

module.exports = router;
