const { runClearanceScan } = require("../lib/clearance/scanner");

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || "";
    const querySecret = req.query?.secret;
    if (auth !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
  }

  try {
    const sendAlerts = req.query?.alerts !== "false";
    const zip = req.query?.zip || process.env.DEALS_ZIP || "25309";
    const minDiscount = Number(req.query?.minDiscount || 50);
    const result = await runClearanceScan({ sendAlerts, zip, minDiscount });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
