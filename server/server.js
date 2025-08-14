// server.js
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(cors());

let euServerData = [];

// Auto-scroll helper
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

// Main scrape function
async function scrapeG2G() {
  let browser;
  try {
    console.log("🚀 Starting G2G scrape...");

    const executablePath = await chromium.executablePath;

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto('https://www.g2g.com/categories/lost-ark-gold', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.waitForSelector('div.q-pa-md', { timeout: 25000 });
    await autoScroll(page);

    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('span')).some(s => /\bUSD\b/i.test(s.textContent)),
      { timeout: 20000 }
    );

    const raw = await page.evaluate(() => {
      const usdSpans = Array.from(document.querySelectorAll('span')).filter(s => /\bUSD\b/i.test(s.textContent));
      const map = new Map();

      usdSpans.forEach(usdSpan => {
        const card = usdSpan.closest('div.q-pa-md') || usdSpan.closest('.col-sm-6') || usdSpan.closest('a');
        if (!card) return;

        let price = 0;
        if (usdSpan.previousElementSibling && /[0-9]+\.[0-9]+/.test(usdSpan.previousElementSibling.textContent)) {
          const cleaned = usdSpan.previousElementSibling.textContent.replace(/[^\d.,]/g, '').replace(',', '.');
          price = parseFloat(cleaned) || 0;
        } else {
          const candidate = Array.from(card.querySelectorAll('span')).find(s => /[0-9]+\.[0-9]+/.test(s.textContent));
          if (candidate) {
            const m = candidate.textContent.match(/[0-9]+(?:\.[0-9]+)?/);
            if (m) price = parseFloat(m[0].replace(',', '.')) || 0;
          }
        }

        let offers = 0;
        const offersEl = card.querySelector('.g-chip-counter');
        if (offersEl) {
          const n = offersEl.textContent.replace(/\D/g, '');
          offers = n ? parseInt(n, 10) : 0;
        }

        let server = '';
        const trySelectors = [
          '.text-body1.ellipsis-2-lines span',
          '.text-body1.ellipsis-2-lines',
          '.text-h6',
          'h3',
          'span'
        ];
        for (const sel of trySelectors) {
          const el = card.querySelector(sel);
          if (el && el.textContent.trim()) {
            const txt = el.textContent.trim();
            if (txt.includes(' - ')) {
              server = txt;
              break;
            } else if (!server) {
              server = txt;
            }
          }
        }

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
    console.log(`✅ Scraped ${euServerData.length} EU Central servers`);
  } catch (err) {
    console.error('❌ Scraping error:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

// Run scrape at startup and every 30 min
scrapeG2G();
cron.schedule('*/30 * * * *', scrapeG2G);

// ROUTES
app.get('/', (req, res) => {
  res.send('✅ Backend is running. Try /api/prices or /api/scrape');
});

app.get('/api/prices', (req, res) => {
  if (!euServerData.length) {
    return res.status(503).json({ error: 'No server data available yet. Try again later or hit /api/scrape.' });
  }
  res.json(euServerData);
});

app.get('/api/scrape', async (req, res) => {
  await scrapeG2G();
  res.json(euServerData.length ? euServerData : { error: 'Scrape completed but no data found.' });
});

app.get('/test', (req, res) => res.send('Server running'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
