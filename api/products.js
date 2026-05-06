const { parseArrayBody, supabaseRequest } = require("./_supabase");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const rows = await supabaseRequest("dashboard_products?select=payload&order=position.asc");
      const products = Array.isArray(rows) ? rows.map((row) => row.payload).filter(Boolean) : [];
      res.status(200).json(products);
      return;
    }

    if (req.method === "POST") {
      const products = parseArrayBody(req);

      await supabaseRequest("dashboard_products?id=not.is.null", {
        method: "DELETE"
      });

      if (products.length) {
        const rows = products.map((payload, index) => ({
          position: index,
          payload
        }));
        await supabaseRequest("dashboard_products", {
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
