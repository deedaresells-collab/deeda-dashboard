(function () {
  const CATEGORIES = window.DEEDA_SEED.categories;
  const STATUS_OPTIONS = [
    "New Order",
    "Paid",
    "Submitted",
    "Ordered",
    "Waiting to Ship",
    "Shipped",
    "Delivered",
    "Completed",
    "Issue / Refund"
  ];
  const STORAGE_KEY = "deeda.phase1.orders.v2";
  const PRODUCT_STORAGE_KEY = "deeda.storefront.products.v1";
  const PRODUCT_STATUSES = ["Draft", "Active", "Hidden"];
  const expanded = new Set();
  let orders = loadOrders();
  let products = loadProducts();
  let activeView = "Dashboard";
  let analyticsMode = "Monthly";
  let analyticsFilter = "This month";
  let customStart = "";
  let customEnd = "";
  let storeCategory = "All";

  const app = document.getElementById("app");

  function money(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function orderTotals(order) {
    return order.items.reduce(
      (totals, item) => {
        const { revenue, cost } = itemAmounts(item);
        totals.revenue += revenue;
        totals.cost += cost;
        totals.profit += revenue - cost;
        totals.qty += Number(item.quantity || 1);
        return totals;
      },
      { revenue: 0, cost: 0, profit: 0, qty: 0 }
    );
  }

  function itemAmounts(item) {
    const qty = Number(item.quantity || 1);
    const revenue = item.lineRevenue != null ? Number(item.lineRevenue || 0) : Number(item.salePrice || 0) * qty;
    const cost = item.lineCost != null ? Number(item.lineCost || 0) : Number(item.productCost || 0) * qty + Number(item.shippingCost || 0);
    return { qty, revenue, cost, profit: revenue - cost };
  }

  function margin(revenue, profit) {
    return revenue > 0 ? (profit / revenue) * 100 : 0;
  }

  function daysOld(date) {
    const start = new Date(`${date}T00:00:00`);
    return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
  }

  function loadOrders() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    return window.DEEDA_SEED.orders;
  }

  function saveOrders() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orders)
    }).catch(() => {});
  }

  async function hydrateOrdersFromServer() {
    try {
      let response = await fetch("/api/orders", { cache: "no-store" });
      if (!response.ok) response = await fetch("/data/orders.json", { cache: "no-store" });
      const serverOrders = await response.json();
      if (Array.isArray(serverOrders) && serverOrders.length) {
        orders = serverOrders;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
        render();
      }
    } catch {
      // Local-only fallback stays available when the server API is not running.
    }
  }

  function loadProducts() {
    const saved = localStorage.getItem(PRODUCT_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    return [];
  }

  function saveProducts() {
    localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(products));
    fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(products)
    }).catch(() => {});
  }

  async function hydrateProductsFromServer() {
    try {
      let response = await fetch("/api/products", { cache: "no-store" });
      if (!response.ok) response = await fetch("/data/products.json", { cache: "no-store" });
      const serverProducts = await response.json();
      if (Array.isArray(serverProducts)) {
        products = serverProducts;
        localStorage.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(products));
        render();
      }
    } catch {
      // Products still work locally if the server API is not running.
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function newId(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function retailRound(value) {
    const price = Math.ceil(Number(value || 0));
    const cleanPrices = [65, 75, 85, 95, 120, 150, 175, 200, 225, 250, 275, 300, 350, 400, 450, 500, 600, 750, 900, 1000];
    return cleanPrices.find((clean) => clean >= price) || Math.ceil(price / 25) * 25;
  }

  function productPricing(product) {
    const supplierCost = Number(product?.supplierCost || 0);
    const additionalCost = Number(product?.additionalCost ?? 47);
    const totalCost = supplierCost + additionalCost;
    const rawSellingPrice = totalCost / 0.5;
    const sellingPrice = retailRound(rawSellingPrice);
    const expectedProfit = sellingPrice - totalCost;
    return {
      supplierCost,
      additionalCost,
      totalCost,
      sellingPrice,
      expectedProfit,
      marginPct: sellingPrice > 0 ? (expectedProfit / sellingPrice) * 100 : 0
    };
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

  function canonicalProduct(name) {
    const clean = normalize(name);
    if (clean.includes("chrome heart") && clean.includes("long sleeve")) return "Chrome Heart Long Sleeve";
    if (clean.includes("g shock") || clean.includes("gshock")) return "G-Shock Watch";
    if (clean.includes("amiri") && (clean.includes("jean") || clean.includes("denim"))) return "Amiri Jeans";
    if (clean.includes("metallic") && clean.includes("5")) return "Metallic 5s";
    return titleCase(clean || "Unknown Product");
  }

  function titleCase(text) {
    return String(text)
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function guessCategory(productName) {
    const name = normalize(productName);
    const rules = [
      ["Shoes", ["shoe", "jordan", "nike", "balenciaga", "vans", "yeezy", "dunk", "metallic", "travis", "rick owen"]],
      ["Hoodies", ["hoodie", "hooded", "zip up"]],
      ["Longsleeves", ["long sleeve", "longsleeve", "ls"]],
      ["Shirts", ["shirt", "tee", "t shirt", "god speed", "hellstar"]],
      ["Jeans", ["jean", "denim", "amiri"]],
      ["Pants", ["pant", "sweatpant", "trouser"]],
      ["Shorts", ["short"]],
      ["Socks", ["sock"]],
      ["Jackets", ["jacket", "coat", "puffer"]],
      ["SET", ["set", "tracksuit", "alo"]],
      ["Watches", ["watch", "rolex", "g shock", "gshock", "cartier"]],
      ["Glasses", ["glasses", "sunglasses", "frames"]],
      ["Bags", ["bag", "goyard", "diaper", "tote", "backpack"]],
      ["Belt", ["belt"]],
      ["Jewelry", ["chain", "bracelet", "necklace", "ring", "jewelry"]],
      ["Membership", ["membership", "mentorship"]]
    ];
    const match = rules.find(([, words]) => words.some((word) => name.includes(word)));
    return match ? match[0] : "Other";
  }

  function monthlyKey(date) {
    return date.slice(0, 7);
  }

  function thisMonthKey() {
    return new Date().toISOString().slice(0, 7);
  }

  function previousMonthKey() {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date.toISOString().slice(0, 7);
  }

  function getAnalytics() {
    const all = orders.map((order) => ({ order, totals: orderTotals(order) }));
    const thisMonth = all.filter(({ order }) => monthlyKey(order.date) === thisMonthKey());
    const previousMonth = all.filter(({ order }) => monthlyKey(order.date) === previousMonthKey());
    const activeOrders = all.filter(({ order }) => !["Completed", "Delivered", "Issue / Refund"].includes(order.status));
    const notShipped = all.filter(({ order }) => ["Submitted", "Ordered", "Waiting to Ship"].includes(order.status));

    return {
      all,
      thisMonth,
      previousMonth,
      activeOrders,
      notShipped,
      monthTotals: sumRows(thisMonth),
      previousTotals: sumRows(previousMonth),
      allTotals: sumRows(all)
    };
  }

  function sumRows(rows) {
    return rows.reduce(
      (sum, row) => {
        sum.revenue += row.totals.revenue;
        sum.cost += row.totals.cost;
        sum.profit += row.totals.profit;
        sum.orders += 1;
        sum.qty += row.totals.qty;
        return sum;
      },
      { revenue: 0, cost: 0, profit: 0, orders: 0, qty: 0 }
    );
  }

  function groupedByMonth() {
    const months = {};
    orders.forEach((order) => {
      const key = monthlyKey(order.date);
      months[key] ||= [];
      months[key].push({ order, totals: orderTotals(order) });
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => ({ key, ...sumRows(rows), rows }));
  }

  function parseLocalDate(dateText) {
    return new Date(`${dateText}T00:00:00`);
  }

  function formatDateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function currentMonthRange() {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0)
    };
  }

  function analyticsRange() {
    const now = new Date();
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (analyticsFilter === "Today") return { start: todayDate, end: todayDate };
    if (analyticsFilter === "Last 7 days") {
      const start = new Date(todayDate);
      start.setDate(start.getDate() - 6);
      return { start, end: todayDate };
    }
    if (analyticsFilter === "Last 30 days") {
      const start = new Date(todayDate);
      start.setDate(start.getDate() - 29);
      return { start, end: todayDate };
    }
    if (analyticsFilter === "Custom") {
      return {
        start: customStart ? parseLocalDate(customStart) : new Date(2025, 0, 1),
        end: customEnd ? parseLocalDate(customEnd) : todayDate
      };
    }
    return currentMonthRange();
  }

  function ordersInRange(range = analyticsRange()) {
    return orders.filter((order) => {
      const date = parseLocalDate(order.date);
      return date >= range.start && date <= range.end;
    });
  }

  function weekOfMonthLabel(dateText) {
    const date = parseLocalDate(dateText);
    const week = Math.min(5, Math.ceil(date.getDate() / 7));
    return `${date.toLocaleString("en-US", { month: "short" })} Week ${week}`;
  }

  function groupOrdersByPeriod(period, sourceOrders = ordersInRange()) {
    const groups = {};
    sourceOrders.forEach((order) => {
      const date = parseLocalDate(order.date);
      let key = order.date;
      let label = order.date;
      if (period === "Weekly") {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-W${Math.ceil(date.getDate() / 7)}`;
        label = weekOfMonthLabel(order.date);
      }
      if (period === "Monthly") {
        key = order.date.slice(0, 7);
        label = date.toLocaleString("en-US", { month: "short", year: "numeric" });
      }
      groups[key] ||= { key, label, orders: [], revenue: 0, cost: 0, profit: 0, orderCount: 0, units: 0 };
      const totals = orderTotals(order);
      groups[key].orders.push(order);
      groups[key].revenue += totals.revenue;
      groups[key].cost += totals.cost;
      groups[key].profit += totals.profit;
      groups[key].orderCount += 1;
      groups[key].units += totals.qty;
    });
    return Object.values(groups).sort((a, b) => a.key.localeCompare(b.key));
  }

  function productStatsForOrders(sourceOrders) {
    const map = {};
    sourceOrders.forEach((order) => {
      order.items.forEach((item) => {
        const name = canonicalProduct(item.productName);
        const { qty, revenue, cost } = itemAmounts(item);
        map[name] ||= { name, units: 0, revenue: 0, cost: 0, profit: 0 };
        map[name].units += qty;
        map[name].revenue += revenue;
        map[name].cost += cost;
        map[name].profit += revenue - cost;
      });
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }

  function categoryStatsForOrders(sourceOrders) {
    const map = {};
    sourceOrders.forEach((order) => {
      order.items.forEach((item) => {
        const name = item.category || guessCategory(item.productName);
        const { qty, revenue, cost } = itemAmounts(item);
        map[name] ||= { name, units: 0, revenue: 0, cost: 0, profit: 0 };
        map[name].units += qty;
        map[name].revenue += revenue;
        map[name].cost += cost;
        map[name].profit += revenue - cost;
      });
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }

  function productPerformanceRows(sourceOrders = ordersInRange()) {
    const rows = [];
    groupOrdersByPeriod("Monthly", sourceOrders).forEach((month) => {
      productStatsForOrders(month.orders)
        .slice(0, 5)
        .forEach((product) => rows.push({ ...product, month: month.label }));
    });
    return rows.sort((a, b) => b.profit - a.profit);
  }

  function profitDrivers() {
    const thisMonthOrders = orders.filter((order) => monthlyKey(order.date) === thisMonthKey());
    const previousOrders = orders.filter((order) => monthlyKey(order.date) === previousMonthKey());
    const currentProducts = productStatsForOrders(thisMonthOrders);
    const previousProducts = productStatsForOrders(previousOrders);
    const previousMap = Object.fromEntries(previousProducts.map((product) => [product.name, product.profit]));
    const totalProfit = currentProducts.reduce((sum, product) => sum + product.profit, 0);
    return currentProducts.slice(0, 3).map((product) => ({
      ...product,
      contribution: totalProfit > 0 ? (product.profit / totalProfit) * 100 : 0,
      trend: product.profit >= (previousMap[product.name] || 0) ? "up" : "down"
    }));
  }

  function topProducts(filterMonth) {
    const map = {};
    orders
      .filter((order) => !filterMonth || monthlyKey(order.date) === filterMonth)
      .forEach((order) => {
        order.items.forEach((item) => {
          const key = canonicalProduct(item.productName);
          const { qty, revenue, cost } = itemAmounts(item);
          map[key] ||= { name: key, qty: 0, revenue: 0, cost: 0, profit: 0 };
          map[key].qty += qty;
          map[key].revenue += revenue;
          map[key].cost += cost;
          map[key].profit += revenue - cost;
        });
      });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }

  function topCategories(filterMonth) {
    const map = {};
    orders
      .filter((order) => !filterMonth || monthlyKey(order.date) === filterMonth)
      .forEach((order) => {
        order.items.forEach((item) => {
          const category = item.category || guessCategory(item.productName);
          const { qty, revenue, cost } = itemAmounts(item);
          map[category] ||= { name: category, qty: 0, revenue: 0, profit: 0 };
          map[category].qty += qty;
          map[category].revenue += revenue;
          map[category].profit += revenue - cost;
        });
      });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }

  function topCustomers(filterMonth) {
    const map = {};
    orders
      .filter((order) => !filterMonth || monthlyKey(order.date) === filterMonth)
      .forEach((order) => {
        const totals = orderTotals(order);
        map[order.customerName] ||= { name: order.customerName, orders: 0, revenue: 0, profit: 0 };
        map[order.customerName].orders += 1;
        map[order.customerName].revenue += totals.revenue;
        map[order.customerName].profit += totals.profit;
      });
    return Object.values(map).sort((a, b) => b.profit - a.profit);
  }

  function buildAlerts() {
    const alerts = [];
    orders.forEach((order) => {
      const totals = orderTotals(order);
      const activeShippingStatus = ["Submitted", "Ordered", "Waiting to Ship"].includes(order.status);
      const completedStatus = ["Shipped", "Delivered", "Completed", "Issue / Refund"].includes(order.status);
      if (activeShippingStatus && daysOld(order.date) > 3) {
        alerts.push({ type: "warning", title: `Order #${order.id} needs tracking`, detail: `${order.customerName} has been ${order.status.toLowerCase()} for ${daysOld(order.date)} days.` });
      }
      if (!completedStatus && !order.trackingNumber) {
        alerts.push({ type: "warning", title: `Order #${order.id} missing tracking`, detail: `${order.customerName} has no tracking number yet.` });
      }
      if (String(order.notes || "").toLowerCase().includes("urgent")) {
        alerts.push({ type: "danger", title: `Urgent note on #${order.id}`, detail: order.notes });
      }
      if (margin(totals.revenue, totals.profit) < 35 && totals.revenue > 0) {
        alerts.push({ type: "danger", title: `Low margin on #${order.id}`, detail: `${money(totals.profit)} profit at ${margin(totals.revenue, totals.profit).toFixed(1)}%.` });
      }
    });

    topProducts(thisMonthKey())
      .filter((product) => product.qty >= 2)
      .slice(0, 2)
      .forEach((product) => {
        alerts.push({ type: "success", title: `Reorder signal: ${product.name}`, detail: `${product.qty} sold this month with ${money(product.profit)} profit.` });
      });

    return alerts;
  }

  function render() {
    if (window.location.pathname.startsWith("/store")) {
      renderStorefront();
      return;
    }

    app.innerHTML = `
      <div class="app-shell">
        ${sidebarMarkup("sidebar")}
        <main class="main">
          <div class="topbar">
            <div class="mobile-brand"><img src="/assets/deeda-logo.png" alt="Deeda Resells" /><span>Deeda</span></div>
            <div class="search"><span>⌕</span><input id="globalSearch" placeholder="Search customers, products, orders" /></div>
            <div class="top-actions">
              <button class="ghost-btn" id="importCsvBtn">Import CSV</button>
              <button class="primary-btn" id="newOrderBtn">+ New Order</button>
            </div>
          </div>
          <section id="view"></section>
        </main>
        ${sidebarMarkup("mobile-nav")}
      </div>
      <div class="drawer-backdrop" id="drawerBackdrop"></div>
      <aside class="drawer" id="drawer"></aside>
      <input class="hidden" type="file" id="csvInput" accept=".csv,text/csv" />
    `;
    bindShell();
    renderView();
  }

  function sidebarMarkup(className) {
    const nav = className === "mobile-nav"
      ? ["Dashboard", "Orders", "Products", "Analytics", "Alerts"]
      : ["Dashboard", "Orders", "Products", "Customers", "Analytics", "Alerts", "Settings"];
    const icons = {
      Dashboard: icon("dashboard"),
      Orders: icon("orders"),
      Products: icon("products"),
      Customers: icon("customers"),
      Analytics: icon("analytics"),
      Alerts: icon("alerts"),
      Settings: icon("settings")
    };
    return `
      <aside class="${className}">
        ${className === "sidebar" ? `<div class="brand"><div class="brand-mark"><img src="/assets/deeda-logo.png" alt="Deeda Resells" /></div><div><div class="brand-name">Deeda</div><div class="brand-sub">Resells command center</div></div></div><div class="nav-label">Main Menu</div>` : ""}
        ${nav
          .map(
            (item) => `
              <button class="nav-item ${activeView === item ? "active" : ""}" data-view="${item}" title="${item}">
                <span class="nav-icon">${icons[item]}</span><span>${item}</span>
              </button>`
          )
          .join("")}
      </aside>
    `;
  }

  function icon(name) {
    const attrs = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
    const paths = {
      dashboard: `<path d="M4 13h6V4H4v9Z"/><path d="M14 20h6V4h-6v16Z"/><path d="M4 20h6v-3H4v3Z"/>`,
      orders: `<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>`,
      products: `<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>`,
      customers: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
      analytics: `<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-7"/>`,
      alerts: `<path d="M10.3 21h3.4"/><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>`,
      settings: `<path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.6 19a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06A2 2 0 1 1 7.43 3.8l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15.4 5a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.36.5.67.86.88.34.2.72.3 1.1.3H21a2 2 0 1 1 0 4h-.1A1.7 1.7 0 0 0 19.4 15Z"/>`
    };
    return `<svg ${attrs}>${paths[name]}</svg>`;
  }

  function bindShell() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        activeView = button.dataset.view;
        render();
      });
    });
    document.getElementById("newOrderBtn").addEventListener("click", () => openOrderDrawer());
    document.getElementById("importCsvBtn").addEventListener("click", () => document.getElementById("csvInput").click());
    document.getElementById("csvInput").addEventListener("change", handleCsvImport);
    document.getElementById("drawerBackdrop").addEventListener("click", closeDrawer);
  }

  function renderView() {
    if (activeView === "Orders") return renderOrders();
    if (activeView === "Analytics") return renderAnalytics();
    if (activeView === "Alerts") return renderAlertsPage();
    if (activeView === "Products") return renderProductsPage();
    if (activeView === "Customers") return renderCustomersPage();
    if (activeView === "Settings") return renderSettingsPage();
    return renderDashboard();
  }

  function renderDashboard() {
    const a = getAnalytics();
    document.getElementById("view").innerHTML = `
      <div class="dashboard-studio">
        <section class="welcome-card">
          <div>
            <div class="welcome-kicker">Deeda Resells</div>
            <h1>Hello David!</h1>
            <p>Monthly profit is ${money(a.monthTotals.profit)} with ${a.monthTotals.orders} orders tracked. Keep pushing high-margin products and update tracking fast.</p>
          </div>
          <div class="hero-illustration" aria-hidden="true">
            <div class="laptop"></div>
            <div class="person-head"></div>
            <div class="person-body"></div>
          </div>
        </section>

        <div class="grid metric-grid soft-metrics">
          ${metricCard("Monthly Revenue", money(a.monthTotals.revenue), `${a.monthTotals.orders} orders`, true)}
          ${metricCard("Monthly Profit", money(a.monthTotals.profit), `${margin(a.monthTotals.revenue, a.monthTotals.profit).toFixed(1)}% margin`)}
          ${metricCard("Active Orders", a.activeOrders.length, "Need movement")}
          ${metricCard("Not Shipped", a.notShipped.length, "Submitted / ordered / waiting")}
        </div>

        <div class="grid dashboard-grid" style="margin-top:18px">
          <div class="grid">
            ${profitByCategoryCard(topCategories(thisMonthKey()))}
            ${ordersTableMarkup(orders.slice(0, 8), "Recent Grouped Orders")}
          </div>
          <div class="dashboard-side">
            ${timePanelMarkup()}
            ${alertsMarkup("Agent Alerts", buildAlerts().slice(0, 4))}
            ${attentionMarkup(a.notShipped.map(({ order }) => order).slice(0, 4))}
          </div>
        </div>

        <div class="grid three-grid" style="margin-top:18px">
          ${rankCard("Top Selling Products", topProducts(thisMonthKey()).slice(0, 6))}
          ${rankCard("Top Categories", topCategories(thisMonthKey()).slice(0, 6))}
          ${rankCard("Best Customers", topCustomers(thisMonthKey()).slice(0, 6), "customers")}
        </div>
      </div>
    `;
    bindOrderTable();
  }

  function metricCard(label, value, note, glow) {
    return `<section class="card ${glow ? "glow" : ""}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></section>`;
  }

  function alertsMarkup(title, alerts) {
    return `
      <section class="card">
        <div class="panel-head"><div><div class="section-label">${title}</div><h2>Action Queue</h2></div></div>
        <div class="alert-list">
          ${alerts.length ? alerts.map((alert) => `<div class="alert-item"><span class="status-pill ${alert.type}">${alert.type}</span><strong>${alert.title}</strong><span class="muted">${alert.detail}</span></div>`).join("") : `<div class="empty-state">No alerts right now.</div>`}
        </div>
      </section>`;
  }

  function timePanelMarkup() {
    const now = new Date();
    return `
      <section class="time-panel">
        <span>${now.toLocaleDateString("en-US", { weekday: "long", day: "numeric" })}</span>
        <strong>${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</strong>
      </section>`;
  }

  function attentionMarkup(rows) {
    return `
      <section class="card">
        <div class="section-label">Orders Needing Attention</div>
        <div class="attention-list" style="margin-top:12px">
          ${rows.length ? rows.map((order) => `<div class="alert-item"><strong>#${order.id} · ${order.customerName}</strong><span class="muted">${order.status} · ${daysOld(order.date)} days old</span><span class="blue">${money(orderTotals(order).profit)} profit</span></div>`).join("") : `<div class="empty-state">Nothing waiting to ship.</div>`}
        </div>
      </section>`;
  }

  function rankCard(title, rows, type) {
    return `
      <section class="card">
        <div class="section-label">${title}</div>
        <div class="rank-list" style="margin-top:12px">
          ${rows.length ? rows.map((row, index) => `<div class="rank-item"><strong>${index + 1}. ${row.name}</strong><span class="muted">${row.qty || row.orders || 0} ${type === "customers" ? "orders" : "sold"} · ${money(row.revenue)} revenue</span><span class="blue">${money(row.profit)} profit</span></div>`).join("") : `<div class="empty-state">No data yet.</div>`}
        </div>
      </section>`;
  }

  function profitByCategoryCard(rows) {
    const categories = rows.slice(0, 6);
    const totalProfit = Math.max(categories.reduce((sum, row) => sum + Math.max(row.profit, 0), 0), 1);
    const colors = ["#9b35ff", "#8bdc43", "#51b52e", "#2d851c", "#60ff00", "#b833ff"];
    let offset = 0;
    const stops = categories.map((row, index) => {
      const portion = Math.max(row.profit, 0) / totalProfit * 100;
      const stop = `${colors[index]} ${offset}% ${offset + portion}%`;
      offset += portion;
      return stop;
    });
    const gradient = stops.length ? stops.join(", ") : "#251239 0% 100%";
    return `
      <section class="card category-profit-card">
        <div class="section-label">Profit By Category</div>
        <div class="category-profit-body">
          <div class="donut-wrap">
            <div class="donut" style="background: conic-gradient(${gradient})">
              <div class="donut-core"><span>Profit</span><strong>${money(totalProfit)}</strong></div>
            </div>
          </div>
          <div class="category-list">
            ${categories.map((row, index) => `
              <div class="category-row">
                <span class="category-dot" style="background:${colors[index]}"></span>
                <strong>${row.name}</strong>
                <span>${money(row.profit)}</span>
              </div>`).join("") || `<div class="empty-state">No category profit yet.</div>`}
          </div>
        </div>
      </section>`;
  }

  function renderOrders() {
    document.getElementById("view").innerHTML = `
      <div class="page-title">
        <div><h1>All Orders</h1><p class="muted">${orders.length} grouped orders · ${orders.reduce((sum, order) => sum + order.items.length, 0)} line items</p></div>
        <button class="primary-btn" id="pageNewOrderBtn">+ New Order</button>
      </div>
      <div class="toolbar">
        <input class="input" id="orderSearch" placeholder="Search customer, product, notes" />
        <select class="select" id="statusFilter"><option>All Status</option>${STATUS_OPTIONS.map((status) => `<option>${status}</option>`).join("")}</select>
        <select class="select" id="categoryFilter"><option>All Categories</option>${CATEGORIES.map((cat) => `<option>${cat}</option>`).join("")}</select>
      </div>
      <div id="ordersTableHost">${ordersTableMarkup(orders, "Grouped Orders")}</div>
    `;
    document.getElementById("pageNewOrderBtn").addEventListener("click", () => openOrderDrawer());
    ["orderSearch", "statusFilter", "categoryFilter"].forEach((id) => document.getElementById(id).addEventListener("input", filterOrders));
    bindOrderTable();
  }

  function filterOrders() {
    const query = normalize(document.getElementById("orderSearch").value);
    const status = document.getElementById("statusFilter").value;
    const category = document.getElementById("categoryFilter").value;
    const filtered = orders.filter((order) => {
      const text = normalize(`${order.customerName} ${order.notes} ${order.items.map((item) => item.productName).join(" ")}`);
      const statusOk = status === "All Status" || order.status === status;
      const categoryOk = category === "All Categories" || order.items.some((item) => item.category === category);
      const queryOk = !query || text.includes(query);
      return statusOk && categoryOk && queryOk;
    });
    document.getElementById("ordersTableHost").innerHTML = ordersTableMarkup(filtered, "Grouped Orders");
    bindOrderTable();
  }

  function ordersTableMarkup(rows, title) {
    return `
      <section class="card">
        <div class="table-head"><div><div class="section-label">${title}</div><h2>Orders stay grouped by order number</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th></th><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th><th>Status</th></tr></thead>
            <tbody>
              ${rows.map(orderRowMarkup).join("") || `<tr><td colspan="10" class="empty-state">No orders found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function orderRowMarkup(order) {
    const totals = orderTotals(order);
    const isOpen = expanded.has(order.id);
    return `
      <tr>
        <td><button class="row-btn" data-expand="${order.id}">${isOpen ? "−" : "+"}</button></td>
        <td>#${order.id}</td>
        <td>${order.date}</td>
        <td><strong>${order.customerName}</strong></td>
        <td>${order.items.length} item${order.items.length === 1 ? "" : "s"}</td>
        <td>${money(totals.revenue)}</td>
        <td class="muted">${money(totals.cost)}</td>
        <td class="${totals.profit < 0 ? "danger" : "blue"}">${money(totals.profit)}</td>
        <td>${margin(totals.revenue, totals.profit).toFixed(1)}%</td>
        <td>
          <span class="status-pill ${statusClass(order.status)}">${order.status}</span>
          <div class="row-actions">
            <button class="row-action" data-edit-order="${order.id}">Edit</button>
            <button class="row-action danger-link" data-delete-order="${order.id}">Delete</button>
          </div>
        </td>
      </tr>
      ${isOpen ? order.items.map((item) => itemRowMarkup(item)).join("") : ""}
    `;
  }

  function itemRowMarkup(item) {
    const { qty, revenue, cost, profit } = itemAmounts(item);
    return `
      <tr class="item-row">
        <td></td><td></td><td></td><td></td>
        <td><span class="item-name">${item.productName}</span><br><span>${item.category} · ${item.size || "No size"} · Qty ${qty}</span></td>
        <td>${money(revenue)}</td><td>${money(cost)}</td><td class="${profit < 0 ? "danger" : "blue"}">${money(profit)}</td><td>${margin(revenue, profit).toFixed(1)}%</td><td>Line item</td>
      </tr>`;
  }

  function statusClass(status) {
    if (["Completed", "Delivered"].includes(status)) return "success";
    if (["Issue / Refund"].includes(status)) return "danger";
    if (["Submitted", "Ordered", "Waiting to Ship"].includes(status)) return "warning";
    return "";
  }

  function bindOrderTable() {
    document.querySelectorAll("[data-expand]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.expand;
        expanded.has(id) ? expanded.delete(id) : expanded.add(id);
        renderView();
      });
    });
    document.querySelectorAll("[data-edit-order]").forEach((button) => {
      button.addEventListener("click", () => openOrderDrawer(button.dataset.editOrder));
    });
    document.querySelectorAll("[data-delete-order]").forEach((button) => {
      button.addEventListener("click", () => deleteOrder(button.dataset.deleteOrder));
    });
  }

  function deleteOrder(orderId) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;
    if (!confirm(`Delete order #${order.id} for ${order.customerName}?`)) return;
    orders = orders.filter((item) => item.id !== orderId);
    expanded.delete(orderId);
    saveOrders();
    renderView();
  }

  function renderAnalytics() {
    const range = analyticsRange();
    const sourceOrders = ordersInRange(range);
    const groups = groupOrdersByPeriod(analyticsMode, analyticsMode === "Monthly" && analyticsFilter === "This month" ? orders : sourceOrders);
    const totals = sumRows(sourceOrders.map((order) => ({ order, totals: orderTotals(order) })));
    const products = productStatsForOrders(sourceOrders);
    const categories = categoryStatsForOrders(sourceOrders);
    const productRows = productPerformanceRows(sourceOrders);
    const topGroup = groups.reduce((best, group) => (group.profit > (best?.profit ?? -Infinity) ? group : best), null);
    document.getElementById("view").innerHTML = `
      <div class="page-title">
        <div><h1>Analytics</h1><p class="muted">Daily, weekly, monthly performance from order items.</p></div>
      </div>
      <div class="analytics-controls">
        <div class="segmented">
          ${["Daily", "Weekly", "Monthly"].map((mode) => `<button class="segment ${analyticsMode === mode ? "active" : ""}" data-analytics-mode="${mode}">${mode}</button>`).join("")}
        </div>
        <div class="toolbar analytics-filterbar">
          ${["Today", "Last 7 days", "Last 30 days", "This month", "Custom"].map((filter) => `<button class="ghost-btn ${analyticsFilter === filter ? "filter-active" : ""}" data-analytics-filter="${filter}">${filter}</button>`).join("")}
          <input class="input ${analyticsFilter === "Custom" ? "" : "hidden"}" type="date" id="customStart" value="${customStart}" />
          <input class="input ${analyticsFilter === "Custom" ? "" : "hidden"}" type="date" id="customEnd" value="${customEnd}" />
        </div>
      </div>
      <div class="grid metric-grid">
        ${metricCard("Filtered Revenue", money(totals.revenue), `${totals.orders} orders`, true)}
        ${metricCard("Filtered Profit", money(totals.profit), `${margin(totals.revenue, totals.profit).toFixed(1)}% margin`)}
        ${metricCard("Filtered Cost", money(totals.cost), `${totals.qty} units sold`)}
        ${metricCard("Avg Profit / Order", money(totals.orders ? totals.profit / totals.orders : 0), topGroup ? `Best: ${topGroup.label}` : "No orders")}
      </div>
      <section class="card chart-card" style="margin-top:14px">
        <div class="chart-head">
          <div><div class="section-label">${analyticsMode} Profit Breakdown</div><h2>${analyticsMode} profit trend</h2></div>
          <span class="status-pill">${formatDateKey(range.start)} → ${formatDateKey(range.end)}</span>
        </div>
        <canvas id="analyticsChart"></canvas>
      </section>
      <div class="month-history analytics-breakdown" style="margin-top:14px">
        ${groups.map((group) => `
          <div class="month-item">
            <strong>${group.label}</strong>
            <span class="muted">${group.orderCount} orders · ${group.units} units</span>
            <span>${money(group.revenue)} revenue</span>
            <span class="muted">${money(group.cost)} cost</span>
            <span class="blue">${money(group.profit)} profit</span>
            <span class="muted">${money(group.orderCount ? group.profit / group.orderCount : 0)} avg profit/order</span>
            <span class="muted">Top product: ${productStatsForOrders(group.orders)[0]?.name || "None"}</span>
            <span class="muted">Top category: ${categoryStatsForOrders(group.orders)[0]?.name || "None"}</span>
          </div>`).join("") || `<div class="empty-state">No performance data for this filter.</div>`}
      </div>
      <div class="grid three-grid" style="margin-top:14px">
        ${rankCard("Top Products In Filter", products.slice(0, 8).map((p) => ({ name: p.name, qty: p.units, revenue: p.revenue, profit: p.profit })))}
        ${rankCard("Top Categories In Filter", categories.slice(0, 8).map((c) => ({ name: c.name, qty: c.units, revenue: c.revenue, profit: c.profit })))}
        ${impactCard()}
      </div>
      ${productPerformanceTable(productRows)}
    `;
    bindAnalyticsControls();
    drawAnalyticsChart(groups, analyticsMode === "Daily" ? "bar" : "line");
  }

  function bindAnalyticsControls() {
    document.querySelectorAll("[data-analytics-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        analyticsMode = button.dataset.analyticsMode;
        renderAnalytics();
      });
    });
    document.querySelectorAll("[data-analytics-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        analyticsFilter = button.dataset.analyticsFilter;
        renderAnalytics();
      });
    });
    const startInput = document.getElementById("customStart");
    const endInput = document.getElementById("customEnd");
    if (startInput) startInput.addEventListener("input", () => { customStart = startInput.value; renderAnalytics(); });
    if (endInput) endInput.addEventListener("input", () => { customEnd = endInput.value; renderAnalytics(); });
  }

  function impactCard() {
    const drivers = profitDrivers();
    return `
      <section class="card">
        <div class="section-label">What Pushed Profit This Month</div>
        <div class="rank-list" style="margin-top:12px">
          ${drivers.length ? drivers.map((driver) => `
            <div class="rank-item">
              <strong>${driver.name}</strong>
              <span class="muted">${driver.units} sold · ${driver.contribution.toFixed(1)}% of profit</span>
              <span class="${driver.trend === "up" ? "positive" : "danger"}">${money(driver.profit)} ${driver.trend === "up" ? "↑" : "↓"} vs last month</span>
            </div>`).join("") : `<div class="empty-state">No profit drivers yet.</div>`}
        </div>
      </section>`;
  }

  function productPerformanceTable(rows) {
    return `
      <section class="card" style="margin-top:14px">
        <div class="table-head"><div><div class="section-label">Product Performance Over Time</div><h2>Top products by month</h2></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Product Name</th><th>Units Sold</th><th>Revenue</th><th>Profit</th><th>Month</th></tr></thead>
            <tbody>
              ${rows.map((row) => `<tr><td><strong>${row.name}</strong></td><td>${row.units}</td><td>${money(row.revenue)}</td><td class="blue">${money(row.profit)}</td><td>${row.month}</td></tr>`).join("") || `<tr><td colspan="5" class="empty-state">No product performance data found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderAlertsPage() {
    document.getElementById("view").innerHTML = `<div class="page-title"><div><h1>Alerts</h1><p class="muted">Phase 1 in-dashboard agent reminders.</p></div></div>${alertsMarkup("Agent Reminders", buildAlerts())}`;
  }

  function renderProductsPage() {
    const counts = PRODUCT_STATUSES.reduce((acc, status) => {
      acc[status] = products.filter((product) => product.status === status).length;
      return acc;
    }, {});
    document.getElementById("view").innerHTML = `
      <div class="page-title">
        <div><h1>Products</h1><p class="muted">Manual importer and storefront listing controls.</p></div>
        <div class="page-actions">
          <a class="ghost-btn" href="/store">View Storefront</a>
          <button class="primary-btn" id="addProductBtn">+ Add Product</button>
        </div>
      </div>
      <div class="grid metric-grid">
        ${metricCard("Active Listings", counts.Active || 0, "Visible on storefront", true)}
        ${metricCard("Draft Listings", counts.Draft || 0, "Not public yet")}
        ${metricCard("Hidden Listings", counts.Hidden || 0, "Saved but hidden")}
        ${metricCard("Total Products", products.length, "Manual listings")}
      </div>
      <section class="card" style="margin-top:14px">
        <div class="table-head">
          <div><div class="section-label">Storefront Builder</div><h2>Product listings</h2></div>
          <button class="ghost-btn" id="addProductBtnSecondary">+ Product</button>
        </div>
        <div class="product-admin-grid">
          ${products.map(productAdminCard).join("") || `<div class="empty-state">No products yet. Add your first storefront listing.</div>`}
        </div>
      </section>
    `;
    document.getElementById("addProductBtn").addEventListener("click", () => openProductDrawer());
    document.getElementById("addProductBtnSecondary").addEventListener("click", () => openProductDrawer());
    bindProductAdmin();
  }

  function productAdminCard(product) {
    const pricing = productPricing(product);
    const image = product.imageUrls?.[0];
    return `
      <article class="product-admin-card">
        <div class="product-thumb">${image ? `<img src="${image}" alt="${escapeHtml(product.name)}" />` : `<span>DR</span>`}</div>
        <div class="product-admin-main">
          <div class="product-card-top">
            <div>
              <strong>${escapeHtml(product.name)}</strong>
              <span class="muted">${escapeHtml(product.category || "Other")} · ${escapeHtml((product.sizes || []).join(", ") || "No sizes")}</span>
            </div>
            <span class="status-pill ${product.status === "Active" ? "success" : product.status === "Hidden" ? "danger" : ""}">${product.status || "Draft"}</span>
          </div>
          <div class="product-price-row">
            <span><small>Total cost</small>${money(pricing.totalCost)}</span>
            <span><small>Suggested</small>${money(pricing.sellingPrice)}</span>
            <span><small>Profit</small>${money(pricing.expectedProfit)}</span>
            <span><small>Margin</small>${pricing.marginPct.toFixed(1)}%</span>
          </div>
          <div class="row-actions">
            <button class="row-action" data-edit-product="${product.id}">Edit</button>
            <button class="row-action" data-toggle-product="${product.id}">${product.status === "Active" ? "Hide" : "Activate"}</button>
            <button class="row-action danger-link" data-delete-product="${product.id}">Delete</button>
          </div>
        </div>
      </article>
    `;
  }

  function bindProductAdmin() {
    document.querySelectorAll("[data-edit-product]").forEach((button) => {
      button.addEventListener("click", () => openProductDrawer(button.dataset.editProduct));
    });
    document.querySelectorAll("[data-toggle-product]").forEach((button) => {
      button.addEventListener("click", () => {
        products = products.map((product) => (
          product.id === button.dataset.toggleProduct
            ? { ...product, status: product.status === "Active" ? "Hidden" : "Active", updatedAt: new Date().toISOString() }
            : product
        ));
        saveProducts();
        renderProductsPage();
      });
    });
    document.querySelectorAll("[data-delete-product]").forEach((button) => {
      button.addEventListener("click", () => deleteProduct(button.dataset.deleteProduct));
    });
  }

  function deleteProduct(productId) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    if (!confirm(`Delete ${product.name}?`)) return;
    products = products.filter((item) => item.id !== productId);
    saveProducts();
    renderProductsPage();
  }

  function openProductDrawer(productId = null) {
    const editingProduct = products.find((product) => product.id === productId);
    let currentImages = [...(editingProduct?.imageUrls || [])];
    const drawer = document.getElementById("drawer");
    drawer.innerHTML = `
      <div class="drawer-title">
        <div><div class="section-label">${editingProduct ? "Edit Product" : "Manual Importer"}</div><h2>${editingProduct ? escapeHtml(editingProduct.name) : "New Product Listing"}</h2></div>
        <button class="row-btn" id="closeDrawer">×</button>
      </div>
      <form id="productForm" class="grid" data-editing-id="${editingProduct?.id || ""}">
        <div class="form-grid">
          <label class="full">Product Name <input class="input" name="name" id="productNameField" value="${escapeHtml(editingProduct?.name || "")}" placeholder="Chrome Heart Long Sleeve" required /></label>
          <label>Category <select class="select" name="category" id="productCategoryField">${CATEGORIES.map((cat) => `<option ${cat === editingProduct?.category ? "selected" : ""}>${cat}</option>`).join("")}</select></label>
          <label>Status <select class="select" name="status">${PRODUCT_STATUSES.map((status) => `<option ${status === (editingProduct?.status || "Draft") ? "selected" : ""}>${status}</option>`).join("")}</select></label>
          <label>Supplier Cost $ <input class="input product-calc" name="supplierCost" type="number" step="0.01" value="${editingProduct?.supplierCost ?? ""}" /></label>
          <label>Shipping / Additional Cost $ <input class="input product-calc" name="additionalCost" type="number" step="0.01" value="${editingProduct?.additionalCost ?? 47}" /></label>
          <label class="full">Sizes Available <input class="input" name="sizes" value="${escapeHtml((editingProduct?.sizes || []).join(", "))}" placeholder="S, M, L, XL, 10, 11, 12" /></label>
          <label class="full">Supplier Link <input class="input" name="supplierLink" value="${escapeHtml(editingProduct?.supplierLink || "")}" placeholder="https://..." /></label>
          <label class="full">Product Images <input class="input" id="productImages" type="file" accept="image/*" multiple /></label>
          <label class="full">Notes <textarea class="textarea" name="notes" placeholder="Colorways, supplier notes, fit, etc.">${escapeHtml(editingProduct?.notes || "")}</textarea></label>
        </div>
        <div class="image-preview-grid" id="productImagePreview">${imagePreviewMarkup(currentImages)}</div>
        <div class="product-pricing-preview" id="productPricingPreview"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px"><button class="ghost-btn" type="button" id="cancelProduct">Cancel</button><button class="primary-btn" type="submit">${editingProduct ? "Update Product" : "Save Product"}</button></div>
      </form>
    `;
    document.getElementById("drawerBackdrop").classList.add("open");
    drawer.classList.add("open");

    const form = document.getElementById("productForm");
    const nameField = document.getElementById("productNameField");
    const categoryField = document.getElementById("productCategoryField");
    const preview = document.getElementById("productImagePreview");
    const updatePricing = () => updateProductPricingPreview(form);
    const refreshImages = (nextImages = currentImages) => {
      currentImages = nextImages;
      preview.innerHTML = imagePreviewMarkup(currentImages);
      bindImageRemove(preview, currentImages, refreshImages);
    };

    document.getElementById("closeDrawer").addEventListener("click", closeDrawer);
    document.getElementById("cancelProduct").addEventListener("click", closeDrawer);
    nameField.addEventListener("input", () => {
      categoryField.value = guessCategory(nameField.value);
    });
    form.querySelectorAll(".product-calc").forEach((input) => input.addEventListener("input", updatePricing));
    document.getElementById("productImages").addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);
      currentImages = currentImages.concat(await readImageFiles(files)).slice(0, 8);
      refreshImages();
    });
    refreshImages();
    form.addEventListener("submit", (event) => saveProductFromForm(event, currentImages));
    updatePricing();
  }

  function updateProductPricingPreview(form) {
    const data = new FormData(form);
    const pricing = productPricing({
      supplierCost: data.get("supplierCost"),
      additionalCost: data.get("additionalCost")
    });
    document.getElementById("productPricingPreview").innerHTML = `
      <div class="profit-strip">
        <div><div class="metric-label">Supplier Cost</div><strong>${money(pricing.supplierCost)}</strong></div>
        <div><div class="metric-label">Added Cost</div><strong>${money(pricing.additionalCost)}</strong></div>
        <div><div class="metric-label">Total Cost</div><strong>${money(pricing.totalCost)}</strong></div>
        <div><div class="metric-label">Suggested Price</div><strong class="blue">${money(pricing.sellingPrice)}</strong></div>
        <div><div class="metric-label">Profit</div><strong>${money(pricing.expectedProfit)}</strong></div>
        <div><div class="metric-label">Margin</div><strong>${pricing.marginPct.toFixed(1)}%</strong></div>
      </div>
    `;
  }

  function imagePreviewMarkup(images) {
    return images.length
      ? images.map((image, index) => `<div class="image-preview"><img src="${image}" alt="Product preview" /><button type="button" data-remove-image="${index}">×</button></div>`).join("")
      : `<div class="empty-state">Upload product photos here. First image becomes the storefront cover.</div>`;
  }

  function bindImageRemove(host, images, onChange) {
    host.querySelectorAll("[data-remove-image]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = images.filter((_, index) => index !== Number(button.dataset.removeImage));
        onChange(next);
      });
    });
  }

  function readImageFiles(files) {
    return Promise.all(files.map((file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    })));
  }

  function saveProductFromForm(event, imageUrls) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const editingId = event.currentTarget.dataset.editingId;
    const savedProduct = {
      id: editingId || newId("prod"),
      name: String(form.get("name") || "").trim(),
      category: form.get("category"),
      supplierCost: Number(form.get("supplierCost") || 0),
      additionalCost: Number(form.get("additionalCost") || 47),
      sizes: String(form.get("sizes") || "").split(",").map((size) => size.trim()).filter(Boolean),
      notes: String(form.get("notes") || "").trim(),
      supplierLink: String(form.get("supplierLink") || "").trim(),
      status: form.get("status"),
      imageUrls,
      createdAt: products.find((product) => product.id === editingId)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!savedProduct.name) return;
    if (editingId) {
      products = products.map((product) => (product.id === editingId ? savedProduct : product));
    } else {
      products.unshift(savedProduct);
    }

    saveProducts();
    closeDrawer();
    renderProductsPage();
  }

  function renderStorefront() {
    const activeProducts = products.filter((product) => product.status === "Active");
    const categories = ["All", ...Array.from(new Set(activeProducts.map((product) => product.category || "Other")))];
    const detailId = new URLSearchParams(window.location.search).get("product");
    const detailProduct = activeProducts.find((product) => product.id === detailId);
    const visibleProducts = storeCategory === "All" ? activeProducts : activeProducts.filter((product) => product.category === storeCategory);
    app.innerHTML = `
      <main class="storefront">
        <header class="store-hero">
          <nav class="store-nav">
            <a class="store-logo" href="/store"><img src="/assets/deeda-logo.png" alt="Deeda Resells" /><span>Deeda</span></a>
            <a class="ghost-btn" href="/">Admin</a>
          </nav>
          <div class="store-hero-copy">
            <div class="section-label">Deeda Resells</div>
            <h1>Available products</h1>
            <p>Browse active listings and message to order. No checkout yet.</p>
          </div>
        </header>
        <section class="store-filters">
          ${categories.map((category) => `<button class="segment ${storeCategory === category ? "active" : ""}" data-store-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}
        </section>
        <section class="store-grid">
          ${visibleProducts.map(storeProductCard).join("") || `<div class="empty-state">No active products in this category yet.</div>`}
        </section>
        ${detailProduct ? storeDetailMarkup(detailProduct) : ""}
      </main>
    `;
    bindStorefront();
  }

  function storeProductCard(product) {
    const pricing = productPricing(product);
    const image = product.imageUrls?.[0];
    return `
      <article class="store-card" data-store-product="${product.id}">
        <div class="store-card-image">${image ? `<img src="${image}" alt="${escapeHtml(product.name)}" />` : `<span>DR</span>`}</div>
        <div class="store-card-body">
          <span class="muted">${escapeHtml(product.category || "Other")}</span>
          <strong>${escapeHtml(product.name)}</strong>
          <div class="store-card-meta"><span>${money(pricing.sellingPrice)}</span><span>${escapeHtml((product.sizes || []).join(", ") || "Ask for sizes")}</span></div>
          <a class="primary-btn" href="${messageLink(product)}">Message to Order</a>
        </div>
      </article>
    `;
  }

  function bindStorefront() {
    document.querySelectorAll("[data-store-category]").forEach((button) => {
      button.addEventListener("click", () => {
        storeCategory = button.dataset.storeCategory;
        window.history.replaceState({}, "", "/store");
        renderStorefront();
      });
    });
    document.querySelectorAll("[data-store-product]").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("a")) return;
        window.history.pushState({}, "", `/store?product=${encodeURIComponent(card.dataset.storeProduct)}`);
        renderStorefront();
      });
    });
    document.querySelectorAll("[data-close-store-detail]").forEach((button) => {
      button.addEventListener("click", () => {
        window.history.pushState({}, "", "/store");
        renderStorefront();
      });
    });
  }

  function storeDetailMarkup(product) {
    const pricing = productPricing(product);
    const images = product.imageUrls?.length ? product.imageUrls : [""];
    return `
      <div class="store-detail-backdrop">
        <article class="store-detail">
          <button class="row-btn store-detail-close" data-close-store-detail>×</button>
          <div class="store-detail-media">
            ${images.map((image) => image ? `<img src="${image}" alt="${escapeHtml(product.name)}" />` : `<div class="product-thumb"><span>DR</span></div>`).join("")}
          </div>
          <div class="store-detail-info">
            <span class="status-pill success">${escapeHtml(product.category || "Other")}</span>
            <h2>${escapeHtml(product.name)}</h2>
            <p class="muted">${escapeHtml(product.notes || "Message me to confirm availability, sizing, and pickup/shipping details.")}</p>
            <div class="product-price-row">
              <span><small>Price</small>${money(pricing.sellingPrice)}</span>
              <span><small>Sizes</small>${escapeHtml((product.sizes || []).join(", ") || "Ask")}</span>
            </div>
            <a class="primary-btn" href="${messageLink(product)}">Message to Order</a>
          </div>
        </article>
      </div>
    `;
  }

  function messageLink(product) {
    const pricing = productPricing(product);
    const text = encodeURIComponent(`I want to order ${product.name} for ${money(pricing.sellingPrice)}. Sizes: ${(product.sizes || []).join(", ") || "ask"}`);
    return `sms:?&body=${text}`;
  }

  function renderCustomersPage() {
    document.getElementById("view").innerHTML = `<div class="page-title"><div><h1>Customers</h1><p class="muted">Best customers by profit.</p></div></div>${rankCard("Customer Rankings", topCustomers().slice(0, 20), "customers")}`;
  }

  function renderSettingsPage() {
    document.getElementById("view").innerHTML = `
      <div class="page-title"><div><h1>Settings</h1><p class="muted">Phase 1 local dashboard controls.</p></div></div>
      <section class="card">
        <div class="section-label">Data</div>
        <p class="muted" style="margin:10px 0 16px">Orders save in this browser right now. Import your Orders.csv to replace or add current dashboard data.</p>
        <button class="danger-btn" id="resetData">Reset demo data</button>
      </section>`;
    document.getElementById("resetData").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      orders = loadOrders();
      render();
    });
  }

  function drawPerformanceChart() {
    const canvas = document.getElementById("performanceChart");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    const width = rect.width;
    const height = rect.height;
    const pad = 34;
    const months = groupedByMonth();
    const values = months.length ? months : [{ key: thisMonthKey(), revenue: 0, profit: 0 }];
    const max = Math.max(...values.flatMap((m) => [m.revenue, m.profit]), 1);

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#13213A";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = pad + ((height - pad * 2) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }

    function points(key) {
      return values.map((month, index) => {
        const x = pad + ((width - pad * 2) / Math.max(values.length - 1, 1)) * index;
        const y = height - pad - (month[key] / max) * (height - pad * 2);
        return { x, y };
      });
    }

    drawLine(points("revenue"), "#0A84FF", true);
    drawLine(points("profit"), "#22C55E", false);

    ctx.fillStyle = "#8A94A6";
    ctx.font = "12px Inter, sans-serif";
    values.forEach((month, index) => {
      const x = pad + ((width - pad * 2) / Math.max(values.length - 1, 1)) * index;
      ctx.fillText(month.key.slice(5), x - 10, height - 8);
    });

    function drawLine(pointsToDraw, color, fill) {
      ctx.beginPath();
      pointsToDraw.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
      if (fill) {
        ctx.lineTo(pointsToDraw[pointsToDraw.length - 1].x, height - pad);
        ctx.lineTo(pointsToDraw[0].x, height - pad);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
        gradient.addColorStop(0, "rgba(10, 132, 255, 0.28)");
        gradient.addColorStop(1, "rgba(10, 132, 255, 0)");
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    }
  }

  function drawAnalyticsChart(groups, style = "line") {
    const canvas = document.getElementById("analyticsChart");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    const width = rect.width;
    const height = rect.height;
    const pad = width < 520 ? 28 : 42;
    const values = groups.length ? groups : [{ label: "No data", profit: 0, revenue: 0 }];
    const max = Math.max(...values.map((group) => Math.abs(group.profit)), 1);
    const chartWidth = width - pad * 2;
    const chartHeight = height - pad * 2;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#0b1224";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = pad + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }

    ctx.fillStyle = "#8A94A6";
    ctx.font = "12px Inter, sans-serif";

    const points = values.map((group, index) => {
      const x = pad + (chartWidth / Math.max(values.length - 1, 1)) * index;
      const y = height - pad - (Math.max(group.profit, 0) / max) * chartHeight;
      return { x, y, group };
    });

    if (style === "bar") {
      const barWidth = Math.max(14, Math.min(46, chartWidth / Math.max(values.length, 1) - 10));
      points.forEach((point) => {
        const barHeight = height - pad - point.y;
        const gradient = ctx.createLinearGradient(0, point.y, 0, height - pad);
        gradient.addColorStop(0, "#4169ff");
        gradient.addColorStop(1, "rgba(65, 105, 255, 0.16)");
        ctx.fillStyle = gradient;
        roundRect(ctx, point.x - barWidth / 2, point.y, barWidth, barHeight, 8);
        ctx.fill();
      });
    } else {
      const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
      gradient.addColorStop(0, "rgba(65, 105, 255, 0.28)");
      gradient.addColorStop(1, "rgba(65, 105, 255, 0)");
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else {
          const previous = points[index - 1];
          const mid = (previous.x + point.x) / 2;
          ctx.bezierCurveTo(mid, previous.y, mid, point.y, point.x, point.y);
        }
      });
      ctx.strokeStyle = "#4169ff";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.lineTo(points[points.length - 1].x, height - pad);
      ctx.lineTo(points[0].x, height - pad);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#7aa2ff";
        ctx.fill();
      });
    }

    values.forEach((group, index) => {
      const x = pad + (chartWidth / Math.max(values.length - 1, 1)) * index;
      const label = group.label.length > 10 ? group.label.slice(0, 10) : group.label;
      ctx.fillStyle = "#8A94A6";
      ctx.fillText(label, Math.max(4, Math.min(width - 70, x - 24)), height - 8);
    });

    function roundRect(context, x, y, w, h, r) {
      context.beginPath();
      context.moveTo(x + r, y);
      context.lineTo(x + w - r, y);
      context.quadraticCurveTo(x + w, y, x + w, y + r);
      context.lineTo(x + w, y + h);
      context.lineTo(x, y + h);
      context.lineTo(x, y + r);
      context.quadraticCurveTo(x, y, x + r, y);
      context.closePath();
    }
  }

  function fieldValue(value) {
    return String(value ?? "").replace(/"/g, "&quot;");
  }

  function openOrderDrawer(orderId = null) {
    const editingOrder = orderId ? orders.find((order) => order.id === orderId) : null;
    const drawer = document.getElementById("drawer");
    drawer.innerHTML = `
      <div class="drawer-title"><div><div class="section-label">Order Info</div><h2>${editingOrder ? `Edit Order #${editingOrder.id}` : "New Order"}</h2></div><button class="icon-btn" id="closeDrawer">×</button></div>
      <form id="orderForm" class="grid" data-editing-id="${editingOrder ? editingOrder.id : ""}">
        <div class="form-grid">
          <label>Customer Name <input class="input" name="customerName" required placeholder="Full name" value="${fieldValue(editingOrder?.customerName)}" /></label>
          <label>Date <input class="input" name="date" type="date" value="${fieldValue(editingOrder?.date || today())}" required /></label>
          <label>Contact <input class="input" name="contact" placeholder="Phone / Snapchat / IG" value="${fieldValue(editingOrder?.contact)}" /></label>
          <label>Payment <input class="input" name="payment" placeholder="Cash App / Apple Pay / Cash" value="${fieldValue(editingOrder?.payment)}" /></label>
          <label>Status <select class="select" name="status">${STATUS_OPTIONS.map((status) => `<option ${status === editingOrder?.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
          <label>Tracking Number <input class="input" name="trackingNumber" placeholder="Leave blank until shipped" value="${fieldValue(editingOrder?.trackingNumber)}" /></label>
          <label class="full">Shipping Address <input class="input" name="address" placeholder="Street address" value="${fieldValue(editingOrder?.address)}" /></label>
          <label>City <input class="input" name="city" placeholder="City" value="${fieldValue(editingOrder?.city)}" /></label>
          <label>State <input class="input" name="state" placeholder="WV" value="${fieldValue(editingOrder?.state)}" /></label>
          <label class="full">Notes <textarea class="textarea" name="notes" placeholder="Order notes">${fieldValue(editingOrder?.notes)}</textarea></label>
        </div>
        <div>
          <div class="table-head"><div><div class="section-label">Line Items</div></div><button class="ghost-btn" type="button" id="addLineItem">+ Add Item</button></div>
          <div id="lineItems"></div>
        </div>
        <div class="profit-strip">
          <div><div class="metric-label">Revenue</div><strong id="formRevenue">$0.00</strong></div>
          <div><div class="metric-label">Cost</div><strong id="formCost">$0.00</strong></div>
          <div><div class="metric-label">Profit</div><strong class="blue" id="formProfit">$0.00</strong></div>
          <div><div class="metric-label">Margin</div><strong id="formMargin">0.0%</strong></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px"><button class="ghost-btn" type="button" id="cancelOrder">Cancel</button><button class="primary-btn" type="submit">${editingOrder ? "Update Order" : "Save Order"}</button></div>
      </form>
    `;
    document.getElementById("drawerBackdrop").classList.add("open");
    drawer.classList.add("open");
    document.getElementById("closeDrawer").addEventListener("click", closeDrawer);
    document.getElementById("cancelOrder").addEventListener("click", closeDrawer);
    document.getElementById("addLineItem").addEventListener("click", () => addLineItem());
    document.getElementById("orderForm").addEventListener("submit", saveOrderFromForm);
    if (editingOrder?.items?.length) {
      editingOrder.items.forEach((item) => addLineItem(item));
    } else {
      addLineItem();
    }
  }

  function addLineItem(item = {}) {
    const host = document.getElementById("lineItems");
    const row = document.createElement("div");
    row.className = "line-item-card";
    row.innerHTML = `
      <div class="line-item-grid">
        <label>Product <input class="input product-input" name="productName" placeholder="Chrome Heart Long Sleeve" value="${item.productName || ""}" required /></label>
        <label>Category <select class="select category-select" name="category">${CATEGORIES.map((cat) => `<option ${cat === item.category ? "selected" : ""}>${cat}</option>`).join("")}</select></label>
        <label>Size <input class="input" name="size" value="${item.size || ""}" /></label>
        <label>Qty <input class="input calc-input" name="quantity" type="number" min="1" value="${item.quantity || 1}" /></label>
        <label>Sale $ <input class="input calc-input" name="salePrice" type="number" step="0.01" value="${item.salePrice || ""}" /></label>
        <label>Cost $ <input class="input calc-input" name="productCost" type="number" step="0.01" value="${item.productCost || ""}" /></label>
        <label>Ship $ <input class="input calc-input" name="shippingCost" type="number" step="0.01" value="${item.shippingCost || 0}" /></label>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="muted category-hint">Category auto-suggests as you type.</span><button class="danger-btn remove-line" type="button">Remove</button></div>
    `;
    host.appendChild(row);
    const productInput = row.querySelector(".product-input");
    const categorySelect = row.querySelector(".category-select");
    productInput.addEventListener("input", () => {
      const guess = guessCategory(productInput.value);
      categorySelect.value = guess;
      row.querySelector(".category-hint").textContent = `Suggested: ${guess}. You can override it.`;
      updateFormTotals();
    });
    row.querySelectorAll(".calc-input").forEach((input) => input.addEventListener("input", updateFormTotals));
    row.querySelector(".remove-line").addEventListener("click", () => {
      row.remove();
      updateFormTotals();
    });
    updateFormTotals();
  }

  function updateFormTotals() {
    const items = readLineItems();
    const totals = orderTotals({ items });
    document.getElementById("formRevenue").textContent = money(totals.revenue);
    document.getElementById("formCost").textContent = money(totals.cost);
    document.getElementById("formProfit").textContent = money(totals.profit);
    document.getElementById("formMargin").textContent = `${margin(totals.revenue, totals.profit).toFixed(1)}%`;
  }

  function readLineItems() {
    return Array.from(document.querySelectorAll(".line-item-card")).map((card) => ({
      productName: card.querySelector('[name="productName"]').value,
      category: card.querySelector('[name="category"]').value,
      size: card.querySelector('[name="size"]').value,
      quantity: Number(card.querySelector('[name="quantity"]').value || 1),
      salePrice: Number(card.querySelector('[name="salePrice"]').value || 0),
      productCost: Number(card.querySelector('[name="productCost"]').value || 0),
      shippingCost: Number(card.querySelector('[name="shippingCost"]').value || 0)
    }));
  }

  function saveOrderFromForm(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const editingId = event.currentTarget.dataset.editingId;
    const nextId = editingId || String(Math.max(0, ...orders.map((order) => Number(order.id) || 0)) + 1);
    const savedOrder = {
      id: nextId,
      date: form.get("date"),
      customerName: form.get("customerName"),
      contact: form.get("contact"),
      payment: form.get("payment"),
      status: form.get("status"),
      trackingNumber: form.get("trackingNumber"),
      address: form.get("address"),
      city: form.get("city"),
      state: form.get("state"),
      notes: form.get("notes"),
      items: readLineItems()
    };

    if (editingId) {
      orders = orders.map((order) => (order.id === editingId ? savedOrder : order));
    } else {
      orders.unshift(savedOrder);
    }

    saveOrders();
    closeDrawer();
    activeView = "Orders";
    render();
  }

  function closeDrawer() {
    document.getElementById("drawerBackdrop").classList.remove("open");
    document.getElementById("drawer").classList.remove("open");
  }

  function parseCsv(text) {
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

  function numberValue(value) {
    const cleaned = String(value ?? "").replace(/[$,%]/g, "").trim();
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
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

  function normalizeImportedCategory(category, productName) {
    const clean = String(category || "").trim();
    if (!clean || clean === "-" || clean.toLowerCase() === "uncategorized") return guessCategory(productName);
    if (clean.toLowerCase() === "jacket") return "Jackets";
    if (clean.toLowerCase() === "hat") return "Other";
    if (clean.toLowerCase() === "clothing") return guessCategory(productName);
    if (clean.toLowerCase() === "mentorship") return "Membership";
    return CATEGORIES.includes(clean) ? clean : guessCategory(productName);
  }

  function handleCsvImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result || ""));
      const headers = parsed.shift();
      const index = buildHeaderIndex(headers);
      const grouped = {};
      parsed.forEach((row) => {
        const id = pick(row, index, ["Order_ID", "ID", "Order ID"]);
        if (!id) return;
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
          customerName: pick(row, index, ["Customer"]),
          contact: pick(row, index, ["Contact"]),
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
          category: normalizeImportedCategory(pick(row, index, ["Category"]), productName),
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
      });
      orders = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
      saveOrders();
      activeView = "Orders";
      render();
    };
    reader.readAsText(file);
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

  window.addEventListener("resize", drawPerformanceChart);
  window.addEventListener("popstate", render);
  render();
  hydrateOrdersFromServer();
  hydrateProductsFromServer();
})();
