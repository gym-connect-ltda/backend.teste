const historyService = require("../../services/audit/historyService");

const getCompanyHistory = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const history = await historyService.listHistory(companyId, req.user);
    return res.json(history);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { getCompanyHistory };
