const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cron = require("node-cron");

puppeteer.use(StealthPlugin());
const app = express();
app.use(cors());

let euServerData = [];

// Custom wait function to replace waitForTimeout
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function scrapeG2G() {
  let browser;
  try {
    console.log("🚀 Starting Puppeteer scrape...");
    console.log("Puppeteer-extra version:", require('puppeteer-extra/package.json').version);
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/117.0.0.0 Safari/537.36"
    );

    await page.goto("https://www.g2g.com/categories/lost-ark-gold?q=eu", {
      waitUntil: "networkidle2",
      timeout: 60000
    });
    
    // Using custom wait function instead of waitForTimeout
    await wait(5000);
    
    console.log("Checking page for USD...");
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("Snippet:", bodyText.slice(0, 500));

    // Improved element waiting with multiple selectors
    await Promise.race([
      page.waitForSelector(".sell-offer-card", { timeout: 30000 }),
      page.waitForSelector("div.q-pa-md", { timeout: 30000 })
    ]);
    
    await autoScroll(page);

    // Extract offers with more robust selectors
    const raw = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll(".sell-offer-card, div.q-pa-md");
      
      cards.forEach((card) => {
        const text = card.innerText;
        const priceElement = card.querySelector(".price");
        const serverElement = card.querySelector(".seller-info a");

        // Try to get price from dedicated element first
        let price = 0;
        if (priceElement) {
          const priceText = priceElement.innerText;
          const usdMatch = priceText.match(/([0-9]+\.[0-9]+)/);
          if (usdMatch) price = parseFloat(usdMatch[1]);
        }
        
        // Fallback to text matching
        if (price === 0) {
          const usdMatch = text.match(/([0-9]+\.[0-9]+)\s*USD/i);
          if (usdMatch) price = parseFloat(usdMatch[1]);
        }

        // Server detection
        let server = "";
        if (serverElement) {
          server = serverElement.innerText.trim();
        }
        if (!server) {
          const serverMatch = text.match(/(.+?)\s*-\s*EU Central/i);
          if (serverMatch) server = serverMatch[0].trim();
        }

        // Offers count
        let offers = 0;
        const offersMatch = text.match(/(\d+)\s+offers?/i);
        if (offersMatch) offers = parseInt(offersMatch[1], 10);

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

cron.schedule("*/30 * * * *", scrapeG2G);
scrapeG2G(); // Initial run

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));