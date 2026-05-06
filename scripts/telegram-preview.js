const {
  buildAttentionAlerts,
  lateMessage,
  reportMessage,
  todayMessage,
  trackingMessage
} = require("../src/telegram-agent");

console.log("=== /summary ===");
console.log(reportMessage());
console.log("\n=== /tracking ===");
console.log(trackingMessage());
console.log("\n=== /late ===");
console.log(lateMessage());
console.log("\n=== /today ===");
console.log(todayMessage());
console.log("\n=== alerts ===");
console.log(buildAttentionAlerts().slice(0, 20).join("\n") || "No orders need attention right now.");
