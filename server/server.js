const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const cron = require('node-cron');

const app = express();
app.use(cors());

let euServerData = [];
let lastScrapeTime = null;

// Railway-optimized browser launch
async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process'
    ]
  });
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
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
    browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Configure browser settings
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1280, height: 900 });

    // Navigate with robust timeout handling
    console.log('Navigating to G2G...');
    await page.goto('https://www.g2g.com/categories/lost-ark-gold', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for content to load
    await page.waitForSelector('div.q-pa-md', { timeout: 30000 });
    await autoScroll(page);
    await page.waitForTimeout(1000); // Extra safety delay

    // Extract data
    const scrapedData = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('div.q-pa-md');
      
      cards.forEach(card => {
        // Find server name
        const serverEl = card.querySelector('.text-body1, .text-h6, h3');
        if (!serverEl) return;
        const server = serverEl.textContent.trim();
        
        // Find USD price
        const usdSpan = Array.from(card.querySelectorAll('span'))
          .find(el => el.textContent.includes('USD') && el.previousElementSibling);
        
        if (!usdSpan) return;
        const priceText = usdSpan.previousElementSibling.textContent.replace(/[^\d.]/g, '');
        const price = parseFloat(priceText);
        if (isNaN(price)) return;
        
        // Find offer count
        const offersEl = card.querySelector('.g-chip-counter');
        const offers = offersEl ? parseInt(offersEl.textContent.replace(/\D/g, '')) || 0 : 0;
        
        results.push({
          server,
          offers,
          priceUSD: price,
          valuePer100k: (100000 * price).toFixed(6)
        });
      });
      
      return results;
    });

    // Filter EU servers
    euServerData = scrapedData.filter(item => 
      /EU Central/i.test(item.server)
    );
    
    lastScrapeTime = new Date();
    console.log(`Scraped ${euServerData.length} EU servers at ${lastScrapeTime}`);
    
  } catch (err) {
    console.error('Scraping error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

// Initialize scraping
const init = async () => {
  console.log('Starting initial scrape...');
  await scrapeG2G();
  
  // Schedule every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    console.log('Running scheduled scrape...');
    scrapeG2G();
  });
};

init();

// API Endpoints
app.get('/api/prices', (req, res) => {
  if (euServerData.length === 0) {
    return res.json({
      status: 'pending',
      message: 'No data available yet',
      tip: 'Initial scrape takes about 10-15 seconds after server start',
      lastScrapeTime: lastScrapeTime?.toISOString() || null
    });
  }
  res.json({
    status: 'success',
    count: euServerData.length,
    lastScrapeTime: lastScrapeTime.toISOString(),
    data: euServerData
  });
});

app.get('/api/scrape', async (req, res) => {
  try {
    await scrapeG2G();
    if (euServerData.length === 0) {
      return res.json({
        status: 'error',
        serverCount: 0,
        lastScrapeTime: lastScrapeTime.toISOString(),
        message: 'Scrape completed but no data found'
      });
    }
    res.json({
      status: 'success',
      serverCount: euServerData.length,
      lastScrapeTime: lastScrapeTime.toISOString(),
      data: euServerData
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

app.get('/', (req, res) => {
  res.send(`
    <h1>Lost Ark Gold Tracker API</h1>
    <p>✅ Backend is running</p>
    <p>Last scrape: ${lastScrapeTime || 'Never'}</p>
    <p>Servers scraped: ${euServerData.length}</p>
    <h3>Endpoints:</h3>
    <ul>
      <li><a href="/api/prices">/api/prices</a> - Gold prices</li>
      <li><a href="/api/scrape">/api/scrape</a> - Trigger manual scrape</li>
    </ul>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));