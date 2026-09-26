const companyService = require("../../services/company/companyService");
const { getClientIp } = require("../../utils/getClientIp");

const createAccount = async (req, res) => {
  const clientIp = getClientIp(req);

  const {
    companyName,
    companyCnpj,
    saasPlan,
    paymentCycle,
    paymentStatus,
    userName,
    userEmail,
    userPassword,
  } = req.body;

  if (
    !companyName ||
    !companyCnpj ||
    !saasPlan ||
    !userName ||
    !userEmail ||
    !userPassword
  ) {
    return res
      .status(400)
      .json({ message: "Todos os campos obrigatórios devem ser preenchidos." });
  }

  try {
    const result = await companyService.registerSelfService({
      companyName,
      companyCnpj,
      saasPlan,
      paymentCycle,
      paymentStatus,
      userName,
      userEmail,
      userPassword,
      termsVersion: "1.0",
      clientIp,
    });

    return res.status(201).json({
      message: "Conta do SaaS configurada com sucesso!",
      ...result,
    });
  } catch (err) {
    const status = err.message.includes("já está cadastrado") ? 400 : 500;
    return res.status(status).json({ message: err.message });
  }
};

module.exports = {
  createAccount,
};
