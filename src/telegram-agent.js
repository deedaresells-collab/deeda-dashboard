const fs = require("fs");
const path = require("path");

const ORDERS_PATH = path.join(__dirname, "..", "data", "orders.json");
const ATTENTION_STATUSES = new Set(["Submitted", "Ordered", "Waiting to Ship"]);
const DONE_STATUSES = new Set(["Shipped", "Delivered", "Completed", "Issue / Refund"]);

loadLocalEnv();

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const envPath = path.join(__dirname, "..", fileName);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = valueParts.join("=").trim();
    }
  }
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function loadOrders() {
  if (!fs.existsSync(ORDERS_PATH)) return [];
  return JSON.parse(fs.readFileSync(ORDERS_PATH, "utf8"));
}

function itemAmounts(item) {
  const qty = Number(item.quantity || 1);
  const revenue = item.lineRevenue != null ? Number(item.lineRevenue || 0) : Number(item.salePrice || 0) * qty;
  const cost = item.lineCost != null ? Number(item.lineCost || 0) : Number(item.productCost || 0) * qty + Number(item.shippingCost || 0);
  return { qty, revenue, cost, profit: revenue - cost };
}

function orderTotals(order) {
  return order.items.reduce(
    (sum, item) => {
      const amount = itemAmounts(item);
      sum.revenue += amount.revenue;
      sum.cost += amount.cost;
      sum.profit += amount.profit;
      sum.qty += amount.qty;
      return sum;
    },
    { revenue: 0, cost: 0, profit: 0, qty: 0 }
  );
}

function totalsFor(orders) {
  return orders.reduce(
    (sum, order) => {
      const totals = orderTotals(order);
      sum.orders += 1;
      sum.revenue += totals.revenue;
      sum.cost += totals.cost;
      sum.profit += totals.profit;
      sum.qty += totals.qty;
      return sum;
    },
    { orders: 0, revenue: 0, cost: 0, profit: 0, qty: 0 }
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function daysOld(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(`${date}T00:00:00`).getTime()) / 86400000));
}

function isAttentionStatus(order) {
  return ATTENTION_STATUSES.has(order.status);
}

function missingTrackingOrders(orders = loadOrders()) {
  return orders
    .filter((order) => isAttentionStatus(order) && !String(order.trackingNumber || "").trim())
    .sort((a, b) => daysOld(b.date) - daysOld(a.date) || Number(b.id) - Number(a.id));
}

function lateOrders(orders = loadOrders()) {
  return orders
    .filter((order) => isAttentionStatus(order) && daysOld(order.date) > 3)
    .sort((a, b) => daysOld(b.date) - daysOld(a.date) || Number(b.id) - Number(a.id));
}

function formatOrderLine(order, includeProfit = true) {
  const totals = orderTotals(order);
  const base = `#${order.id} ${order.customerName} - ${order.status} - ${daysOld(order.date)} days - ${order.items.length} items`;
  return includeProfit ? `${base} - ${money(totals.profit)} profit` : `${base}`;
}

function todayActivity(orders = loadOrders()) {
  const today = todayKey();
  return {
    newOrders: orders.filter((order) => order.date === today),
    shipped: orders.filter((order) => order.date === today && order.status === "Shipped"),
    completed: orders.filter((order) => order.date === today && DONE_STATUSES.has(order.status))
  };
}

function reportMessage() {
  const orders = loadOrders();
  const todayOrders = orders.filter((order) => order.date === todayKey());
  const monthOrders = orders.filter((order) => order.date.startsWith(monthKey()));
  const daily = totalsFor(todayOrders);
  const monthly = totalsFor(monthOrders);
  const tracking = missingTrackingOrders(orders);
  const late = lateOrders(orders);
  const activity = todayActivity(orders);
  const hasIssues = tracking.length || late.length;

  return [
    "Deeda Order Report",
    "",
    "Daily:",
    `Revenue: ${money(daily.revenue)}`,
    `Profit: ${money(daily.profit)}`,
    `Orders: ${daily.orders}`,
    "",
    "Month:",
    `Revenue: ${money(monthly.revenue)}`,
    `Profit: ${money(monthly.profit)}`,
    "",
    "Needs Tracking:",
    tracking.length ? tracking.slice(0, 25).map((order) => `- ${formatOrderLine(order)}`).join("\n") : "No orders need tracking.",
    "",
    "Waiting Too Long (3+ days):",
    late.length ? late.slice(0, 25).map((order) => `- #${order.id} ${order.customerName} - ${daysOld(order.date)} days old - ${order.status}`).join("\n") : "No late orders.",
    "",
    "Recent Activity:",
    `- New orders today: ${activity.newOrders.length}`,
    `- Orders shipped today: ${activity.shipped.length}`,
    `- Orders completed today: ${activity.completed.length}`,
    "",
    hasIssues ? "" : "No orders need attention right now."
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trim();
}

function trackingMessage() {
  const orders = missingTrackingOrders();
  return [
    "Orders Missing Tracking",
    "",
    orders.length ? orders.slice(0, 50).map((order) => `- ${formatOrderLine(order)}`).join("\n") : "No orders need attention right now."
  ].join("\n");
}

function lateMessage() {
  const orders = lateOrders();
  return [
    "Orders Waiting Too Long",
    "",
    orders.length
      ? orders.slice(0, 50).map((order) => `- #${order.id} ${order.customerName} - ${daysOld(order.date)} days old - ${order.status}`).join("\n")
      : "No orders need attention right now."
  ].join("\n");
}

function todayMessage() {
  const orders = loadOrders().filter((order) => order.date === todayKey());
  const totals = totalsFor(orders);
  return ["Today", "", `Revenue: ${money(totals.revenue)}`, `Profit: ${money(totals.profit)}`, `Orders: ${totals.orders}`].join("\n");
}

function helpMessage() {
  return [
    "Deeda Order Bot Commands",
    "",
    "/summary - current order report",
    "/tracking - orders missing tracking",
    "/late - orders older than 3 days",
    "/today - today's revenue, profit, orders",
    "/help - command list"
  ].join("\n");
}

function buildAttentionAlerts(orders = loadOrders()) {
  const alerts = [];
  for (const order of missingTrackingOrders(orders)) {
    alerts.push(`Order #${order.id} (${order.customerName}) is missing tracking.`);
  }
  for (const order of lateOrders(orders)) {
    alerts.push(`Order #${order.id} (${order.customerName}) is ${daysOld(order.date)} days old and still ${order.status}.`);
  }
  return alerts;
}

async function sendTelegramMessage(text, chatId = process.env.TELEGRAM_CHAT_ID) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Missing TELEGRAM_CHAT_ID");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  if (!response.ok) throw new Error(`Telegram send failed: ${response.status}`);
  return response.json();
}

async function handleTelegramUpdate(update) {
  const message = update.message || update.edited_message;
  if (!message?.text) return { ignored: true };
  const chatId = message.chat.id;
  const command = message.text.trim().split(/\s+/)[0].toLowerCase();
  const replies = {
    "/summary": reportMessage,
    "/tracking": trackingMessage,
    "/late": lateMessage,
    "/today": todayMessage,
    "/help": helpMessage
  };
  const reply = replies[command] ? replies[command]() : helpMessage();
  await sendTelegramMessage(reply, chatId);
  return { ok: true };
}

module.exports = {
  buildAttentionAlerts,
  dailySummaryMessage: reportMessage,
  handleTelegramUpdate,
  helpMessage,
  lateMessage,
  reportMessage,
  sendTelegramMessage,
  summaryMessage: reportMessage,
  todayMessage,
  trackingMessage
};
