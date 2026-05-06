const { getDashboardOrders } = require("./_orders");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      res.status(200).json(await getDashboardOrders());
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
