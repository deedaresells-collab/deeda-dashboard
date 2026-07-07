const { listDeals } = require("../lib/clearance/deals-store");
const { HOME_DEPOT_WV, LOWES_WV, WV_ZIP_CODES } = require("../lib/clearance/wv-stores");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const limit = Math.min(Number(req.query?.limit || 200), 500);
    const alertType = req.query?.type || null;
    const retailer = req.query?.retailer || null;
    const deals = await listDeals({ limit, alertType, retailer });

    res.status(200).json({
      ok: true,
      count: deals.length,
      stores: {
        homeDepot: HOME_DEPOT_WV.length,
        lowes: LOWES_WV.length,
        zipCodes: WV_ZIP_CODES.length
      },
      deals
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
