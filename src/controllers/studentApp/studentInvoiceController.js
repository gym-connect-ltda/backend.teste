const studentInvoiceService = require("../../services/studentApp/studentInvoiceService");

const listInvoices = async (req, res) => {
  try {
    const invoices = await studentInvoiceService.listInvoices(
      req.student.id_aluno_app,
    );
    return res.status(200).json(invoices);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { listInvoices };
