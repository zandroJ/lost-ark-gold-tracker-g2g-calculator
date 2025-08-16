// server.js
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const cron = require("node-cron");

const app = express();
app.use(cors());

let euServerData = [];
let lastScrapeTime = null;

// Scraper function
async function scrapeG2G() {
  try {
    console.log("🚀 Starting Puppeteer scrape...");

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/117.0.0.0 Safari/537.36"
    );

    await page.goto("https://www.g2g.com/categories/lost-ark-gold", {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    const html = await page.content();
    const $ = cheerio.load(html);
    const serverMap = new Map();

    $("div.offer-list-item-wrapper").each((i, element) => {
      const card = $(element);

      let server =
        card.find(".offer-seller a").first().text().trim() ||
        card.find(".text-body1.ellipsis-2-lines").first().text().trim() ||
        card.find(".text-h6").first().text().trim();

      const priceText =
        card.find(".offer-price-amount").first().text().trim() ||
        card.find(".price").first().text().trim();
      const priceMatch = priceText.match(/[\d.]+/);
      const price = priceMatch ? parseFloat(priceMatch[0]) : 0;

      const offersText =
        card.find(".offer-stock").first().text().trim() ||
        card.find(".stock").first().text().trim();
      const offersMatch = offersText.match(/\d+/);
      const offers = offersMatch ? parseInt(offersMatch[0], 10) : 0;

      if (server && /EU Central/i.test(server)) {
        server = server.replace(/\s+-\s+EU Central/i, "").trim();
        if (!serverMap.has(server) && price > 0) {
          serverMap.set(server, {
            server,
            offers,
            priceUSD: price,
            valuePer100k: (100000 * price).toFixed(6)
          });
        }
      }
    });

    await browser.close();

    euServerData = Array.from(serverMap.values()).sort(
      (a, b) => a.priceUSD - b.priceUSD
    );
    lastScrapeTime = new Date();

    console.log(`✅ Found ${euServerData.length} EU Central servers`);
    if (euServerData.length) {
      console.log(
        `📊 First server: ${euServerData[0].server} - $${euServerData[0].priceUSD}`
      );
    }
  } catch (err) {
    console.error("❌ Scraping error:", err.message);
  }
}

// API endpoint
app.get("/api/prices", (req, res) => {
  if (!euServerData.length) {
    return res.json({ message: "No server data available. Try again later." });
  }
  res.json({
    lastUpdated: lastScrapeTime,
    servers: euServerData
  });
});

// Run scrape every 30 mins
cron.schedule("*/30 * * * *", scrapeG2G);

// Run immediately on startup
scrapeG2G();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
