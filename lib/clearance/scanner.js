const { classifyDeal, normalizeProduct } = require("./deal-rules");
const { HOME_DEPOT_WV, LOWES_WV } = require("./wv-stores");
const { scanAllHomeDepot } = require("./homedepot-scraper");
const { scanAllLowes } = require("./lowes-scraper");
const { getToken, scanAllApify } = require("./apify-scraper");
const dealsStore = require("./deals-store");
const { sendDealAlerts } = require("./alerts");
const { verifyProduct } = require("./verifier");

function dedupeKey(d) {
  return `${d.retailer}:${d.storeId}:${d.sku}`;
}

function enrichStoreMeta(product) {
  const stores = product.retailer === "lowes" ? LOWES_WV : HOME_DEPOT_WV;
  const store = stores.find((s) => s.storeId === product.storeId);
  return {
    ...product,
    storeCity: product.storeCity || store?.city || "",
    storeZip: product.storeZip || product.zip || store?.zip || null
  };
}

async function processProducts(rawProducts, runStats, options = {}) {
  const newDeals = [];
  const seen = new Set();

  for (const raw of rawProducts) {
    const base = enrichStoreMeta(normalizeProduct(raw));
    if (!base.sku) continue;

    const key = dedupeKey(base);
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const result = await verifyProduct(base, {
        zip: options.zip || base.storeZip,
        minDiscount: options.minDiscount ?? 50,
        verifyStock: options.verifyStock !== false,
        requireStock: options.requireStock !== false
      });

      if (!result.published) {
        runStats.skipped = (runStats.skipped || 0) + 1;
        continue;
      }

      const enriched = result.product;
      const deal = classifyDeal(enriched);
      if (!deal) continue;

      runStats.dealsFound += 1;

      const saved = await dealsStore.upsertDeal(enriched);
      if (saved.isNew) {
        runStats.newDeals += 1;
        newDeals.push({ ...enriched, id: saved.id, alertSentAt: saved.alertSentAt });
      } else if (!saved.alertSentAt && (deal.alertType === "penny" || deal.alertType.startsWith("clearance"))) {
        newDeals.push({ ...enriched, id: saved.id, alertSentAt: null });
      }
    } catch (err) {
      runStats.errors.push(`Verify ${key}: ${err.message}`);
    }
  }

  return newDeals;
}

async function runClearanceScan(options = {}) {
  const errors = [];
  const onError = (msg) => errors.push(msg);
  const run = await dealsStore.startScanRun();
  const runId = run.id;

  const stats = {
    storesScanned: 0,
    dealsFound: 0,
    newDeals: 0,
    skipped: 0,
    alertsSent: 0,
    errors,
    sources: []
  };

  let allProducts = [];
  const hasApify = Boolean(getToken());

  try {
    if (hasApify && options.useApify !== false) {
      const apifyProducts = await scanAllApify(onError);
      allProducts.push(...apifyProducts);
      stats.sources.push(`apify:${apifyProducts.length}`);
      stats.storesScanned += HOME_DEPOT_WV.length + LOWES_WV.length;
    }

    if (options.useDirect !== false) {
      const hour = new Date().getUTCHours();
      const hdStores = hasApify ? HOME_DEPOT_WV : rotateStores(HOME_DEPOT_WV, hour, 2);
      const lowesStores = hasApify ? LOWES_WV : rotateStores(LOWES_WV, hour, 4);

      const hdProducts = await scanAllHomeDepot(hdStores, { onError, maxPages: hasApify ? 2 : 1, maxKeywords: hasApify ? 6 : 4, delayMs: 500 });
      allProducts.push(...hdProducts);
      stats.sources.push(`homedepot-direct:${hdProducts.length}`);
      stats.storesScanned += hdStores.length;

      const lowesProducts = await scanAllLowes(lowesStores, { onError, maxKeywords: hasApify ? 5 : 3, delayMs: 1000 });
      allProducts.push(...lowesProducts);
      stats.sources.push(`lowes-direct:${lowesProducts.length}`);
      stats.storesScanned += lowesStores.length;
    }

    const newDeals = await processProducts(allProducts, stats, {
      zip: options.zip,
      minDiscount: options.minDiscount ?? 50,
      verifyStock: options.verifyStock
    });

    if (options.sendAlerts !== false && newDeals.length) {
      const alertResult = await sendDealAlerts(newDeals);
      stats.alertsSent = alertResult.sent;
      for (const id of alertResult.markedIds) {
        await dealsStore.markAlertSent(id);
      }
    }

    await dealsStore.finishScanRun(runId, {
      stores_scanned: stats.storesScanned,
      deals_found: stats.dealsFound,
      new_deals: stats.newDeals,
      alerts_sent: stats.alertsSent,
      errors: stats.errors,
      status: "completed"
    });

    return {
      ok: true,
      runId,
      ...stats,
      totalScanned: allProducts.length,
      deals: newDeals.slice(0, 50).map((d) => ({
        retailer: d.retailer,
        storeCity: d.storeCity,
        title: d.title,
        price: d.price,
        wasPrice: d.wasPrice,
        pctOff: d.pctOff,
        kind: d.kind,
        verified: d.verified,
        alertType: d.alertType,
        stockQty: d.stockQty,
        productUrl: d.productUrl
      }))
    };
  } catch (err) {
    errors.push(err.message);
    await dealsStore.finishScanRun(runId, {
      stores_scanned: stats.storesScanned,
      deals_found: stats.dealsFound,
      new_deals: stats.newDeals,
      alerts_sent: stats.alertsSent,
      errors,
      status: "failed"
    });
    throw err;
  }
}

module.exports = {
  processProducts,
  runClearanceScan,
  rotateStores
};

function rotateStores(stores, hour, batchSize) {
  if (batchSize >= stores.length) return stores;
  const start = (hour * batchSize) % stores.length;
  const picked = [];
  for (let i = 0; i < batchSize; i += 1) {
    picked.push(stores[(start + i) % stores.length]);
  }
  return picked;
}
