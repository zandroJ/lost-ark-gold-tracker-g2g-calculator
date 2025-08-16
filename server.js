// server.js
const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const cron = require("node-cron");

const app = express();
app.use(cors());

let euServerData = [];

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        total += distance;
        if (total >= scrollHeight - window.innerHeight) {
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
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setViewport({ width: 1280, height: 900 });

    console.log("🌍 Navigating to G2G...");
    await page.goto("https://www.g2g.com/categories/lost-ark-gold", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await page.waitForSelector("div.q-pa-md", { timeout: 25000 });

    // scroll to load lazy cards
    await autoScroll(page);

    // ensure prices are visible
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("span")).some((s) => /\bUSD\b/i.test(s.textContent)),
      { timeout: 20000 }
    );

    // short pause
    await new Promise((r) => setTimeout(r, 800));

    // main scrape logic
    const raw = await page.evaluate(() => {
      const usdSpans = Array.from(document.querySelectorAll("span")).filter((s) =>
        /\bUSD\b/i.test(s.textContent)
      );
      const map = new Map();

      usdSpans.forEach((usdSpan) => {
        const card = usdSpan.closest("div.q-pa-md") || usdSpan.closest(".col-sm-6") || usdSpan.closest("a");
        if (!card) return;

        let price = 0;
        if (
          usdSpan.previousElementSibling &&
          /[0-9]+\.[0-9]+/.test(usdSpan.previousElementSibling.textContent)
        ) {
          const cleaned = usdSpan.previousElementSibling.textContent
            .replace(/[^\d.,]/g, "")
            .trim()
            .replace(",", ".");
          price = parseFloat(cleaned) || 0;
        }

        let server = "";
        const spanWithDash = Array.from(card.querySelectorAll("span")).find((s) => / - /.test(s.textContent));
        if (spanWithDash) server = spanWithDash.textContent.trim();

        if (server && !map.has(server)) {
          map.set(server, {
            server,
            priceUSD: price,
            valuePer100k: price ? (100000 * price).toFixed(6) : "0.000000",
          });
        }
      });

      return Array.from(map.values());
    });

    euServerData = raw.filter((r) => /EU Central/i.test(r.server));

    console.log("✅ Scraped EU Central:", euServerData.length);
  } catch (err) {
    console.error("❌ Scraping error:", err);
  } finally {
    if (browser) await browser.close();
  }
}

// run once + every 30 minutes
scrapeG2G();
cron.schedule("*/30 * * * *", scrapeG2G);

app.get("/api/prices", (req, res) => res.json(euServerData));
app.get("/", (req, res) => res.send("✅ Backend is running"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
