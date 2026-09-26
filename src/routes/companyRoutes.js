const { Router } = require("express");
const companyController = require("../controllers/company/companyController");

const router = Router();

router.post("/register", companyController.createAccount);

module.exports = router;
