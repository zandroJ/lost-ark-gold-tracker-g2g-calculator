const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const cron = require('node-cron');

const app = express();
app.use(cors());

// Configure for Render.com
const isRender = process.env.RENDER;
const chromePath = isRender 
  ? '/usr/bin/chromium-browser' 
  : puppeteer.executablePath();

let euServerData = [];
let isScraping = false;

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        
        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

async function scrapeG2G() {
  if (isScraping) {
    console.log('⚠️ Scrape already in progress. Skipping...');
    return;
  }
  
  isScraping = true;
  let browser;
  
  try {
    console.log("🚀 Starting G2G scrape...");
    
    // Launch browser with optimized configuration
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ],
      timeout: 60000
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
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    // Wait for cards container with more tolerance
    console.log('⏳ Waiting for content to load...');
    await page.waitForSelector('div.q-pa-md', { timeout: 45000 }).catch(() => {
      console.log('⚠️ div.q-pa-md not found, continuing anyway');
    });

    // Scroll to load lazy-loaded content
    console.log('🖱️ Scrolling to load more content...');
    await autoScroll(page);

    // Add extra delay to ensure content is fully rendered
    await new Promise(r => setTimeout(r, 3000));

    console.log('🔍 Extracting server data...');
    const raw = await page.evaluate(() => {
      const usdSpans = Array.from(document.querySelectorAll('span')).filter(s => 
        /\bUSD\b/i.test(s.textContent)
      );
      const map = new Map();

      usdSpans.forEach(usdSpan => {
        const card = usdSpan.closest('div.q-pa-md') || 
                     usdSpan.closest('.col-sm-6') || 
                     usdSpan.closest('a') ||
                     usdSpan.closest('.offer-list-item');
        if (!card) return;

        // ... rest of your extraction logic remains the same ...
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
  } finally {
    if (browser) {
      console.log('🛑 Closing browser instance...');
      await browser.close().catch(err => 
        console.error('Error closing browser:', err.message)
      );
    }
    isScraping = false;
  }
}

// Run scrape at startup and every 30 min
setTimeout(scrapeG2G, 10000); // Delay initial scrape
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