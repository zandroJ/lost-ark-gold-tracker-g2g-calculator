// server.js
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const cron = require("node-cron");

const app = express();
app.use(cors());

let euServerData = [];

// Helper: scroll page so all offers load
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        total += distance;
        if (total >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });
}

// Scraper function
async function scrapeG2G() {
  let browser;
  try {
    console.log("🚀 Starting Puppeteer scrape...");
    browser = await puppeteer.launch({
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
      timeout: 60000
    });

    await page.waitForSelector("div.q-pa-md", { timeout: 25000 });
    await autoScroll(page);

    // Extract
    const raw = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("div.q-pa-md").forEach((card) => {
        const text = card.innerText;

        const usdMatch = text.match(/([0-9]+\.[0-9]+)\s*USD/i);
        const price = usdMatch ? parseFloat(usdMatch[1]) : 0;

        const offersMatch = text.match(/(\d+)\s+offers?/i);
        const offers = offersMatch ? parseInt(offersMatch[1], 10) : 0;

        const serverMatch = text.match(/(.+?)\s*-\s*EU Central/i);
        const server = serverMatch ? serverMatch[0].trim() : "";

        if (server && price > 0) {
          results.push({
            server,
            offers,
            priceUSD: price,
            valuePer100k: (100000 * price).toFixed(6),
          });
        }
      });
      return results;
    });

    euServerData = raw;
    console.log(`✅ Scraped ${euServerData.length} servers`);

  } catch (err) {
    console.error("❌ Scraping error:", err);
  } finally {
    if (browser) await browser.close();
  }
}

// Routes
app.get("/", (req, res) => {
  res.send("✅ Lost Ark Gold Tracker backend is running. Use /api/prices");
});

app.get("/api/prices", (req, res) => {
  if (!euServerData.length) {
    return res.json({ message: "No server data available. Try again later." });
  }
  res.json({
    lastUpdated: new Date(),
    servers: euServerData,
  });
});

// Schedule scraper
cron.schedule("*/30 * * * *", scrapeG2G);
scrapeG2G();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
