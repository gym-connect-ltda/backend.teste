const studentPaymentService = require("../../services/studentApp/studentPaymentService");

const subscribe = async (req, res) => {
  const { branchId } = req.params;
  const { pricingId } = req.body;

  if (!pricingId) {
    return res.status(400).json({ message: "Informe o plano (pricingId)." });
  }

  try {
    const result = await studentPaymentService.subscribeToPlan({
      studentAccountId: req.student.id_aluno_app,
      branchId,
      pricingId,
    });

    if (!result.checkoutUrl) {
      return res.status(202).json({
        message:
          "Assinatura criada, mas o link de pagamento ainda não está pronto. Consulte suas faturas em instantes.",
        payment: result.payment,
      });
    }

    return res.status(201).json({
      message: "Assinatura criada! Acesse o link para concluir o pagamento.",
      checkoutUrl: result.checkoutUrl,
      payment: result.payment,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

module.exports = { subscribe };
