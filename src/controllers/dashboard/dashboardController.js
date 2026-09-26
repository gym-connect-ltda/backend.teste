const dashboardService = require("../../services/dashboard/dashboardService");

const getDashboard = async (req, res) => {
  const { id_empresa: companyId } = req.user;
  const { branchId } = req.query;

  try {
    const metrics = await dashboardService.getDashboardMetrics(
      companyId,
      branchId || null,
      req.user,
    );
    return res.json(metrics);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getDelinquencyHistory = async (req, res) => {
  const { id_empresa: companyId } = req.user;

  try {
    const history = await dashboardService.getDelinquencyHistory(companyId, req.user);
    return res.json(history);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { getDashboard, getDelinquencyHistory };
