// server.js
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const cron = require("node-cron");

const app = express();
app.use(cors());

let euServerData = [];

async function scrapeG2G() {
  console.log("🚀 Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    console.log("🌍 Navigating to G2G...");
    await page.goto("https://www.g2g.com/categories/lost-ark-gold", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // wait for the listings to load
    await page.waitForSelector("body", { timeout: 30000 });

    // extract offers
    const offers = await page.$$eval("div", (nodes) =>
      nodes
        .map((el) => {
          const text = el.innerText.trim();
          // Match things like: Ratik - EU Central\nfrom 0.000085 SGD
          const match = text.match(/([A-Za-z]+ - EU [A-Za-z]+)\s+from ([0-9.]+)\s+(USD|SGD|EUR)/);
          if (match) {
            return {
              server: match[1],
              price: parseFloat(match[2]),
              currency: match[3],
            };
          }
          return null;
        })
        .filter(Boolean)
    );

    console.log("✅ Scraped offers:", offers.length);
    console.log(offers);

    euServerData = offers;
  } catch (err) {
    console.error("❌ Error scraping:", err);
  } finally {
    await browser.close();
  }
}

// Run immediately at startup
scrapeG2G();

// Schedule scrape every 30 minutes
cron.schedule("*/30 * * * *", scrapeG2G);

// API endpoint
app.get("/api/prices", (req, res) => {
  res.json(euServerData);
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
