const { supabaseRequest } = require("./_supabase");

const ORDER_COLUMNS = [
  "order_id",
  "date",
  "customer_name",
  "contact",
  "payment",
  "status",
  "tracking_number",
  "address",
  "city",
  "state",
  "order_notes",
  "fulfilled",
  "item_index",
  "product_name",
  "category",
  "size",
  "quantity",
  "sale_price",
  "product_cost",
  "shipping_cost",
  "discount",
  "line_revenue",
  "line_cost",
  "line_profit",
  "margin_percent",
  "source_line_no"
];

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function normalizeDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function rowProfit(row, revenue, cost) {
  if (row.line_profit !== null && row.line_profit !== undefined && row.line_profit !== "") {
    return numberValue(row.line_profit);
  }
  return revenue - cost;
}

function groupDashboardRows(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    const id = String(row.order_id ?? "").trim();
    if (!id) continue;

    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        date: normalizeDate(row.date),
        customerName: row.customer_name || "Unknown",
        contact: row.contact || "",
        payment: row.payment || "",
        status: row.status || "New Order",
        trackingNumber: row.tracking_number || "",
        address: row.address || "",
        city: row.city || "",
        state: row.state || "",
        notes: row.order_notes || "",
        fulfilled: Boolean(row.fulfilled),
        items: []
      });
    }

    const quantity = numberValue(row.quantity) || 1;
    const lineRevenue = hasValue(row.line_revenue) ? numberValue(row.line_revenue) : numberValue(row.sale_price) * quantity;
    const lineCost = hasValue(row.line_cost)
      ? numberValue(row.line_cost)
      : numberValue(row.product_cost) * quantity + numberValue(row.shipping_cost);
    const lineProfit = rowProfit(row, lineRevenue, lineCost);

    grouped.get(id).items.push({
      itemIndex: row.item_index,
      productName: row.product_name || "Unknown Product",
      category: row.category || "Other",
      size: row.size || "",
      quantity,
      salePrice: numberValue(row.sale_price),
      productCost: numberValue(row.product_cost),
      shippingCost: numberValue(row.shipping_cost),
      discount: numberValue(row.discount),
      lineRevenue,
      lineCost,
      lineProfit,
      marginPercent: row.margin_percent !== null && row.margin_percent !== undefined ? numberValue(row.margin_percent) : 0,
      sourceLineNo: row.source_line_no
    });
  }

  return Array.from(grouped.values())
    .map((order) => ({
      ...order,
      items: order.items.sort((a, b) => numberValue(a.itemIndex) - numberValue(b.itemIndex))
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || numberValue(b.id) - numberValue(a.id));
}

async function getDashboardOrders() {
  const select = ORDER_COLUMNS.join(",");
  const order = "date.desc,order_id.desc,item_index.asc";
  const rows = await supabaseRequest(`dashboard_orders?select=${select}&order=${order}`);
  return groupDashboardRows(rows);
}

module.exports = {
  getDashboardOrders,
  groupDashboardRows
};
