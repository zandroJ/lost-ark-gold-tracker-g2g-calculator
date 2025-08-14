// server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const cron = require('node-cron');

const app = express();
app.use(cors());

let euServerData = [];

// Configure Chromium path for Render.com
const isRender = process.env.RENDER;
const chromePath = isRender 
  ? '/usr/bin/chromium-browser' 
  : puppeteer.executablePath();

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
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    });
    
    // Set viewport to desktop size
    await page.setViewport({ width: 1280, height: 900 });

    console.log('🌐 Navigating to G2G...');
    await page.goto('https://www.g2g.com/categories/lost-ark-gold', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for cards container
    console.log('⏳ Waiting for content to load...');
    await page.waitForSelector('div.q-pa-md', { timeout: 45000 });

    // Scroll to load lazy-loaded content
    console.log('🖱️ Scrolling to load more content...');
    await autoScroll(page);

    // Wait for price elements
    console.log('💲 Waiting for price elements...');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('span')).some(s => /\bUSD\b/i.test(s.textContent)),
      { timeout: 30000 }
    );

    // Add extra delay to ensure content is fully rendered
    await new Promise(r => setTimeout(r, 2000));

    console.log('🔍 Extracting server data...');
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
          } else {
            const m = card.innerText.match(/from\s*([0-9.,]+)/i);
            if (m) price = parseFloat(m[1].replace(',', '.')) || 0;
          }
        }

        let offers = 0;
        const offersEl = card.querySelector('.g-chip-counter');
        if (offersEl) {
          const n = offersEl.textContent.replace(/\D/g, '');
          offers = n ? parseInt(n, 10) : 0;
        } else {
          const m = card.innerText.match(/(\d+)\s+offers?/i);
          offers = m ? parseInt(m[1], 10) : 0;
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

        if (!/ - /i.test(server)) {
          const spanWithDash = Array.from(card.querySelectorAll('span')).find(s => / - /.test(s.textContent));
          if (spanWithDash) server = spanWithDash.textContent.trim();
        }

        if (!server || server.length > 80) {
          const m = card.innerText.match(/(.{1,60}?\s-\s(?:EU Central|US East|US West|EU|[^\n]+))/i);
          if (m) server = m[0].trim();
        }

        if (!server) {
          server = card.innerText.split('\n').map(s => s.trim()).find(s => s.length > 0) || '';
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

    // Filter EU Central servers
    euServerData = raw.filter(r => /EU Central/i.test(r.server));
    console.log(`✅ Scraped ${euServerData.length} EU Central servers`);
    
    if (euServerData.length > 0) {
      console.log(`📊 Sample server: ${euServerData[0].server} - $${euServerData[0].priceUSD}`);
    } else {
      console.log('⚠️ No EU Central servers found in the data');
    }

  } catch (err) {
    console.error('❌ Scraping error:', err.message);
    if (err.response) {
      console.error('Error response:', {
        status: err.response.status,
        headers: err.response.headers
      });
    }
  } finally {
    if (browser) {
      console.log('🛑 Closing browser instance...');
      await browser.close();
    }
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
  if (euServerData.length === 0) {
    return res.status(503).json({ 
      error: 'No server data available yet. Try again later or hit /api/scrape.',
      tip: 'Initial scrape takes about 30-60 seconds after server start'
    });
  }
  res.json(euServerData);
});

app.get('/api/scrape', async (req, res) => {
  await scrapeG2G();
  res.json({
    status: euServerData.length ? 'success' : 'error',
    serverCount: euServerData.length,
    data: euServerData.length ? euServerData : null,
    message: euServerData.length ? '' : 'Scrape completed but no data found'
  });
});

app.get('/test', (req, res) => res.send('Server running'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));