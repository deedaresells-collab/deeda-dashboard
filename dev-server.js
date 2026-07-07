const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "public");
const port = process.env.PORT || 4173;
const dataDir = path.join(__dirname, "data");
const productsFile = path.join(dataDir, "products.json");
const telegramAgent = require("./public/src/telegram-agent");
const { getDashboardOrders } = require("./api/_orders");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".csv": "text/csv; charset=utf-8"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.join(root, target);
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

function buildReq(req) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  return {
    method: req.method,
    query: Object.fromEntries(url.searchParams),
    headers: req.headers
  };
}

function buildRes(res) {
  return {
    status(code) {
      this._code = code;
      return this;
    },
    json(body) {
      res.writeHead(this._code || 200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    }
  };
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/products" && req.method === "GET") {
    fs.readFile(productsFile, "utf8", (error, data) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(error ? "[]" : data);
    });
    return;
  }

  if (req.url === "/api/products" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        JSON.parse(body);
        fs.mkdir(dataDir, { recursive: true }, (mkdirError) => {
          if (mkdirError) {
            res.writeHead(500);
            res.end("Could not create data folder");
            return;
          }
          fs.writeFile(productsFile, body, "utf8", (writeError) => {
            if (writeError) {
              res.writeHead(500);
              res.end("Could not save products");
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end("{\"ok\":true}");
          });
        });
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
    return;
  }

  if (req.url === "/api/orders" && req.method === "GET") {
    getDashboardOrders()
      .then((orders) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(orders));
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      });
    return;
  }

  if (req.url === "/api/orders" && req.method === "POST") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end("{\"ok\":false,\"error\":\"Orders are read from Supabase dashboard_orders.\"}");
    return;
  }

  if (req.url === "/api/telegram" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) req.destroy();
    });
    req.on("end", async () => {
      try {
        await telegramAgent.handleTelegramUpdate(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end("{\"ok\":true}");
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
    return;
  }

  if (req.url === "/api/telegram/daily" && req.method === "POST") {
    Promise.resolve()
      .then(async () => telegramAgent.sendTelegramMessage(await telegramAgent.dailySummaryMessage()))
      .then(() => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end("{\"ok\":true}");
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      });
    return;
  }

  if (req.url === "/api/deals" && req.method === "GET") {
    require("./api/deals")(buildReq(req), buildRes(res)).catch((error) => {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    });
    return;
  }

  if (req.url.startsWith("/api/scrape-clearance") && (req.method === "GET" || req.method === "POST")) {
    require("./api/scrape-clearance")(buildReq(req), buildRes(res)).catch((error) => {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    });
    return;
  }

  const filePath = safePath(req.url);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(root, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
        res.end(fallback);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Deeda dashboard running at http://localhost:${port}`);
});
