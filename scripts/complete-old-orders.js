const fs = require("fs");
const path = require("path");

const ordersPath = path.join(__dirname, "..", "data", "orders.json");
const orders = JSON.parse(fs.readFileSync(ordersPath, "utf8"));

const currentMonth = new Date().toISOString().slice(0, 7);
let changed = 0;

for (const order of orders) {
  if (order.date && order.date.slice(0, 7) < currentMonth && order.status !== "Delivered" && order.status !== "Completed") {
    order.status = "Delivered";
    order.fulfilled = true;
    changed += 1;
  }
}

fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
console.log(`Marked ${changed} older orders as Delivered/Fulfilled.`);
