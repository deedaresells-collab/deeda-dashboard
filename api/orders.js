const { parseArrayBody, supabaseRequest } = require("./_supabase");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const rows = await supabaseRequest("dashboard_orders?select=payload&order=position.asc");
      const orders = Array.isArray(rows) ? rows.map((row) => row.payload).filter(Boolean) : [];
      res.status(200).json(orders);
      return;
    }

    if (req.method === "POST") {
      const orders = parseArrayBody(req);

      await supabaseRequest("dashboard_orders?id=not.is.null", {
        method: "DELETE"
      });

      if (orders.length) {
        const rows = orders.map((payload, index) => ({
          position: index,
          payload
        }));
        await supabaseRequest("dashboard_orders", {
          method: "POST",
          body: rows,
          prefer: "return=minimal"
        });
      }

      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
