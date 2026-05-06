const { dailySummaryMessage, sendTelegramMessage } = require("../public/src/telegram-agent");

(async () => sendTelegramMessage(await dailySummaryMessage()))()
  .then(() => {
    console.log("Daily Telegram summary sent.");
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
