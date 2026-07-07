/**
 * All Home Depot and Lowe's locations in West Virginia.
 * Store IDs verified from homedepot.com store pages (July 2026).
 * Lowe's store numbers from lowes.com store locator.
 */

const HOME_DEPOT_WV = [
  { storeId: "4801", city: "Barboursville", zip: "25504", address: "1050 Thundering Herd Dr" },
  { storeId: "8433", city: "Bridgeport", zip: "26330", address: "1180 W Main St" },
  { storeId: "4802", city: "Charleston", zip: "25309", address: "100 Cross Terrace Blvd" },
  { storeId: "8429", city: "Hurricane", zip: "25526", address: "1100 Liberty Park Dr" },
  { storeId: "4805", city: "Ranson", zip: "25438", address: "230 Oak Lee Dr" },
  { storeId: "4803", city: "Vienna", zip: "26105", address: "200 Grand Central Ave" }
];

const LOWES_WV = [
  { storeId: "2955", city: "Barboursville", zip: "25504", address: "2550 N Eisenhower Dr" },
  { storeId: "0592", city: "Beckley", zip: "25801", address: "1210 N Eisenhower Dr" },
  { storeId: "1603", city: "Buckhannon", zip: "26201", address: "40 Clarksburg Rd" },
  { storeId: "0759", city: "Charleston", zip: "25304", address: "5750 Maccorkle Ave SE" },
  { storeId: "1078", city: "Clarksburg", zip: "26301", address: "494 Emily Dr" },
  { storeId: "1142", city: "Cross Lanes", zip: "25313", address: "1000 Nitro Marketplace" },
  { storeId: "2341", city: "Fayetteville", zip: "25840", address: "460 N Eisenhower Dr" },
  { storeId: "2790", city: "Lewisburg", zip: "24901", address: "20 Gateway Blvd" },
  { storeId: "1635", city: "Logan", zip: "25601", address: "Norman Morgan Blvd" },
  { storeId: "0556", city: "Martinsburg", zip: "25403", address: "800 Foxcroft Ave" },
  { storeId: "0595", city: "Morgantown", zip: "26501", address: "9595 Mall Rd" },
  { storeId: "2345", city: "Morgantown", zip: "26508", address: "901 Venture Dr" },
  { storeId: "1079", city: "Parkersburg", zip: "26101", address: "2 Walton Dr" },
  { storeId: "1634", city: "Princeton", zip: "24740", address: "1155 Oakvale Rd" },
  { storeId: "1143", city: "South Charleston", zip: "25309", address: "50 Rhl Blvd" },
  { storeId: "2791", city: "Summersville", zip: "26651", address: "5200 Webster Rd" },
  { storeId: "0594", city: "Vienna", zip: "26105", address: "1300 Grand Central Ave" },
  { storeId: "0555", city: "Wheeling", zip: "26003", address: "2801 Chapline St" }
];

/** Unique WV zip codes for Apify multi-store scans */
const WV_ZIP_CODES = [...new Set([...HOME_DEPOT_WV, ...LOWES_WV].map((s) => s.zip))].sort();

/** Clearance search keywords — broad coverage for any category */
const CLEARANCE_KEYWORDS = [
  "clearance",
  "special buy",
  "closeout",
  "discontinued",
  "paint clearance",
  "lighting clearance",
  "flooring clearance",
  "tools clearance",
  "outdoor clearance",
  "appliance clearance",
  "plumbing clearance",
  "electrical clearance",
  "hardware clearance",
  "storage clearance",
  "lumber clearance"
];

/** Home Depot clearance category navParams (Special Buy / Clearance sections) */
const HD_CLEARANCE_NAV_PARAMS = [
  "5yc1vZ1z13zbm", // Special Buys
  "5yc1vZc2bd", // Clearance
  "5yc1vZc2e4", // Special Values
  "5yc1vZc2eo", // Closeouts
  "5yc1vZcjqk", // Paint clearance
  "5yc1vZc3o9", // Lighting clearance
  "5yc1vZc8b2", // Tools clearance
  "5yc1vZc8xk", // Outdoor clearance
  "5yc1vZc7by", // Flooring clearance
  "5yc1vZc3tb" // Appliances clearance
];

module.exports = {
  CLEARANCE_KEYWORDS,
  HD_CLEARANCE_NAV_PARAMS,
  HOME_DEPOT_WV,
  LOWES_WV,
  WV_ZIP_CODES
};
