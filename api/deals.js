const { listDeals } = require("../lib/clearance/deals-store");
const { filterFeed, scoreDeal } = require("../lib/clearance/verifier");
const { HOME_DEPOT_WV, LOWES_WV, WV_ZIP_CODES } = require("../lib/clearance/wv-stores");

function normalizeRetailer(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/['\s-]/g, "_");
  if (v === "home_depot" || v === "homedepot") return "homedepot";
  if (v === "lowes" || v === "lowe_s") return "lowes";
  return v;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const q = req.query || {};
    const page = Math.max(1, Number(q.page || 1));
    const limit = Math.min(Number(q.limit || 24), 100);
    const kind = q.kind || q.tab || "all";
    const retailer = normalizeRetailer(q.retailer);
    const sort = q.sort || "recommended";
    const minDiscount = Number(q.minDiscount || q.min_discount || 0);
    const search = q.search || "";
    const includeOutOfStock = q.includeOutOfStock === "true";

    const all = await listDeals({ limit: 500, verified: true });
    const filtered = filterFeed(all, { kind, retailer, minDiscount, search, includeOutOfStock });
    filtered.sort((a, b) => scoreDeal(b, sort) - scoreDeal(a, sort));

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    res.status(200).json({
      ok: true,
      data: items,
      deals: items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        exactTotal: true
      },
      filters: { kind, retailer, sort, minDiscount, search, includeOutOfStock },
      stores: {
        homeDepot: HOME_DEPOT_WV.length,
        lowes: LOWES_WV.length,
        zipCodes: WV_ZIP_CODES.length
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
