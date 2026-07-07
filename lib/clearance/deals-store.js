const fs = require("fs");
const path = require("path");
const { supabaseRequest } = require("../../api/_supabase");

const dataDir = path.join(__dirname, "..", "..", "data");
const dealsFile = path.join(dataDir, "clearance-deals.json");
const runsFile = path.join(dataDir, "clearance-runs.json");

function useSupabase() {
  try {
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_ANON_KEY;
    return Boolean(key);
  } catch {
    return false;
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function upsertDeal(deal) {
  const row = {
    retailer: deal.retailer,
    store_id: deal.storeId,
    store_city: deal.storeCity || null,
    store_zip: deal.storeZip || deal.zip || null,
    sku: deal.sku,
    title: deal.title,
    brand: deal.brand || null,
    price: deal.price,
    was_price: deal.wasPrice,
    pct_off: deal.pctOff || 0,
    stock_qty: deal.stockQty,
    alert_type: deal.alertType,
    kind: deal.kind || (deal.alertType === "penny" ? "penny" : "in_store"),
    verified: deal.verified !== false,
    image_url: deal.imageUrl || null,
    product_url: deal.productUrl || null,
    category: deal.category || null,
    aisle: deal.aisle || null,
    bay: deal.bay || null,
    previous_price: deal.previousPrice ?? null,
    transition_reason: deal.transitionReason || null,
    last_seen_at: new Date().toISOString()
  };

  if (useSupabase()) {
    const existing = await supabaseRequest(
      `clearance_deals?retailer=eq.${encodeURIComponent(deal.retailer)}&store_id=eq.${encodeURIComponent(deal.storeId)}&sku=eq.${encodeURIComponent(deal.sku)}&select=id,alert_sent_at,first_seen_at`
    );
    const found = Array.isArray(existing) && existing[0];
    if (found) {
      await supabaseRequest(`clearance_deals?id=eq.${found.id}`, {
        method: "PATCH",
        body: { ...row, alert_sent_at: found.alert_sent_at },
        prefer: "return=minimal"
      });
      return { isNew: false, id: found.id, alertSentAt: found.alert_sent_at };
    }
    const inserted = await supabaseRequest("clearance_deals", {
      method: "POST",
      body: row,
      prefer: "return=representation"
    });
    const id = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
    return { isNew: true, id, alertSentAt: null };
  }

  const deals = readJson(dealsFile, []);
  const key = `${deal.retailer}:${deal.storeId}:${deal.sku}`;
  const idx = deals.findIndex((d) => `${d.retailer}:${d.storeId}:${d.sku}` === key);
  if (idx >= 0) {
    const prev = deals[idx];
    deals[idx] = { ...prev, ...deal, lastSeenAt: row.last_seen_at };
    writeJson(dealsFile, deals);
    return { isNew: false, id: prev.id || key, alertSentAt: prev.alertSentAt || null };
  }
  const id = `deal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  deals.unshift({ ...deal, id, firstSeenAt: row.last_seen_at, lastSeenAt: row.last_seen_at, alertSentAt: null, status: "active" });
  writeJson(dealsFile, deals.slice(0, 5000));
  return { isNew: true, id, alertSentAt: null };
}

async function markAlertSent(id) {
  const sentAt = new Date().toISOString();
  if (useSupabase()) {
    await supabaseRequest(`clearance_deals?id=eq.${id}`, {
      method: "PATCH",
      body: { alert_sent_at: sentAt },
      prefer: "return=minimal"
    });
    return;
  }
  const deals = readJson(dealsFile, []);
  const deal = deals.find((d) => d.id === id);
  if (deal) deal.alertSentAt = sentAt;
  writeJson(dealsFile, deals);
}

async function listDeals({ limit = 500, alertType, retailer, kind, verified } = {}) {
  if (useSupabase()) {
    const params = new URLSearchParams();
    params.set("select", "*");
    params.set("order", "last_seen_at.desc");
    params.set("limit", String(limit));
    params.set("status", "eq.active");
    if (alertType) params.set("alert_type", `eq.${alertType}`);
    if (retailer) params.set("retailer", `eq.${retailer}`);
    if (kind) params.set("kind", `eq.${kind}`);
    if (verified === true) params.set("verified", "eq.true");
    const rows = await supabaseRequest(`clearance_deals?${params}`);
    return (rows || []).map(mapRow);
  }
  let deals = readJson(dealsFile, []).filter((d) => d.status !== "expired");
  if (alertType) deals = deals.filter((d) => d.alertType === alertType);
  if (retailer) deals = deals.filter((d) => d.retailer === retailer);
  if (kind) deals = deals.filter((d) => d.kind === kind);
  if (verified === true) deals = deals.filter((d) => d.verified !== false);
  return deals.slice(0, limit);
}

async function startScanRun() {
  const run = { started_at: new Date().toISOString(), status: "running", stores_scanned: 0, deals_found: 0, new_deals: 0, alerts_sent: 0, errors: [] };
  if (useSupabase()) {
    const rows = await supabaseRequest("clearance_scan_runs", { method: "POST", body: run, prefer: "return=representation" });
    return Array.isArray(rows) ? rows[0] : rows;
  }
  const runs = readJson(runsFile, []);
  const local = { ...run, id: `run-${Date.now()}`, errors: [] };
  runs.unshift(local);
  writeJson(runsFile, runs.slice(0, 100));
  return local;
}

async function finishScanRun(id, patch) {
  const body = { ...patch, finished_at: new Date().toISOString(), status: patch.status || "completed" };
  if (useSupabase()) {
    await supabaseRequest(`clearance_scan_runs?id=eq.${id}`, { method: "PATCH", body, prefer: "return=minimal" });
    return;
  }
  const runs = readJson(runsFile, []);
  const run = runs.find((r) => r.id === id);
  if (run) Object.assign(run, body);
  writeJson(runsFile, runs);
}

function mapRow(row) {
  return {
    id: row.id,
    retailer: row.retailer,
    storeId: row.store_id,
    storeCity: row.store_city,
    storeZip: row.store_zip,
    sku: row.sku,
    title: row.title,
    brand: row.brand,
    price: row.price != null ? Number(row.price) : null,
    wasPrice: row.was_price != null ? Number(row.was_price) : null,
    previousPrice: row.previous_price != null ? Number(row.previous_price) : null,
    pctOff: row.pct_off,
    stockQty: row.stock_qty,
    alertType: row.alert_type,
    kind: row.kind || "in_store",
    verified: row.verified !== false,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    category: row.category,
    aisle: row.aisle,
    bay: row.bay,
    transitionReason: row.transition_reason,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    alertSentAt: row.alert_sent_at,
    status: row.status
  };
}

module.exports = {
  finishScanRun,
  listDeals,
  markAlertSent,
  startScanRun,
  upsertDeal,
  useSupabase
};
