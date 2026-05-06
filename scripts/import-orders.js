const fs = require("fs");
const path = require("path");

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/import-orders.js <orders.csv>");
  process.exit(1);
}

const root = path.join(__dirname, "..");
const outputDir = path.join(root, "data");
const output = path.join(outputDir, "orders.json");

function parseDelimited(text) {
  const firstLine = String(text).split(/\r?\n/)[0] || "";
  const delimiter = firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function normalizedHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildHeaderIndex(headers) {
  const index = {};
  headers.forEach((header, i) => {
    index[normalizedHeader(header)] = i;
  });
  return index;
}

function pick(row, index, names) {
  for (const name of names) {
    const key = normalizedHeader(name);
    if (index[key] != null) return row[index[key]] ?? "";
  }
  return "";
}

function numberValue(value) {
  const cleaned = String(value ?? "").replace(/[$,%]/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/chrome hearts?/g, "chrome heart")
    .replace(/\bch\b/g, "chrome heart")
    .replace(/\bls\b/g, "long sleeve")
    .replace(/longsleeve/g, "long sleeve")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function guessCategory(productName) {
  const name = normalize(productName);
  const rules = [
    ["Shoes", ["shoe", "jordan", "nike", "balenciaga", "vans", "yeezy", "dunk", "metallic", "metalic", "travis", "rick owen", "bapesta", "dior"]],
    ["Hoodies", ["hoodie", "hooded", "zip up", "sp5der"]],
    ["Longsleeves", ["long sleeve", "longsleeve", "ls"]],
    ["Shirts", ["shirt", "tee", "t shirt", "god speed", "hellstar"]],
    ["Jeans", ["jean", "denim", "amiri", "ksubi"]],
    ["Pants", ["pant", "sweatpant", "trouser", "shorts", "jorts"]],
    ["Socks", ["sock"]],
    ["Jackets", ["jacket", "coat", "puffer", "northface", "bape jacket"]],
    ["SET", ["set", "tracksuit", "alo", "lululemon"]],
    ["Watches", ["watch", "rolex", "g shock", "gshock", "cartier", "ap watch"]],
    ["Glasses", ["glasses", "sunglasses", "frames"]],
    ["Bags", ["bag", "goyard", "diaper", "tote", "backpack", "messenger"]],
    ["Belt", ["belt"]],
    ["Jewelry", ["chain", "bracelet", "necklace", "ring", "jewelry"]],
    ["Membership", ["membership", "mentorship"]]
  ];
  const match = rules.find(([, words]) => words.some((word) => name.includes(word)));
  return match ? match[0] : "Other";
}

function normalizeCategory(category, productName) {
  const clean = String(category || "").trim();
  if (!clean || clean === "-" || clean.toLowerCase() === "uncategorized") return guessCategory(productName);
  if (clean.toLowerCase() === "clothing") return guessCategory(productName);
  if (clean.toLowerCase() === "jacket") return "Jackets";
  if (clean.toLowerCase() === "hat") return "Other";
  if (clean.toLowerCase() === "mentorship") return "Membership";
  return clean;
}

function normalizeStatus(status) {
  const clean = String(status || "").toLowerCase();
  if (clean.includes("ship")) return "Shipped";
  if (clean.includes("complete")) return "Completed";
  if (clean.includes("deliver")) return "Delivered";
  if (clean.includes("refund") || clean.includes("issue")) return "Issue / Refund";
  if (clean.includes("paid")) return "Paid";
  if (clean.includes("submit")) return "Submitted";
  if (clean.includes("order")) return "Ordered";
  return "New Order";
}

const text = fs.readFileSync(input, "utf8");
const parsed = parseDelimited(text);
const headers = parsed.shift();
const index = buildHeaderIndex(headers);
const grouped = {};

for (const row of parsed) {
  const id = pick(row, index, ["Order_ID", "ID", "Order ID"]);
  if (!id) continue;

  const productName = pick(row, index, ["Brand_Model", "Brand/Model", "Product", "Product Name", "Notes"]) || "Unknown Product";
  const qty = numberValue(pick(row, index, ["Qty", "Quantity"])) || 1;
  const lineRevenue = numberValue(pick(row, index, ["Revenue"]));
  const lineCost = numberValue(pick(row, index, ["Total_Cost", "Total Cost"]));
  const shipping = numberValue(pick(row, index, ["Shipping"]));
  const salePrice = lineRevenue ? lineRevenue / qty : numberValue(pick(row, index, ["Sale_Price", "Sale Price"]));
  const productCost = lineCost ? Math.max(0, lineCost / qty - shipping / qty) : numberValue(pick(row, index, ["Unit_Cost", "Unit Cost"]));

  grouped[id] ||= {
    id,
    date: pick(row, index, ["Date"]),
    customerName: pick(row, index, ["Customer"]) || "Unknown",
    contact: pick(row, index, ["Contact"]),
    address: pick(row, index, ["Address"]),
    city: pick(row, index, ["City"]),
    state: pick(row, index, ["State"]),
    payment: pick(row, index, ["Payment"]),
    status: normalizeStatus(pick(row, index, ["Status"])),
    trackingNumber: pick(row, index, ["Tracking", "Tracking Number"]),
    notes: pick(row, index, ["Notes"]),
    items: []
  };

  grouped[id].items.push({
    productName,
    category: normalizeCategory(pick(row, index, ["Category"]), productName),
    size: pick(row, index, ["Clothing_Size", "Clothing Size"]) || pick(row, index, ["Shoe_Size", "Shoe Size"]),
    quantity: qty,
    salePrice,
    productCost,
    shippingCost: shipping,
    lineRevenue,
    lineCost,
    discount: numberValue(pick(row, index, ["Discount"])),
    sourceLineNo: pick(row, index, ["Line_No", "Line No"])
  });
}

const orders = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(output, JSON.stringify(orders, null, 2));

const totals = orders.reduce(
  (sum, order) => {
    for (const item of order.items) {
      sum.revenue += Number(item.lineRevenue || 0);
      sum.cost += Number(item.lineCost || 0);
      sum.profit += Number(item.lineRevenue || 0) - Number(item.lineCost || 0);
      sum.lines += 1;
      sum.units += Number(item.quantity || 1);
    }
    sum.orders += 1;
    return sum;
  },
  { orders: 0, lines: 0, units: 0, revenue: 0, cost: 0, profit: 0 }
);

console.log(JSON.stringify(totals, null, 2));
