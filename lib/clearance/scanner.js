const { classifyDeal, isDeal, normalizeProduct } = require("./deal-rules");
const { HOME_DEPOT_WV, LOWES_WV } = require("./wv-stores");
const { scanAllHomeDepot } = require("./homedepot-scraper");
const { scanAllLowes } = require("./lowes-scraper");
const { getToken, scanAllApify } = require("./apify-scraper");
const dealsStore = require("./deals-store");
const { sendDealAlerts } = require("./alerts");

function dedupeKey(d) {
  return `${d.retailer}:${d.storeId}:${d.sku}`;
}

async function processProducts(rawProducts, runStats) {
  const newDeals = [];
  const seen = new Set();

  for (const raw of rawProducts) {
    const product = normalizeProduct(raw);
    const deal = classifyDeal(product);
    if (!deal || !product.sku) continue;

    const key = dedupeKey(product);
    if (seen.has(key)) continue;
    seen.add(key);

    const enriched = {
      ...product,
      alertType: deal.alertType,
      pctOff: deal.pctOff
    };

    runStats.dealsFound += 1;

    try {
      const saved = await dealsStore.upsertDeal(enriched);
      if (saved.isNew) {
        runStats.newDeals += 1;
        newDeals.push({ ...enriched, id: saved.id, alertSentAt: saved.alertSentAt });
      } else if (!saved.alertSentAt && (deal.alertType === "penny" || deal.alertType.startsWith("clearance"))) {
        newDeals.push({ ...enriched, id: saved.id, alertSentAt: null });
      }
    } catch (err) {
      runStats.errors.push(`Save ${key}: ${err.message}`);
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

    const newDeals = await processProducts(allProducts, stats);

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
        alertType: d.alertType,
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
  isDeal,
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
