/**
 * Deal verification — mirrors Hidden Clearances "verified deals" pipeline.
 * Only publishes deals that pass stock + discount + transition checks.
 */

const { classifyDeal, pctOff, parsePrice } = require("./deal-rules");
const { detectTransition, getLastSnapshot, recordSnapshot } = require("./price-history");
const { verifyStock } = require("./stock-verifier");

const MIN_DISCOUNT_DEFAULT = 50;

function dealKind(product, deal, transition) {
  if (deal.alertType === "penny" || (product.price != null && product.price <= 0.03)) return "penny";
  return "in_store";
}

function isVerified(product, { minDiscount = MIN_DISCOUNT_DEFAULT, requireStock = true, stockCheck } = {}) {
  const deal = classifyDeal(product);
  if (!deal) return { verified: false, reason: "below_threshold" };

  const off = product.pctOff ?? pctOff(product.price, product.wasPrice);
  const isPenny = deal.alertType === "penny";

  if (!isPenny && off < minDiscount) {
    return { verified: false, reason: "min_discount", off };
  }

  if (requireStock) {
    if (stockCheck?.verified === false) return { verified: false, reason: "no_stock" };
    if (product.stockQty === 0) return { verified: false, reason: "no_stock" };
  }

  return { verified: true, deal, off, isPenny };
}

async function verifyProduct(product, options = {}) {
  const zip = options.zip || product.storeZip || product.zip;
  const previous = await getLastSnapshot(product.retailer, product.storeId, product.sku);
  const transition = detectTransition(product, previous);

  await recordSnapshot(product);

  let stockCheck = null;
  if (options.verifyStock !== false && zip && product.sku) {
    stockCheck = await verifyStock({
      retailer: product.retailer,
      zip,
      sku: product.sku,
      storeId: product.storeId
    });
    if (stockCheck.stockQty != null) product.stockQty = stockCheck.stockQty;
    if (stockCheck.price != null) product.price = stockCheck.price;
  }

  const minDiscount = options.minDiscount ?? MIN_DISCOUNT_DEFAULT;
  const check = isVerified(product, { minDiscount, requireStock: options.requireStock !== false, stockCheck });
  if (!check.verified) {
    return { published: false, reason: check.reason, transition, previous };
  }

  const deal = check.deal;
  const kind = dealKind(product, deal, transition);

  return {
    published: true,
    product: {
      ...product,
      alertType: deal.alertType,
      pctOff: check.off ?? product.pctOff,
      kind,
      verified: true,
      verifiedAt: new Date().toISOString(),
      previousPrice: transition?.previousPrice ?? previous?.price ?? null,
      transitionReason: transition?.reason || "scan",
      aisle: product.aisle || null,
      bay: product.bay || null
    },
    transition,
    previous
  };
}

function scoreDeal(deal, sort = "recommended") {
  const price = parsePrice(deal.price) ?? 9999;
  const off = deal.pctOff || 0;
  const stock = Number(deal.stockQty || 0);
  const age = deal.lastSeenAt ? (Date.now() - new Date(deal.lastSeenAt).getTime()) / 3600000 : 99;

  switch (sort) {
    case "discount_percent":
      return off * 1000 - price;
    case "discount_amount":
      return (parsePrice(deal.wasPrice) || 0) - price;
    case "newest":
      return -age;
    case "stock_high":
      return stock * 100 + off;
    case "stock_low":
      return stock > 0 ? 1000 / stock + off : 0;
    case "distance":
      return -(deal.distanceMiles || 999) * 1000 + off;
    default:
      return (deal.kind === "penny" ? 50000 : 0) + off * 100 + stock * 5 - age * 2 - price;
  }
}

function filterFeed(deals, { kind, retailer, minDiscount = 0, search, includeOutOfStock = false } = {}) {
  let list = deals.filter((d) => d.status !== "expired");

  if (kind && kind !== "all") {
    if (kind === "in_store") list = list.filter((d) => d.kind === "in_store" || !d.kind);
    else if (kind === "penny") list = list.filter((d) => d.kind === "penny" || d.alertType === "penny");
    else list = list.filter((d) => d.kind === kind);
  }

  if (retailer) list = list.filter((d) => d.retailer === retailer);
  if (minDiscount > 0) list = list.filter((d) => (d.pctOff || 0) >= minDiscount || d.alertType === "penny");
  if (!includeOutOfStock) list = list.filter((d) => d.stockQty == null || d.stockQty > 0);

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(
      (d) =>
        String(d.title || "").toLowerCase().includes(q) ||
        String(d.brand || "").toLowerCase().includes(q) ||
        String(d.sku || "").includes(q) ||
        String(d.storeCity || "").toLowerCase().includes(q)
    );
  }

  return list;
}

module.exports = {
  MIN_DISCOUNT_DEFAULT,
  dealKind,
  filterFeed,
  isVerified,
  scoreDeal,
  verifyProduct
};
