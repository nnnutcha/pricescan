import dotenv from 'dotenv';
import express from "express";
import pg from "pg";
import cors from "cors";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 3000;

const { Pool } = pg;
const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT
});

(async () => {
  try {
    const { rows } = await pool.query("SELECT 1 AS ok");
    console.log("Connected to PostgreSQL. Smoke test:", rows[0]);
  } catch (err) {
    console.error("DB connect error at startup:", err);
  }
})();

app.post("/api/login", async (req, res, next) => {
  console.log("POST /api/login body:", req.body);
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const q = `SELECT username, password FROM users WHERE username = $1 LIMIT 1`;
    const { rows } = await pool.query(q, [username]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }
    const user = rows[0];

    if (user.password !== password) {
      return res.status(401).json({ message: "Invalid password." });
    }

    return res.json({ message: "Login successful", user: { username: user.username } });
  } catch (err) {
    next(err);
  }
});

const SEARCH_API_BASE = "https://www.searchapi.io/api/v1/search";

async function fetchJSON(url, { timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

function buildUrl(params) {
  const usp = new URLSearchParams({ ...params, api_key: API_KEY });
  return `${SEARCH_API_BASE}?${usp.toString()}`;
}

function normalizeCurrency(value, currency) {
  let num = Number(value);
  if (Number.isNaN(num)) num = null;
  return { value: num, currency: currency || "USD" };
}

function normalizeDate(d) {
  if (!d || typeof d !== "string") return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? d : parsed.toISOString();
}

function normalizeResult({ platform, rawSearch, rawProduct }) {
  try {
    if (platform === "walmart") {
      const s = rawSearch?.organic_results?.[0] || rawSearch?.products?.[0] || {};
      const p = rawProduct?.product || rawProduct || {};
      const r = rawProduct?.reviews?.customer_reviews || [];

      const upc =
        p.upc ||
        (Array.isArray(p.specifications) &&
          p.specifications.find(sp => (sp?.name || "").toLowerCase() === "upc")?.value) ||
        (Array.isArray(s.specifications) &&
          s.specifications.find(sp => (sp?.name || "").toLowerCase() === "upc")?.value) ||
        null;

      return {
        platform: "walmart",
        id: p.id || s.product_id || s.id || p.product_id,
        upc,
        title: p.title || p.product_title || s.product_title || s.title,
        url: p.link || p.product_page_url || s.product_page_url || s.link,
        image:
          p.main_image ||
          (p.images && (p.images[0]?.url || p.images[0])) ||
          s.product_photo ||
          s.thumbnail,

        product_offers: Array.isArray(rawSearch?.organic_results)
          ? rawSearch.organic_results
              .map(item => ({
                id: item?.id ?? item?.product_id ?? null,
                seller_name: item?.seller_name ?? null,
                rating: typeof item?.rating === "number" ? item.rating : null,
                condition: item?.condition ?? (item?.is_preowned ? "Pre-Owned" : null),
                link: item?.link ?? null,
                extracted_price: typeof item?.extracted_price === "number" ? item.extracted_price : null,
                extracted_original_price: typeof item?.extracted_original_price === "number" ? item.extracted_original_price : null,
              }))
              .filter(offer =>
                offer.seller_name &&
                offer.link &&
                (offer.extracted_price !== null || offer.extracted_original_price !== null)
              )
              .filter((offer, index, arr) =>
                index === arr.findIndex(o =>
                  o.seller_name === offer.seller_name &&
                  o.condition === offer.condition &&
                  o.link === offer.link
                )
              )
          : [],

        reviews: r.map(review => ({
          text: review?.text ?? "",
          rating: typeof review?.rating === "number" ? review.rating : null,
          date: normalizeDate(review?.date),
          user_name: review?.user_name ?? "Anonymous",
          fullfilled_by: review?.fullfilled_by ?? "N/A",
        })),
      };
    }

    if (platform === "amazon") {
      const s = rawSearch?.organic_results?.[0] || {};
      const p = rawProduct?.product || rawProduct || {};
      const r = rawProduct?.review_results?.local || [];

      const upc =
        p.upc ||
        (Array.isArray(p.specifications) &&
          p.specifications.find(sp => (sp?.name || "").toLowerCase() === "upc")?.value) ||
        (Array.isArray(s.specifications) &&
          s.specifications.find(sp => (sp?.name || "").toLowerCase() === "upc")?.value) ||
        null;

      return {
        platform: "amazon",
        id: p.id || s.product_id || s.id || p.product_id,
        upc,
        title: p.title || p.product_title || s.product_title || s.title,
        url: p.link || p.product_page_url || s.product_page_url || s.link,
        image:
          p.main_image ||
          (p.images && (p.images[0]?.url || p.images[0])) ||
          s.product_photo ||
          s.thumbnail,

        // product_offers: Array.isArray(rawSearch?.organic_results)
        //   ? rawSearch.organic_results
        //       .map(item => ({
        //         id: item?.id ?? item?.product_id ?? null,
        //         seller_name: item?.seller_name ?? null,
        //         rating: typeof item?.rating === "number" ? item.rating : null,
        //         condition: item?.condition ?? (item?.is_preowned ? "Pre-Owned" : null),
        //         link: item?.link ?? null,
        //         extracted_price: typeof item?.extracted_price === "number" ? item.extracted_price : null,
        //         extracted_original_price: typeof item?.extracted_original_price === "number" ? item.extracted_original_price : null,
        //       }))
        //       .filter(offer =>
        //         offer.seller_name &&
        //         offer.link &&
        //         (offer.extracted_price !== null || offer.extracted_original_price !== null)
        //       )
        //       .filter((offer, index, arr) =>
        //         index === arr.findIndex(o =>
        //           o.seller_name === offer.seller_name &&
        //           o.condition === offer.condition &&
        //           o.link === offer.link
        //         )
        //       )
        //   : [],

        // reviews: r.map(review => ({
        //   text: review?.text ?? "",
        //   rating: typeof review?.rating === "number" ? review.rating : null,
        //   extracted_date: extracted_date,
        //   user_name: review?.user_name ?? "Anonymous",
        //   fullfilled_by: review?.fullfilled_by ?? "N/A",
        // })),
        reviews: Array.isArray(r)
          ? r.map(review => ({
              text: review?.text ?? "",
              rating: typeof review?.rating === "number" ? review.rating : null,
              date: normalizeDate(review?.extracted_date || review?.date),
              user_name: review?.profile?.name ?? "Anonymous",
              fullfilled_by: "Amazon",
            }))
          : [],
      };
    }

    // if (platform === "ebay") {
    //   const item = rawProduct?.item || rawSearch?.item || {};
    //   const prod = rawProduct?.product || rawSearch?.product || {};
    //   const s    = rawSearch?.organic_results?.[0] || rawSearch?.results?.[0] || {};

    //   // Prefer item.specifications, then product.specifications; then try other spots
    //   const upcRaw =
    //     (Array.isArray(item.specifications) &&
    //       item.specifications.find(sp => (sp?.name || "").trim().toLowerCase() === "upc")?.value) ||
    //     (Array.isArray(prod.specifications) &&
    //       prod.specifications.find(sp => (sp?.name || "").trim().toLowerCase() === "upc")?.value) ||
    //     prod.global_ids?.upc ||
    //     item.upc ||
    //     s.upc ||
    //     null;

    //   // normalize to digits only (removes spaces/Unicode like \u200e)
    //   const upc = upcRaw ? String(upcRaw).replace(/\D/g, "") || null : null;

    //   return {
    //     platform: "ebay",
    //     id: item.item_id || prod.product_id || s.item_id,
    //     upc, // -> "0194253397168"
    //     title: item.title || prod.title || s.title,
    //     url: rawSearch?.search_metadata?.request_url || item.item_web_url || s.link,
    //     image: item.main_image || item.images?.[0]?.link || s.thumbnail,
    //     price: normalizeCurrency(item.extracted_price ?? item.price ?? s.price_raw ?? s.price, "USD"),
    //     rating: prod.rating || s.rating,
    //     reviews_count: prod.reviews || s.reviews_count,
    //     seller: item.seller?.name || s.seller,
    //     condition: item.condition || s.condition,
    //     availability: item.stock || s.availability,
    //     raw: { search: rawSearch, product: rawProduct },
    //   };
    // }

    return { platform, error: "Unsupported platform" };
  } catch (e) {
    return { platform, error: e.message, raw: { search: rawSearch, product: rawProduct } };
  }
}

app.get("/api/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query ?q" });
    if (!API_KEY) return res.status(500).json({ error: "SEARCHAPI_API_KEY is not set" });


    // 1) Run the three SEARCH calls in parallel
    const [walmartSearch, amazonSearch, ebaySearch] = await Promise.all([
      // fetchJSON(buildUrl({ engine: "walmart_search", q })),
      fetchJSON(buildUrl({ engine: "amazon_search", q })),
      // fetchJSON(buildUrl({ engine: "ebay_search", q })),
    ]);


    // Extract IDs (defensively)
    const walmartId = walmartSearch?.organic_results?.[0]?.id;
    // || walmartSearch?.products?.[0]?.product_id
    // || null;


    const amazonAsin = amazonSearch?.organic_results?.[0]?.asin;
    // || amazonSearch?.results?.[0]?.asin
    // || null;


    const ebayItemId = ebaySearch?.organic_results?.[0]?.item_id;
    // || ebaySearch?.results?.[0]?.item_id
    // || null;


    // 2) For each found ID, hit product endpoint (skip if not found)
    const [walmartProduct, amazonProduct, ebayProduct] = await Promise.all([
      // walmartId ? fetchJSON(buildUrl({ engine: "walmart_product", product_id: walmartId })) : Promise.resolve(null),
      amazonAsin ? fetchJSON(buildUrl({ engine: "amazon_product", asin: amazonAsin })) : Promise.resolve(null),
      // ebayItemId ? fetchJSON(buildUrl({ engine: "ebay_product", item_id: ebayItemId })) : Promise.resolve(null),
    ]);


    // 3) Normalize results
    const payload = [
      // normalizeResult({ platform: "walmart", rawSearch: walmartSearch, rawProduct: walmartProduct }),
      normalizeResult({ platform: "amazon", rawSearch: amazonSearch, rawProduct: amazonProduct }),
      // normalizeResult({ platform: "ebay", rawSearch: ebaySearch, rawProduct: ebayProduct }),
    ];


    res.json({ query: q, results: payload });
  } catch (err) {
    console.error("/api/search error:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// const BASE_URL = "https://www.searchapi.io/api/v1/search";

// app.get("/api/search", async (req, res, next) => {
//   try {
//     const { query } = req.body;

//     if (!API_KEY) {
//       return res.status(500).json({ message: "Missing API_KEY env" });
//     }

//     const urlAmazon = `${BASE_URL}?engine=amazon_search&q=${encodeURIComponent(query)}&api_key=${API_KEY}`;
//     const urlWalmart = `${BASE_URL}?engine=walmart_search&q=${encodeURIComponent(query)}&api_key=${API_KEY}`;
//     const urlEbay = `${BASE_URL}?engine=ebay_search&q=${encodeURIComponent(query)}&api_key=${API_KEY}`;

//     const [amazonRes, walmartRes, ebayRes] = await Promise.all([
//       fetch(urlAmazon).then(r => {
//         if (!r.ok) throw new Error(`Amazon HTTP ${r.status}`);
//         return r.json();
//       }),
//       fetch(urlWalmart).then(r => {
//         if (!r.ok) throw new Error(`Walmart HTTP ${r.status}`);
//         return r.json();
//       }),
//       fetch(urlEbay).then(r => {
//         if (!r.ok) throw new Error(`eBay HTTP ${r.status}`);
//         return r.json();
//       }),
//     ]);

//     res.json({
//       product: query,
//       amazon: amazonRes,
//       walmart: walmartRes,
//       ebay: ebayRes,
//     });

//     const amazonAsins = (amazonRes?.organic_results || [])
//       .map((item) => item.asin)
//       .filter(Boolean);

//     const amazonItems = (amazonRes?.organic_results || []).map((it) => ({
//       asin: it.asin,
//       title: it.title,
//       price: it.price,
//       rating: it.rating,
//       reviews: it.reviews,
//       link: it.link,
//     }));

//     const walmartItems = (walmartRes?.organic_results || []).map((it) => ({
//       id: it.us_item_id || it.item_id,
//       title: it.title,
//       price: it.price,
//       rating: it.rating,
//       reviews: it.reviews,
//       link: it.link,
//       seller: it.seller,
//     }));

//     res.json({
//       product: query,
//       amazon: {
//         count: amazonItems.length,
//         asins: amazonAsins,
//         items: amazonItems,
//         raw: amazonRes, 
//       },
//       walmart: {
//         count: walmartItems.length,
//         items: walmartItems,
//         raw: walmartRes, 
//       },
//     });

//     console.log("Amazon ASINs:", amazonAsins);
//   } catch (err) {
//     console.error("search error:", err);
//     res.status(500).send(`ERROR: ${err.message}`);
//   }
// });


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
