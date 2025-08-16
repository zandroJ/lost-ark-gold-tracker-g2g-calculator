// server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

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
    await page.goto('https://www.g2g.com/categories/lost-ark-gold?q=eu', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Scroll to trigger lazy load
    await autoScroll(page);
    await new Promise(r => setTimeout(r, 5000));

    // Always save debug artifacts
    await page.screenshot({ path: 'debug.png', fullPage: true });
    const html = await page.content();
    fs.writeFileSync('debug.html', html);

    // Scrape cards
    const raw = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card-body, div.q-pa-md, .product-item'));
      console.log(`Found ${cards.length} cards`);

      return cards.map(card => {
        let price = 0;
        let offers = 0;
        let server = '';

        // price
        const priceEl = card.querySelector('span:contains("USD")') || Array.from(card.querySelectorAll('span')).find(s => /\bUSD\b/i.test(s.textContent));
        if (priceEl) {
          const prev = priceEl.previousElementSibling;
          if (prev) {
            const num = prev.textContent.replace(/[^\d.,]/g, '').replace(',', '.');
            price = parseFloat(num) || 0;
          }
        }

        // offers
        const offersEl = card.querySelector('.g-chip-counter');
        if (offersEl) {
          const n = offersEl.textContent.replace(/\D/g, '');
          offers = n ? parseInt(n, 10) : 0;
        }

        // server name
        const spanWithDash = Array.from(card.querySelectorAll('span')).find(s => / - /.test(s.textContent));
        if (spanWithDash) server = spanWithDash.textContent.trim();

        return {
          server,
          offers,
          priceUSD: price,
          valuePer100k: price ? (100000 * price).toFixed(6) : '0.000000'
        };
      }).filter(r => r.server); // keep only real servers
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

// Debug routes
app.get('/debug/screenshot', (req, res) => {
  const filePath = path.join(__dirname, 'debug.png');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Screenshot not found');
  }
});

app.get('/debug/html', (req, res) => {
  const filePath = path.join(__dirname, 'debug.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('HTML not found');
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
