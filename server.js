// server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const cron = require('node-cron');

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
    console.log('🚀 Launching Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-zygote',
        '--single-process',
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1280, height: 900 });

    console.log('🌍 Navigating to G2G...');
    await page.goto('https://www.g2g.com/categories/lost-ark-gold', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for cards to load
await page.waitForSelector('div.q-pa-md', { timeout: 60000 });
    // Scroll to trigger lazy load
await autoScroll(page);
    // Ensure prices are visible
    try {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('span')).some(s => /\bUSD\b/i.test(s.textContent)),
    { timeout: 60000 }   // increased from 20000 → 60000
  );
} catch (e) {
  console.warn('⚠️ USD spans not found in time, continuing anyway...');
}

    // Scrape data inside the browser context
    const raw = await page.evaluate(() => {
      const usdSpans = Array.from(document.querySelectorAll('span')).filter(s => /\bUSD\b/i.test(s.textContent));
      const map = new Map();

      usdSpans.forEach(usdSpan => {
        const card = usdSpan.closest('div.q-pa-md') || usdSpan.closest('.col-sm-6') || usdSpan.closest('a');
        if (!card) return;

        let price = 0;
        if (usdSpan.previousElementSibling && /[0-9]+\.[0-9]+/.test(usdSpan.previousElementSibling.textContent)) {
          price = parseFloat(usdSpan.previousElementSibling.textContent.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
        }

        let offers = 0;
        const offersEl = card.querySelector('.g-chip-counter');
        if (offersEl) {
          const n = offersEl.textContent.replace(/\D/g, '');
          offers = n ? parseInt(n, 10) : 0;
        }

        let server = '';
        const spanWithDash = Array.from(card.querySelectorAll('span')).find(s => / - /.test(s.textContent));
        if (spanWithDash) server = spanWithDash.textContent.trim();

        if (!map.has(server)) {
          map.set(server, {
            server,
            offers,
            priceUSD: price,
            valuePer100k: price ? (100000 * price).toFixed(6) : '0.000000'
          });
        }
      });

      return Array.from(map.values());
    });

    euServerData = raw.filter(r => /EU Central/i.test(r.server));
    console.log(`✅ Scraped ${euServerData.length} EU servers`);

  } catch (err) {
    console.error('❌ Scraping error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

// Run immediately + schedule every 30 min
scrapeG2G();
cron.schedule('*/30 * * * *', scrapeG2G);

app.get('/api/prices', (req, res) => {
  if (euServerData.length > 0) {
    res.json({ lastUpdated: new Date(), servers: euServerData });
  } else {
    res.status(503).json({ message: 'No server data available', servers: [] });
  }
});

app.get('/', (req, res) => res.send('✅ Gold Tracker backend is running'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
