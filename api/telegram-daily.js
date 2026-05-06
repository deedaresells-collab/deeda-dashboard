const { dailySummaryMessage, sendTelegramMessage } = require("../public/src/telegram-agent");

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    await sendTelegramMessage(await dailySummaryMessage());
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};
