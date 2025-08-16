const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');

puppeteer.use(StealthPlugin());
const app = express();
app.use(cors());

let euServerData = [];
let lastError = null;

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
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      ignoreHTTPSErrors: true
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    await page.setViewport({ width: 1280, height: 900 });

    console.log('Navigating to G2G...');
    
    // Try with timeout and networkidle2 instead of networkidle0
    await page.goto('https://www.g2g.com/categories/lost-ark-gold?q=eu', {
      waitUntil: 'networkidle2',
      timeout: 90000  // Increased timeout
    });

    // Debug: save HTML for inspection
    const html = await page.content();
    console.log(`Page content length: ${html.length} characters`);
    console.log(`HTML snippet: ${html.substring(0, 500)}...`);

    // Check if blocked
    const isBlocked = await page.evaluate(() => {
      return document.body.innerHTML.includes('captcha') || 
             document.body.innerHTML.includes('Access Denied') || 
             document.body.innerHTML.includes('Cloudflare');
    });
    
    if (isBlocked) {
      console.error('❌ Site blocked the scraper');
      lastError = 'Site blocked the request. Try again later.';
      return;
    }

    // Try different selectors with reduced timeout
    try {
      await page.waitForSelector('div.q-pa-md, .sell-offer-card, .offer-list', { 
        timeout: 15000 
      });
    } catch (e) {
      console.log('Primary selectors not found, trying fallbacks...');
    }

    // Scroll to load content
    await autoScroll(page);
    await wait(3000);  // Extra wait after scrolling

    // Debug: check for USD text
    const hasUSD = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).some(el => 
        el.textContent && /USD/i.test(el.textContent)
      );
    });
    
    if (!hasUSD) {
      console.log('No USD found on page, likely blocked or wrong content');
      lastError = 'No price data found. Site might have changed structure.';
      return;
    }

    // Extract offer data with robust fallbacks
    const raw = await page.evaluate(() => {
      const results = [];
      
      // Try multiple card selectors
      const cardSelectors = [
        '.sell-offer-card',
        'div.q-pa-md',
        '.offer-list-item',
        '.col-sm-6',
        'a[href*="/offer/"]'
      ];
      
      let cards = [];
      for (const selector of cardSelectors) {
        cards = Array.from(document.querySelectorAll(selector));
        if (cards.length > 3) break; // Found enough cards
      }
      
      cards.forEach(card => {
        const text = card.textContent;
        
        // Extract price - multiple patterns
        let price = 0;
        const pricePatterns = [
          /(\d+\.\d+)\s*USD/i,
          /USD\s*([\d.]+)/i,
          /from\s*([\d.]+)/i,
          /([\d.]+)\s*per\s*100k/i
        ];
        
        for (const pattern of pricePatterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            price = parseFloat(match[1]);
            break;
          }
        }
        
        // Extract server name
        let server = '';
        const serverPatterns = [
          /(EU Central - [\w\s]+)/i,
          /Server:\s*([\w\s-]+)/i,
          /([\w\s]+ - EU Central)/i
        ];
        
        for (const pattern of serverPatterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            server = match[1].trim();
            break;
          }
        }
        
        // Extract offers count
        let offers = 0;
        const offersMatch = text.match(/(\d+)\s+offers?/i);
        if (offersMatch) offers = parseInt(offersMatch[1], 10);
        
        if (server && price > 0) {
          results.push({
            server,
            offers,
            priceUSD: price,
            valuePer100k: (100000 * price).toFixed(6)
          });
        }
      });
      
      return results;
    });

    // Filter for EU Central servers
    euServerData = raw.filter(r => /EU Central/i.test(r.server));
    console.log(`✅ Scraped ${euServerData.length} EU servers`);
    lastError = null;

  } catch (err) {
    console.error('❌ Scraping error:', err);
    lastError = err.message;
  } finally {
    if (browser) await browser.close();
  }
}

// Routes
app.get('/', (req, res) => {
  res.send(`
    <h1>Lost Ark Gold Tracker</h1>
    <p>Backend is running. Use <a href="/api/prices">/api/prices</a></p>
    <p>Last error: ${lastError || 'None'}</p>
    <p>Last data count: ${euServerData.length}</p>
  `);
});

app.get('/api/prices', (req, res) => {
  if (euServerData.length > 0) {
    res.json({
      lastUpdated: new Date(),
      servers: euServerData
    });
  } else {
    res.status(503).json({
      message: 'Data not available yet',
      error: lastError || 'Scraper initializing'
    });
  }
});

// Initial run
scrapeG2G();

// Schedule every 45 minutes to stay within free tier
cron.schedule('*/45 * * * *', () => {
  console.log('⏰ Running scheduled scrape');
  scrapeG2G();
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));