/**
 * Lowe's clearance scanner via search/clearance pages.
 * Store context is set via sn cookie. Bot protection is heavy — Apify is preferred when APIFY_TOKEN is set.
 */

const { CLEARANCE_KEYWORDS } = require("./wv-stores");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseHeaders(storeId) {
  return {
    Accept: "text/html,application/xhtml+xml,application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      process.env.LOWES_USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ...(storeId ? { Cookie: `sn=${storeId}; zipstate=WV` } : {})
  };
}

function parseEmbeddedProducts(html, store) {
  const products = [];
  const patterns = [
    /"itemNumber"\s*:\s*"(\d+)"[\s\S]{0,800}?"description"\s*:\s*"([^"]+)"[\s\S]{0,800}?"sellingPrice"\s*?:\s*([\d.]+)/g,
    /"omniItemId"\s*:\s*"(\d+)"[\s\S]{0,600}?"brand"\s*:\s*"([^"]*)"[\s\S]{0,600}?"sellingPrice"\s*?:\s*([\d.]+)/g
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(html)) !== null) {
      const sku = match[1];
      const title = match[2] || "Lowe's item";
      const price = Number(match[3]);
      if (!sku || !Number.isFinite(price)) continue;
      products.push({
        retailer: "lowes",
        storeId: store.storeId,
        storeCity: store.city,
        sku,
        title: title.replace(/\\u0026/g, "&"),
        brand: "",
        price,
        wasPrice: null,
        stockQty: null,
        imageUrl: "",
        productUrl: `https://www.lowes.com/pd/-/${sku}`,
        category: "clearance"
      });
    }
  }

  const seen = new Set();
  return products.filter((p) => {
    if (seen.has(p.sku)) return false;
    seen.add(p.sku);
    return true;
  });
}

async function fetchLowesSearch(store, keyword) {
  const q = encodeURIComponent(keyword);
  const url = `https://www.lowes.com/search?searchTerm=${q}`;
  const res = await fetch(url, { headers: baseHeaders(store.storeId), redirect: "follow" });
  if (!res.ok) throw new Error(`Lowe's search HTTP ${res.status}`);
  const html = await res.text();
  return parseEmbeddedProducts(html, store);
}

async function scanLowesStore(store, config = {}) {
  const keywords = ["clearance", "special value", "closeout", ...CLEARANCE_KEYWORDS.slice(0, config.maxKeywords || 6)];
  const all = [];
  const seen = new Set();

  for (const keyword of keywords) {
    try {
      const batch = await fetchLowesSearch(store, keyword);
      for (const p of batch) {
        if (!seen.has(p.sku)) {
          seen.add(p.sku);
          all.push(p);
        }
      }
      await sleep(config.delayMs || 1200);
    } catch (err) {
      config.onError?.(`Lowe's ${store.city} "${keyword}": ${err.message}`);
    }
  }
  return all;
}

async function scanAllLowes(stores, config = {}) {
  const results = [];
  for (const store of stores) {
    try {
      const batch = await scanLowesStore(store, config);
      results.push(...batch);
    } catch (err) {
      config.onError?.(`Lowe's store ${store.city}: ${err.message}`);
    }
  }
  return results;
}

module.exports = {
  fetchLowesSearch,
  parseEmbeddedProducts,
  scanAllLowes,
  scanLowesStore
};
