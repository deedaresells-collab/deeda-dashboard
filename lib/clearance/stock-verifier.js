/**
 * Stock verification — mirrors HC /api/v1/{retailer}/stock?zip=&sku=
 * Confirms in-store inventory before marking a deal verified.
 */

const { HOME_DEPOT_WV, LOWES_WV } = require("./wv-stores");
const { graphqlRequest, warmSession } = require("./homedepot-scraper");

function storesForZip(zip) {
  const hd = HOME_DEPOT_WV.filter((s) => s.zip === zip);
  const lowes = LOWES_WV.filter((s) => s.zip === zip);
  if (hd.length || lowes.length) return { hd, lowes };
  return { hd: HOME_DEPOT_WV, lowes: LOWES_WV };
}

async function verifyHomeDepotStock(zip, sku, storeId) {
  const store = HOME_DEPOT_WV.find((s) => s.storeId === storeId) || HOME_DEPOT_WV.find((s) => s.zip === zip);
  if (!store) return { verified: false, stockQty: null };

  try {
    const cookie = process.env.HD_SESSION_COOKIE || (await warmSession());
    const data = await graphqlRequest(
      {
        operationName: "productClientOnlyProduct",
        variables: { itemId: sku, storeId: store.storeId, isBrandPricingPolicyCompliant: true },
        query: `query productClientOnlyProduct($itemId: String!, $storeId: String, $isBrandPricingPolicyCompliant: Boolean) {
          product(itemId: $itemId) {
            pricing(storeId: $storeId) { value original }
            fulfillment(storeId: $storeId) {
              fulfillmentOptions { services { locations { inventory { quantity isInStock } } } }
            }
          }
        }`
      },
      cookie
    );
    const p = data?.product;
    let stockQty = null;
    for (const opt of p?.fulfillment?.fulfillmentOptions || []) {
      for (const svc of opt.services || []) {
        for (const loc of svc.locations || []) {
          if (loc?.inventory?.quantity != null) stockQty = Number(loc.inventory.quantity);
          else if (loc?.inventory?.isInStock) stockQty = 1;
        }
      }
    }
    const price = p?.pricing?.value != null ? Number(p.pricing.value) : null;
    return { verified: stockQty != null && stockQty > 0, stockQty, price, storeId: store.storeId };
  } catch {
    return { verified: null, stockQty: null };
  }
}

async function verifyLowesStock(zip, sku, storeId) {
  const store = LOWES_WV.find((s) => s.storeId === storeId) || LOWES_WV.find((s) => s.zip === zip);
  if (!store) return { verified: false, stockQty: null };

  try {
    const url = `https://www.lowes.com/pd/-/${sku}`;
    const res = await fetch(url, {
      headers: {
        Cookie: `sn=${store.storeId}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    if (!res.ok) return { verified: null, stockQty: null };
    const html = await res.text();
    const stockMatch = html.match(/"inventoryQuantity"\s*:\s*(\d+)/) || html.match(/"storeInventoryQuantity"\s*:\s*(\d+)/);
    const priceMatch = html.match(/"sellingPrice"\s*:\s*([\d.]+)/);
    const stockQty = stockMatch ? Number(stockMatch[1]) : null;
    const price = priceMatch ? Number(priceMatch[1]) : null;
    return {
      verified: stockQty != null && stockQty > 0,
      stockQty,
      price,
      storeId: store.storeId
    };
  } catch {
    return { verified: null, stockQty: null };
  }
}

async function verifyStock({ retailer, zip, sku, storeId }) {
  if (retailer === "homedepot") return verifyHomeDepotStock(zip, sku, storeId);
  if (retailer === "lowes") return verifyLowesStock(zip, sku, storeId);
  return { verified: null, stockQty: null };
}

module.exports = {
  storesForZip,
  verifyHomeDepotStock,
  verifyLowesStock,
  verifyStock
};
