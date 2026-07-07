/**
 * Apify integration — best reliability for bot-protected retailers.
 * Uses home-depot-clearance-scraper (per store) and dealwatch-scraper (multi-zip penny detection).
 */

const { HOME_DEPOT_WV, WV_ZIP_CODES } = require("./wv-stores");

const APIFY_BASE = "https://api.apify.com/v2";

function getToken() {
  return process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || "";
}

async function runActor(actorId, input, { timeoutSec = 300 } = {}) {
  const token = getToken();
  if (!token) return null;

  const startRes = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!startRes.ok) {
    const text = await startRes.text();
    throw new Error(`Apify start failed (${startRes.status}): ${text.slice(0, 200)}`);
  }
  const run = await startRes.json();
  const runId = run.data?.id;
  if (!runId) throw new Error("Apify run id missing");

  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`);
    const statusJson = await statusRes.json();
    const status = statusJson.data?.status;
    if (status === "SUCCEEDED") {
      const datasetId = statusJson.data?.defaultDatasetId;
      const itemsRes = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json`);
      return itemsRes.json();
    }
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${status}`);
    }
  }
  throw new Error("Apify run timed out");
}

function mapApifyHdItem(item, store) {
  const price = Number(item.price ?? item.currentPrice ?? item.clearancePrice ?? item.pricing?.value);
  const was = Number(item.originalPrice ?? item.wasPrice ?? item.pricing?.original ?? 0) || null;
  return {
    retailer: "homedepot",
    storeId: String(item.storeId || store?.storeId || ""),
    storeCity: store?.city || item.storeName || item.storeCity || "",
    sku: String(item.itemId || item.sku || item.productId || ""),
    title: item.title || item.productLabel || item.name || "Unknown",
    brand: item.brand || item.brandName || "",
    price: Number.isFinite(price) ? price : null,
    wasPrice: was,
    stockQty: item.stock ?? item.inventory ?? item.stockQuantity ?? null,
    imageUrl: item.imageUrl || item.image || item.thumbnail || "",
    productUrl: item.url || item.productUrl || item.canonicalUrl || "",
    category: item.category || "clearance"
  };
}

function mapApifyDealWatchItem(item) {
  const retailer = String(item.store || item.retailer || "").includes("lowe") ? "lowes" : "homedepot";
  const price = Number(item.price ?? item.currentPrice ?? item.clearancePrice);
  const was = Number(item.originalPrice ?? item.wasPrice ?? 0) || null;
  return {
    retailer,
    storeId: String(item.storeId || item.storeNumber || ""),
    storeCity: item.storeCity || item.city || "",
    sku: String(item.sku || item.itemId || item.itemNumber || item.productId || ""),
    title: item.title || item.productName || item.name || "Unknown",
    brand: item.brand || "",
    price: Number.isFinite(price) ? price : null,
    wasPrice: was,
    stockQty: item.stock ?? item.inventory ?? item.stockQty ?? null,
    imageUrl: item.imageUrl || item.image || "",
    productUrl: item.url || item.productUrl || "",
    category: item.category || "clearance"
  };
}

async function scanHomeDepotApify(stores = HOME_DEPOT_WV, onError) {
  if (!getToken()) return [];
  const all = [];
  for (const store of stores) {
    try {
      const items = await runActor("scrapyspider~home-depot-clearance-scraper", {
        storeId: store.storeId,
        parallelRequests: 3
      }, { timeoutSec: 180 });
      if (Array.isArray(items)) {
        for (const item of items) all.push(mapApifyHdItem(item, store));
      }
    } catch (err) {
      onError?.(`Apify HD ${store.city}: ${err.message}`);
    }
  }
  return all;
}

async function scanDealWatchApify({ retailer, zipCodes = WV_ZIP_CODES, onError }) {
  if (!getToken()) return [];
  try {
    const items = await runActor(
      "pulsewatch~dealwatch-scraper",
      {
        zip_codes: zipCodes,
        store: retailer === "lowes" ? "lowes.com" : "homedepot.com",
        keywords: ["clearance", "closeout", "special buy", "paint", "tools", "lighting", "flooring"]
      },
      { timeoutSec: 600 }
    );
    if (!Array.isArray(items)) return [];
    return items.map(mapApifyDealWatchItem).filter((d) => d.sku);
  } catch (err) {
    onError?.(`Apify DealWatch ${retailer}: ${err.message}`);
    return [];
  }
}

async function scanAllApify(onError) {
  const hdClearance = await scanHomeDepotApify(HOME_DEPOT_WV, onError);
  const hdDealWatch = await scanDealWatchApify({ retailer: "homedepot", onError });
  const lowesDealWatch = await scanDealWatchApify({ retailer: "lowes", onError });
  return [...hdClearance, ...hdDealWatch, ...lowesDealWatch];
}

module.exports = {
  getToken,
  scanAllApify,
  scanDealWatchApify,
  scanHomeDepotApify
};
