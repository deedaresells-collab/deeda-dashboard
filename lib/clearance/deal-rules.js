/**
 * Classify scraped products into deal types for alerts and filtering.
 */

const PENNY_MAX = 0.03;
const CLEARANCE_MIN_PCT = 50;

function parsePrice(value) {
  if (value == null || value === "") return null;
  const num = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function pctOff(current, original) {
  const cur = parsePrice(current);
  const orig = parsePrice(original);
  if (cur == null || orig == null || orig <= 0) return 0;
  return Math.round(((orig - cur) / orig) * 100);
}

function classifyDeal({ price, wasPrice, stockQty }) {
  const p = parsePrice(price);
  const was = parsePrice(wasPrice);
  const off = pctOff(p, was);
  const stock = stockQty == null ? null : Number(stockQty);

  if (p != null && p <= PENNY_MAX) {
    return { alertType: "penny", priority: 1, pctOff: off, label: p <= 0.01 ? "PENNY ITEM" : "NEAR PENNY" };
  }
  if (off >= 90) {
    return { alertType: "clearance_90", priority: 2, pctOff: off, label: `${off}% OFF` };
  }
  if (off >= 70) {
    return { alertType: "clearance_70", priority: 3, pctOff: off, label: `${off}% OFF` };
  }
  if (off >= CLEARANCE_MIN_PCT) {
    return { alertType: "clearance_50", priority: 4, pctOff: off, label: `${off}% OFF` };
  }
  if (p != null && was != null && was > p) {
    return { alertType: "markdown", priority: 5, pctOff: off, label: `${off}% OFF` };
  }
  return null;
}

function isDeal(product) {
  return classifyDeal(product) != null;
}

function dealScore(product) {
  const deal = classifyDeal(product);
  if (!deal) return 0;
  const p = parsePrice(product.price) ?? 999;
  const stock = Number(product.stockQty || 0);
  const stockBonus = stock > 0 ? 10 : 0;
  return (100 - deal.priority * 10) + deal.pctOff + stockBonus + (p <= 0.01 ? 50 : 0);
}

function normalizeProduct(raw) {
  const price = parsePrice(raw.price ?? raw.currentPrice ?? raw.pricing?.value);
  const wasPrice = parsePrice(raw.wasPrice ?? raw.originalPrice ?? raw.pricing?.original);
  const stockQty = raw.stockQty ?? raw.stock ?? raw.inventory ?? raw.storeInventory ?? null;

  return {
    retailer: raw.retailer,
    storeId: String(raw.storeId || ""),
    storeCity: raw.storeCity || "",
    sku: String(raw.sku || raw.itemId || raw.itemNumber || ""),
    title: raw.title || raw.productLabel || raw.name || "Unknown item",
    brand: raw.brand || raw.brandName || "",
    price,
    wasPrice,
    pctOff: pctOff(price, wasPrice),
    stockQty: stockQty != null ? Number(stockQty) : null,
    imageUrl: raw.imageUrl || raw.image || "",
    productUrl: raw.productUrl || raw.url || raw.canonicalUrl || "",
    category: raw.category || "",
    scannedAt: raw.scannedAt || new Date().toISOString()
  };
}

module.exports = {
  CLEARANCE_MIN_PCT,
  PENNY_MAX,
  classifyDeal,
  dealScore,
  isDeal,
  normalizeProduct,
  parsePrice,
  pctOff
};
