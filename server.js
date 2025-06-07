// const express = require("express");
// const cors = require("cors");
// const { chromium } = require("playwright");

// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(cors());
// app.use(express.json());

// const PROVIDERS = [
//   "https://vidsrc.xyz",
//   "https://vidsrc.in",
//   "https://vidsrc.pm",
//   "https://vidsrc.net",
// ];

// async function scrapeProvider(domain, url) {
//   console.log(`\n[${domain}] Starting scrape for URL: ${url}`);

//   const browser = await chromium.launch({ headless: true });
//   const context = await browser.newContext({
//     userAgent:
//       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
//   });
//   const page = await context.newPage();

//   let hlsUrl = null;
//   const subtitles = [];

//   try {
//     await page.route("**/*", (route) => {
//       const reqUrl = route.request().url();

//       if (!hlsUrl && reqUrl.includes(".m3u8")) {
//         hlsUrl = reqUrl;
//         console.log(`[${domain}] Found HLS URL: ${hlsUrl}`);
//       }
//       if (reqUrl.endsWith(".vtt") || reqUrl.endsWith(".srt")) {
//         subtitles.push(reqUrl);
//         console.log(`[${domain}] Found subtitle URL: ${reqUrl}`);
//       }

//       route.continue();
//     });

//     await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
//     console.log(`[${domain}] Page loaded`);

//     const frameDiv = await page.waitForSelector("#the_frame", {
//       timeout: 10000,
//     });

//     if (frameDiv) {
//       const box = await frameDiv.boundingBox();

//       if (box) {
//         const clickX = box.x + box.width / 2;
//         const clickY = box.y + box.height / 2;
//         console.log(
//           `[${domain}] Clicking at (${clickX.toFixed(1)}, ${clickY.toFixed(1)})`
//         );

//         await page.mouse.move(clickX, clickY);
//         await page.mouse.click(clickX, clickY);
//       } else {
//         console.warn(`[${domain}] Fallback: clicking via JS`);
//         await page.evaluate(() => {
//           document.querySelector("#the_frame")?.click();
//         });
//       }

//       await page.waitForTimeout(10000);
//     } else {
//       throw new Error(`#the_frame div not found`);
//     }

//     await browser.close();

//     if (!hlsUrl) throw new Error("HLS URL not found");

//     return { hls_url: hlsUrl, subtitles, error: null };
//   } catch (error) {
//     await browser.close();
//     console.error(`[${domain}] Error: ${error.message}`);
//     return { hls_url: null, subtitles: [], error: error.message };
//   }
// }

// app.get("/extract", async (req, res) => {
//   const type = req.query.type || "movie";
//   const tmdb_id = req.query.tmdb_id;
//   const season = req.query.season ? parseInt(req.query.season) : undefined;
//   const episode = req.query.episode ? parseInt(req.query.episode) : undefined;

//   if (!tmdb_id) {
//     return res.status(400).json({
//       success: false,
//       error: "tmdb_id query param is required",
//       results: {},
//     });
//   }

//   if (type === "tv" && (season == null || episode == null)) {
//     return res.status(400).json({
//       success: false,
//       error: "season and episode query params are required for TV shows",
//       results: {},
//     });
//   }

//   const urls = PROVIDERS.reduce((acc, domain) => {
//     acc[domain] =
//       type === "tv"
//         ? `${domain}/embed/tv?tmdb=${tmdb_id}&season=${season}&episode=${episode}`
//         : `${domain}/embed/movie/${tmdb_id}`;
//     return acc;
//   }, {});

//   const resultsArr = await Promise.all(
//     Object.entries(urls).map(async ([domain, url]) => {
//       try {
//         const result = await scrapeProvider(domain, url);
//         return [domain, result];
//       } catch (err) {
//         console.error(`[${domain}] Final error: ${err.message}`);
//         return [domain, { hls_url: null, subtitles: [], error: err.message }];
//       }
//     })
//   );

//   const results = Object.fromEntries(resultsArr);
//   const success = Object.values(results).some((r) => r.hls_url);

//   res.json({ success, results });
// });

// app.listen(PORT, () => {
//   console.log(`🚀 Server running at http://localhost:${PORT}`);
// });

import express, { json } from "express";
import cors from "cors";
import { chromium } from "playwright";
import pLimit from "p-limit";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(json());

const PROVIDERS = [
  "https://vidsrc.xyz",
  "https://vidsrc.in",
  "https://vidsrc.pm",
  "https://vidsrc.net",
];

// Global browser instance, launched once
let browser;

// Simple in-memory cache to avoid scraping same query repeatedly (15 minutes)
const cache = new Map();

// Limit concurrent scraping to 2 providers at a time
const limit = pLimit(2);

async function scrapeProvider(domain, url) {
  console.log(`\n[${domain}] Starting scrape for URL: ${url}`);

  // Create new context and page for isolation per scrape
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
  const page = await context.newPage();

  let hlsUrl = null;
  const subtitles = [];

  try {
    await page.route("**/*", (route) => {
      const reqUrl = route.request().url();

      if (!hlsUrl && reqUrl.includes(".m3u8")) {
        hlsUrl = reqUrl;
        console.log(`[${domain}] Found HLS URL: ${hlsUrl}`);
      }
      if (
        reqUrl.endsWith(".vtt") ||
        reqUrl.endsWith(".srt") ||
        reqUrl.endsWith(".vtt?") || // sometimes params present
        reqUrl.includes(".vtt") || // a more relaxed check
        reqUrl.includes(".srt")
      ) {
        if (!subtitles.includes(reqUrl)) {
          subtitles.push(reqUrl);
          console.log(`[${domain}] Found subtitle URL: ${reqUrl}`);
        }
      }
      route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    console.log(`[${domain}] Page loaded`);

    const frameDiv = await page.waitForSelector("#the_frame", {
      timeout: 10000,
    });

    if (frameDiv) {
      const box = await frameDiv.boundingBox();

      if (box) {
        const clickX = box.x + box.width / 2;
        const clickY = box.y + box.height / 2;
        console.log(
          `[${domain}] Clicking at (${clickX.toFixed(1)}, ${clickY.toFixed(1)})`
        );

        await page.mouse.move(clickX, clickY);
        await page.mouse.click(clickX, clickY);
      } else {
        console.warn(`[${domain}] Fallback: clicking via JS`);
        await page.evaluate(() => {
          document.querySelector("#the_frame")?.click();
        });
      }

      // Wait for the .m3u8 request or max 5 seconds
      await page
        .waitForResponse((resp) => resp.url().includes(".m3u8"), {
          timeout: 5000,
        })
        .catch(() => {
          console.warn(`[${domain}] .m3u8 request not detected within 5s`);
        });
    } else {
      throw new Error(`#the_frame div not found`);
    }

    // Close page and context but keep browser open
    await page.close();
    await context.close();

    if (!hlsUrl) throw new Error("HLS URL not found");

    return { hls_url: hlsUrl, subtitles, error: null };
  } catch (error) {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    console.error(`[${domain}] Error: ${error.message}`);
    return { hls_url: null, subtitles: [], error: error.message };
  }
}

app.get("/extract", async (req, res) => {
  const type = req.query.type || "movie";
  const tmdb_id = req.query.tmdb_id;
  const season = req.query.season ? parseInt(req.query.season) : undefined;
  const episode = req.query.episode ? parseInt(req.query.episode) : undefined;

  if (!tmdb_id) {
    return res.status(400).json({
      success: false,
      error: "tmdb_id query param is required",
      results: {},
    });
  }

  if (type === "tv" && (season == null || episode == null)) {
    return res.status(400).json({
      success: false,
      error: "season and episode query params are required for TV shows",
      results: {},
    });
  }

  const cacheKey = JSON.stringify(req.query);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 60 * 15) {
    console.log("Serving from cache");
    return res.json(cached.response);
  }

  const urls = PROVIDERS.reduce((acc, domain) => {
    acc[domain] =
      type === "tv"
        ? `${domain}/embed/tv?tmdb=${tmdb_id}&season=${season}&episode=${episode}`
        : `${domain}/embed/movie/${tmdb_id}`;
    return acc;
  }, {});

  try {
    const resultsArr = await Promise.all(
      Object.entries(urls).map(([domain, url]) =>
        limit(async () => {
          try {
            const result = await scrapeProvider(domain, url);
            return [domain, result];
          } catch (err) {
            console.error(`[${domain}] Final error: ${err.message}`);
            return [
              domain,
              { hls_url: null, subtitles: [], error: err.message },
            ];
          }
        })
      )
    );

    const results = Object.fromEntries(resultsArr);
    const success = Object.values(results).some((r) => r.hls_url);

    const response = { success, results };

    cache.set(cacheKey, {
      timestamp: Date.now(),
      response,
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Unexpected server error",
      results: {},
    });
  }
});

// Launch browser once before server starts listening
(async () => {
  browser = await chromium.launch({ headless: true });
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
})();

// Graceful shutdown: close browser on exit
process.on("SIGINT", async () => {
  console.log("Closing browser...");
  if (browser) await browser.close();
  process.exit();
});
process.on("SIGTERM", async () => {
  console.log("Closing browser...");
  if (browser) await browser.close();
  process.exit();
});
