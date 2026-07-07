/**
 * Price history tracker — mirrors Hidden Clearances /api/v1/history/{retailer}.
 * Detects penny transitions by comparing current price to prior snapshots.
 */

const fs = require("fs");
const path = require("path");
const { supabaseRequest } = require("../../api/_supabase");

const dataDir = path.join(__dirname, "..", "..", "data");
const historyFile = path.join(dataDir, "price-history.json");

function useSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
  return Boolean(key);
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

function historyKey(retailer, storeId, sku) {
  return `${retailer}:${storeId}:${sku}`;
}

async function getLastSnapshot(retailer, storeId, sku) {
  if (useSupabase()) {
    const rows = await supabaseRequest(
      `clearance_price_history?retailer=eq.${encodeURIComponent(retailer)}&store_id=eq.${encodeURIComponent(storeId)}&sku=eq.${encodeURIComponent(sku)}&order=scanned_at.desc&limit=1`
    );
    return Array.isArray(rows) && rows[0] ? mapRow(rows[0]) : null;
  }
  const all = readJson(historyFile, []);
  const matches = all.filter((h) => h.retailer === retailer && h.storeId === storeId && h.sku === sku);
  return matches.sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))[0] || null;
}

async function recordSnapshot(product) {
  const row = {
    retailer: product.retailer,
    store_id: product.storeId,
    sku: product.sku,
    title: product.title,
    price: product.price,
    was_price: product.wasPrice,
    stock_qty: product.stockQty,
    scanned_at: new Date().toISOString()
  };

  if (useSupabase()) {
    await supabaseRequest("clearance_price_history", { method: "POST", body: row, prefer: "return=minimal" });
    return;
  }

  const all = readJson(historyFile, []);
  all.unshift({
    retailer: product.retailer,
    storeId: product.storeId,
    sku: product.sku,
    title: product.title,
    price: product.price,
    wasPrice: product.wasPrice,
    stockQty: product.stockQty,
    scannedAt: row.scanned_at
  });
  writeJson(historyFile, all.slice(0, 20000));
}

/**
 * HC-style penny detection: price dropped to <=0.03, or dropped 30%+ since last scan.
 */
function detectTransition(current, previous) {
  const cur = Number(current.price);
  const prev = previous ? Number(previous.price) : null;
  const was = Number(current.wasPrice || previous?.wasPrice || 0);

  if (!Number.isFinite(cur)) return null;

  if (cur <= 0.03) {
    const nearPenny = prev != null && prev > 0.03 && prev <= 0.05;
    const freshPenny = prev == null || prev > 0.03;
    if (freshPenny || nearPenny) {
      return { signal: "penny", reason: cur <= 0.01 ? "hit_penny" : "near_penny", previousPrice: prev };
    }
  }

  if (prev != null && prev > 0 && cur < prev) {
    const dropPct = ((prev - cur) / prev) * 100;
    if (dropPct >= 30) {
      return { signal: "price_drop", reason: "markdown", previousPrice: prev, dropPct: Math.round(dropPct) };
    }
  }

  if (was > 0 && cur < was) {
    const off = Math.round(((was - cur) / was) * 100);
    if (off >= 50 && (prev == null || cur < prev)) {
      return { signal: "clearance", reason: "first_clearance", previousPrice: prev, dropPct: off };
    }
  }

  return null;
}

async function listHistory(retailer) {
  if (useSupabase()) {
    const params = new URLSearchParams();
    params.set("order", "scanned_at.desc");
    params.set("limit", "500");
    if (retailer) params.set("retailer", `eq.${retailer}`);
    const rows = await supabaseRequest(`clearance_price_history?${params}`);
    return (rows || []).map(mapRow);
  }
  let all = readJson(historyFile, []);
  if (retailer) all = all.filter((h) => h.retailer === retailer);
  return all.slice(0, 500);
}

function mapRow(row) {
  return {
    id: row.id,
    retailer: row.retailer,
    storeId: row.store_id,
    sku: row.sku,
    title: row.title,
    price: row.price != null ? Number(row.price) : null,
    wasPrice: row.was_price != null ? Number(row.was_price) : null,
    stockQty: row.stock_qty,
    scannedAt: row.scanned_at
  };
}

module.exports = {
  detectTransition,
  getLastSnapshot,
  historyKey,
  listHistory,
  recordSnapshot
};
