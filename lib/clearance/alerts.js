const { sendTelegramMessage } = require("../../public/src/telegram-agent");

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function retailerLabel(retailer) {
  return retailer === "lowes" ? "Lowe's" : "Home Depot";
}

function alertEmoji(alertType) {
  if (alertType === "penny") return "PENNY";
  if (alertType === "clearance_90") return "90%+ OFF";
  if (alertType === "clearance_70") return "70%+ OFF";
  if (alertType === "clearance_50") return "50%+ OFF";
  return "DEAL";
}

function formatDealLine(deal) {
  const tag = alertEmoji(deal.alertType);
  const store = deal.storeCity || deal.storeId;
  const price = money(deal.price);
  const was = deal.wasPrice ? ` (was ${money(deal.wasPrice)})` : "";
  const stock = deal.stockQty != null ? ` | Stock: ${deal.stockQty}` : "";
  return `[${tag}] ${retailerLabel(deal.retailer)} ${store}\n${deal.title}\n${price}${was}${stock}\n${deal.productUrl || ""}`;
}

async function sendDealAlerts(deals) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: 0, markedIds: [], skipped: deals.length };

  const priority = { penny: 0, clearance_90: 1, clearance_70: 2, clearance_50: 3, markdown: 4 };
  const sorted = [...deals].sort((a, b) => (priority[a.alertType] ?? 9) - (priority[b.alertType] ?? 9));

  const penny = sorted.filter((d) => d.alertType === "penny");
  const clearance = sorted.filter((d) => d.alertType !== "penny");
  const markedIds = [];
  let sent = 0;

  if (penny.length) {
    const text = [
      `WV PENNY ALERT — ${penny.length} item(s)`,
      "",
      ...penny.slice(0, 15).map(formatDealLine),
      penny.length > 15 ? `\n...and ${penny.length - 15} more in Deeda Deals` : ""
    ].join("\n\n");
    await sendTelegramMessage(text.trim());
    sent += 1;
    for (const d of penny) if (d.id) markedIds.push(d.id);
  }

  if (clearance.length) {
    const chunks = [];
    for (let i = 0; i < clearance.length; i += 10) {
      chunks.push(clearance.slice(i, i + 10));
    }
    for (let i = 0; i < Math.min(chunks.length, 3); i += 1) {
      const batch = chunks[i];
      const text = [
        `WV Clearance — ${batch.length} deal(s)${chunks.length > 1 ? ` (batch ${i + 1})` : ""}`,
        "",
        ...batch.map(formatDealLine)
      ].join("\n\n");
      await sendTelegramMessage(text.trim());
      sent += 1;
      for (const d of batch) if (d.id) markedIds.push(d.id);
    }
  }

  return { sent, markedIds: [...new Set(markedIds)] };
}

async function dealsSummaryMessage() {
  const dealsStore = require("./deals-store");
  const deals = await dealsStore.listDeals({ limit: 500 });
  const penny = deals.filter((d) => d.alertType === "penny");
  const clearance = deals.filter((d) => d.alertType?.startsWith("clearance"));
  const hd = deals.filter((d) => d.retailer === "homedepot");
  const lowes = deals.filter((d) => d.retailer === "lowes");

  return [
    "Deeda WV Clearance Scanner",
    "",
    `Active deals: ${deals.length}`,
    `Penny items: ${penny.length}`,
    `Clearance (50%+): ${clearance.length}`,
    `Home Depot: ${hd.length} | Lowe's: ${lowes.length}`,
    "",
    "Top penny picks:",
    penny.length
      ? penny.slice(0, 10).map((d) => `- ${d.storeCity}: ${d.title} @ ${money(d.price)}`).join("\n")
      : "No penny items right now.",
    "",
    "Top clearance:",
    clearance.length
      ? clearance
          .sort((a, b) => (b.pctOff || 0) - (a.pctOff || 0))
          .slice(0, 8)
          .map((d) => `- ${d.storeCity} (${d.pctOff}%): ${d.title} @ ${money(d.price)}`)
          .join("\n")
      : "No clearance deals right now."
  ].join("\n");
}

module.exports = {
  dealsSummaryMessage,
  formatDealLine,
  sendDealAlerts
};
