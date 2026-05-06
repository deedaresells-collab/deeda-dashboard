require("../src/telegram-agent");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    commands: [
      { command: "summary", description: "Current order report" },
      { command: "tracking", description: "Orders missing tracking" },
      { command: "late", description: "Orders older than 3 days" },
      { command: "today", description: "Today's revenue, profit, orders" },
      { command: "help", description: "List commands" }
    ]
  })
})
  .then(async (response) => {
    if (!response.ok) throw new Error(`Telegram command setup failed: ${response.status}`);
    console.log("Telegram commands updated.");
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
