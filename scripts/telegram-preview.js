const {
  buildAttentionAlerts,
  lateMessage,
  reportMessage,
  todayMessage,
  trackingMessage
} = require("../public/src/telegram-agent");

(async () => {
  console.log("=== /summary ===");
  console.log(await reportMessage());
  console.log("\n=== /tracking ===");
  console.log(await trackingMessage());
  console.log("\n=== /late ===");
  console.log(await lateMessage());
  console.log("\n=== /today ===");
  console.log(await todayMessage());
  console.log("\n=== alerts ===");
  console.log((await buildAttentionAlerts()).slice(0, 20).join("\n") || "No orders need attention right now.");
})();
