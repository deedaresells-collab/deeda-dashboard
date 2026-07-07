#!/usr/bin/env node
/**
 * Manual WV clearance scan — run locally or via cron outside Vercel.
 * Usage: node scripts/run-clearance-scan.js
 */
const { runClearanceScan } = require("../lib/clearance/scanner");

runClearanceScan({ sendAlerts: true })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
