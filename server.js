const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');

puppeteer.use(StealthPlugin());
const app = express();
app.use(cors());

let euServerData = [];

// Custom wait helper
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    console.log('🚀 Starting Puppeteer on Railway...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1280, height: 900 });

    console.log('Navigating to G2G...');
    await page.goto('https://www.g2g.com/categories/lost-ark-gold?q=eu', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Wait for cards container
    await page.waitForSelector('div.q-pa-md, .sell-offer-card', { timeout: 30000 });

    // Scroll to load lazy content
    await autoScroll(page);

    // Wait for USD labels to appear
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('span')).some(s => /\bUSD\b/i.test(s.textContent)),
      { timeout: 20000 }
    );

    // Short safety pause
    await wait(1000);

    // Extract offer data
    const raw = await page.evaluate(() => {
      const usdSpans = Array.from(document.querySelectorAll('span')).filter(s => /\bUSD\b/i.test(s.textContent));
      const map = new Map();

      usdSpans.forEach(usdSpan => {
        const card = usdSpan.closest('div.q-pa-md') || 
                     usdSpan.closest('.sell-offer-card') || 
                     usdSpan.closest('.col-sm-6') || 
                     usdSpan.closest('a');
        if (!card) return;

        // Extract price
        let price = 0;
        if (usdSpan.previousElementSibling && /[0-9]+\.[0-9]+/.test(usdSpan.previousElementSibling.textContent)) {
          price = parseFloat(usdSpan.previousElementSibling.textContent.replace(/[^\d.,]/g, '').replace(',', '.'));
        } else {
          const priceCandidate = card.querySelector('[class*="price"]');
          if (priceCandidate) {
            const priceMatch = priceCandidate.textContent.match(/[0-9]+\.[0-9]+/);
            if (priceMatch) price = parseFloat(priceMatch[0]);
          }
        }

        // Extract offers count
        let offers = 0;
        const offersEl = card.querySelector('.g-chip-counter, [class*="offer"]');
        if (offersEl) {
          offers = parseInt(offersEl.textContent.replace(/\D/g, ''), 10) || 0;
        }

        // Extract server name
        let server = '';
        const serverSelectors = [
          '[class*="server"]',
          '[class*="title"]',
          '[class*="name"]',
          'h3',
          'h4',
          '.text-body1',
          '.text-h6'
        ];
        
        for (const selector of serverSelectors) {
          const el = card.querySelector(selector);
          if (el && el.textContent && / - /.test(el.textContent)) {
            server = el.textContent.trim();
            break;
          }
        }

        if (!server) {
          // Final fallback to regex scanning
          const text = card.textContent;
          const serverMatch = text.match(/(.{1,60}?)\s*-\s*(EU Central|US East|US West|EU)/i);
          if (serverMatch) server = serverMatch[0].trim();
        }

        // Only add valid entries
        if (server && price > 0) {
          if (!map.has(server)) {
            map.set(server, {
              server,
              offers,
              priceUSD: price,
              valuePer100k: (100000 * price).toFixed(6)
            });
          }
        }
      });

      return Array.from(map.values());
    });

    // Filter for EU Central servers
    euServerData = raw.filter(r => /EU Central/i.test(r.server));
    console.log(`✅ Scraped ${euServerData.length} EU servers`);

  } catch (err) {
    console.error('❌ Scraping error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

// Routes
app.get('/', (req, res) => {
  res.send('✅ Lost Ark Gold Tracker backend is running. Use /api/prices');
});

app.get('/api/prices', (req, res) => {
  res.json(euServerData.length > 0 ? euServerData : { message: 'Data not available yet' });
});

// Run immediately and schedule every 30 minutes
scrapeG2G();
cron.schedule('*/30 * * * *', scrapeG2G);

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));