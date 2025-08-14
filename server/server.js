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
        '--single-process'
      ],
      timeout: 60000
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9'
    });
    
    // Set viewport to desktop size
    await page.setViewport({ width: 1280, height: 900 });

    console.log('🌐 Navigating to G2G...');
    await page.goto('https://www.g2g.com/categories/lost-ark-gold', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    // Add extra delay to ensure content is fully rendered
    await new Promise(r => setTimeout(r, 5000));

    console.log('🔍 Extracting server data...');
    const raw = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.offer-list-item'));
      const map = new Map();

      cards.forEach(card => {
        // Find server name
        let server = card.querySelector('.offer-seller')?.textContent?.trim() || 
                     card.querySelector('.offer-title')?.textContent?.trim() || 
                     '';
        
        // Find price
        const priceElement = card.querySelector('.offer-price-amount');
        let price = 0;
        if (priceElement) {
          const priceText = priceElement.textContent.trim();
          const priceMatch = priceText.match(/[\d.]+/);
          price = priceMatch ? parseFloat(priceMatch[0]) : 0;
        }
        
        // Find offers count
        const offersElement = card.querySelector('.offer-stock');
        let offers = 0;
        if (offersElement) {
          const offersText = offersElement.textContent.trim();
          const offersMatch = offersText.match(/\d+/);
          offers = offersMatch ? parseInt(offersMatch[0], 10) : 0;
        }
        
        if (server && /EU Central/i.test(server)) {
          // Deduplicate by server name
          if (!map.has(server)) {
            map.set(server, {
              server,
              offers,
              priceUSD: price,
              valuePer100k: price ? (100000 * price).toFixed(6) : '0.000000'
            });
          }
        }
      });

      return Array.from(map.values());
    });

    // Filter EU Central servers
    euServerData = raw.filter(r => r.server && /EU Central/i.test(r.server));
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
      try {
        await browser.close();
      } catch (e) {
        console.error('Error closing browser:', e.message);
      }
    }
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));