const academyService = require("../../services/studentApp/academyService");

const listNearby = async (req, res) => {
  const { lat, lng, radiusKm, search } = req.query;

  try {
    const academies = await academyService.listNearby({
      lat: lat !== undefined ? Number(lat) : undefined,
      lng: lng !== undefined ? Number(lng) : undefined,
      radiusKm: radiusKm !== undefined ? Number(radiusKm) : undefined,
      search,
    });
    return res.status(200).json({ academies });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const getDetail = async (req, res) => {
  const { branchId } = req.params;

  try {
    const academy = await academyService.getDetail(branchId);
    return res.status(200).json({ academy });
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
};

const getPlans = async (req, res) => {
  const { branchId } = req.params;

  try {
    const plans = await academyService.getPlans(branchId);
    return res.status(200).json({ plans });
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
};

module.exports = { listNearby, getDetail, getPlans };
