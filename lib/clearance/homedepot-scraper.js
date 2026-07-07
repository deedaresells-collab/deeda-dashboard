const SEARCH_MODEL_QUERY = `
query searchModel(
  $storeId: String,
  $startIndex: Int,
  $pageSize: Int,
  $orderBy: ProductSort,
  $filter: ProductFilter,
  $isBrandPricingPolicyCompliant: Boolean,
  $keyword: String,
  $navParam: String,
  $storefilter: StoreFilter = ALL,
  $channel: Channel = DESKTOP,
  $additionalSearchParams: AdditionalParams
) {
  searchModel(
    keyword: $keyword,
    navParam: $navParam,
    storefilter: $storefilter,
    isBrandPricingPolicyCompliant: $isBrandPricingPolicyCompliant,
    storeId: $storeId,
    channel: $channel,
    additionalSearchParams: $additionalSearchParams
  ) {
    products(startIndex: $startIndex, pageSize: $pageSize, orderBy: $orderBy, filter: $filter) {
      itemId
      identifiers {
        brandName
        productLabel
        canonicalUrl
        storeSkuNumber
      }
      pricing(storeId: $storeId, isBrandPricingPolicyCompliant: $isBrandPricingPolicyCompliant) {
        value
        original
      }
      fulfillment(storeId: $storeId, isBrandPricingPolicyCompliant: $isBrandPricingPolicyCompliant) {
        fulfillmentOptions {
          type
          services {
            locations {
              inventory {
                quantity
                isInStock
              }
            }
          }
        }
      }
      media {
        images {
          url
        }
      }
    }
  }
}`;

const PRODUCT_QUERY = `
query productClientOnlyProduct($itemId: String!, $storeId: String, $isBrandPricingPolicyCompliant: Boolean) {
  product(itemId: $itemId) {
    itemId
    identifiers {
      brandName
      productLabel
      canonicalUrl
    }
    pricing(storeId: $storeId, isBrandPricingPolicyCompliant: $isBrandPricingPolicyCompliant) {
      value
      original
    }
    fulfillment(storeId: $storeId, isBrandPricingPolicyCompliant: $isBrandPricingPolicyCompliant) {
      fulfillmentOptions {
        type
        services {
          locations {
            inventory {
              quantity
              isInStock
            }
          }
        }
      }
    }
    media {
      images {
        url
      }
    }
  }
}`;

const ENDPOINT = "https://apionline.homedepot.com/federation-gateway/graphql";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseHeaders(cookie) {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://www.homedepot.com",
    Referer: "https://www.homedepot.com/",
    "User-Agent":
      process.env.HD_USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "x-experience-name": "general-merchandise",
    "x-hd-dc": "origin",
    ...(cookie ? { Cookie: cookie } : {})
  };
}

async function warmSession() {
  try {
    const res = await fetch("https://www.homedepot.com/", {
      headers: {
        "User-Agent": baseHeaders().User-Agent,
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    });
    const cookies = res.headers.getSetCookie?.() || [];
    return cookies.map((c) => c.split(";")[0]).join("; ");
  } catch {
    return process.env.HD_SESSION_COOKIE || "";
  }
}

function extractStock(product) {
  const options = product?.fulfillment?.fulfillmentOptions || [];
  for (const opt of options) {
    for (const svc of opt.services || []) {
      for (const loc of svc.locations || []) {
        const qty = loc?.inventory?.quantity;
        if (qty != null) return Number(qty);
        if (loc?.inventory?.isInStock) return 1;
      }
    }
  }
  return null;
}

function mapProduct(product, store, category) {
  const price = product?.pricing?.value;
  const was = product?.pricing?.original;
  const url = product?.identifiers?.canonicalUrl;
  return {
    retailer: "homedepot",
    storeId: store.storeId,
    storeCity: store.city,
    sku: String(product.itemId || ""),
    title: product?.identifiers?.productLabel || "Unknown",
    brand: product?.identifiers?.brandName || "",
    price,
    wasPrice: was,
    stockQty: extractStock(product),
    imageUrl: product?.media?.images?.[0]?.url || "",
    productUrl: url ? (url.startsWith("http") ? url : `https://www.homedepot.com${url}`) : "",
    category: category || ""
  };
}

async function graphqlRequest(payload, cookie) {
  const op = payload.operationName || "searchModel";
  const res = await fetch(`${ENDPOINT}?opname=${op}`, {
    method: "POST",
    headers: baseHeaders(cookie),
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Home Depot API invalid JSON (${res.status})`);
  }
  if (!res.ok || json.error?.length) {
    const msg = json.error?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`Home Depot API: ${msg}`);
  }
  return json.data;
}

async function searchStore(store, { keyword, navParam, pageSize = 48, maxPages = 2, delayMs = 800, cookie }) {
  const products = [];
  for (let page = 0; page < maxPages; page += 1) {
    const data = await graphqlRequest(
      {
        operationName: "searchModel",
        variables: {
          keyword: keyword || "",
          navParam: navParam || undefined,
          storeId: store.storeId,
          channel: "DESKTOP",
          storefilter: "ALL",
          startIndex: page * pageSize,
          pageSize,
          isBrandPricingPolicyCompliant: true
        },
        query: SEARCH_MODEL_QUERY
      },
      cookie
    );
    const batch = data?.searchModel?.products || [];
    if (!batch.length) break;
    for (const p of batch) {
      products.push(mapProduct(p, store, keyword || navParam || "clearance"));
    }
    if (batch.length < pageSize) break;
    await sleep(delayMs);
  }
  return products;
}

async function scanHomeDepotStore(store, config) {
  const { CLEARANCE_KEYWORDS, HD_CLEARANCE_NAV_PARAMS } = require("./wv-stores");
  const cookie = config.cookie || (await warmSession());
  const envCookie = process.env.HD_SESSION_COOKIE;
  const sessionCookie = envCookie || cookie;
  const all = [];
  const seen = new Set();

  for (const navParam of HD_CLEARANCE_NAV_PARAMS) {
    try {
      const batch = await searchStore(store, { navParam, cookie: sessionCookie, maxPages: config.maxPages || 2, delayMs: config.delayMs || 600 });
      for (const p of batch) {
        if (!seen.has(p.sku)) {
          seen.add(p.sku);
          all.push(p);
        }
      }
      await sleep(config.delayMs || 600);
    } catch (err) {
      config.onError?.(`HD ${store.city} nav ${navParam}: ${err.message}`);
    }
  }

  for (const keyword of CLEARANCE_KEYWORDS.slice(0, config.maxKeywords || 8)) {
    try {
      const batch = await searchStore(store, { keyword, cookie: sessionCookie, maxPages: 1, delayMs: config.delayMs || 600 });
      for (const p of batch) {
        if (!seen.has(p.sku)) {
          seen.add(p.sku);
          all.push(p);
        }
      }
      await sleep(config.delayMs || 600);
    } catch (err) {
      config.onError?.(`HD ${store.city} kw "${keyword}": ${err.message}`);
    }
  }

  return all;
}

async function scanAllHomeDepot(stores, config = {}) {
  const results = [];
  for (const store of stores) {
    try {
      const batch = await scanHomeDepotStore(store, config);
      results.push(...batch);
    } catch (err) {
      config.onError?.(`HD store ${store.city}: ${err.message}`);
    }
  }
  return results;
}

module.exports = {
  graphqlRequest,
  mapProduct,
  scanAllHomeDepot,
  scanHomeDepotStore,
  warmSession
};
