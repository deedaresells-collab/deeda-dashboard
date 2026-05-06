const { dailySummaryMessage, sendTelegramMessage } = require("../src/telegram-agent");

sendTelegramMessage(dailySummaryMessage())
  .then(() => {
    console.log("Daily Telegram summary sent.");
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
