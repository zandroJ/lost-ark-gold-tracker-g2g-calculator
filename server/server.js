const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('chromium');
const cheerio = require('cheerio');
const cron = require('node-cron');

const app = express();
app.use(cors());

let euServerData = [];
let lastScrapeTime = null;

async function scrapeG2G() {
  try {
    console.log("🚀 Starting Puppeteer scrape...");

    const browser = await puppeteer.launch({
      executablePath: chromium.path,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/117.0.0.0 Safari/537.36'
    );

    await page.goto('https://www.g2g.com/categories/lost-ark-gold', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    const html = await page.content();
    const $ = cheerio.load(html);
    const serverMap = new Map();

    $('div.offer-list-item-wrapper').each((i, element) => {
      const card = $(element);

      let server = card.find('.offer-seller a').first().text().trim() ||
                   card.find('.text-body1.ellipsis-2-lines').first().text().trim() ||
                   card.find('.text-h6').first().text().trim();

      const priceText = card.find('.offer-price-amount').first().text().trim() ||
                        card.find('.price').first().text().trim();
      const priceMatch = priceText.match(/[\d.]+/);
      const price = priceMatch ? parseFloat(priceMatch[0]) : 0;

      const offersText = card.find('.offer-stock').first().text().trim() ||
                         card.find('.stock').first().text().trim();
      const offersMatch = offersText.match(/\d+/);
      const offers = offersMatch ? parseInt(offersMatch[0], 10) : 0;

      if (server && /EU Central/i.test(server)) {
        server = server.replace(/\s+-\s+EU Central/i, '').trim();
        if (!serverMap.has(server) && price > 0) {
          serverMap.set(server, {
            server,
            offers,
            priceUSD: price,
            valuePer100k: (100000 * price).toFixed(6)
          });
        }
      }
    });

    await browser.close();

    euServerData = Array.from(serverMap.values()).sort((a, b) => a.priceUSD - b.priceUSD);
    lastScrapeTime = new Date();

    console.log(`✅ Found ${euServerData.length} EU Central servers`);
    if (euServerData.length) {
      console.log(`📊 First server: ${euServerData[0].server} - $${euServerData[0].priceUSD}`);
    }
  } catch (err) {
    console.error("❌ Scraping error:", err.message);
  }
}

// Run scrape at startup and every 30 min
scrapeG2G();
cron.schedule('*/30 * * * *', scrapeG2G);

// ROUTES
app.get('/', (req, res) => {
  res.send(`
    <h1>Lost Ark Gold Tracker API</h1>
    <p>✅ Backend is running</p>
    <p>Last scrape: ${lastScrapeTime || 'Never'}</p>
    <p>Servers scraped: ${euServerData.length}</p>
    <p>Endpoints:</p>
    <ul>
      <li><a href="/api/prices">/api/prices</a> - Gold prices</li>
      <li><a href="/api/scrape">/api/scrape</a> - Trigger manual scrape</li>
    </ul>
  `);
});

app.get('/api/prices', (req, res) => {
  if (euServerData.length === 0) {
    return res.status(503).json({ 
      error: 'No server data available yet. Try again later or hit /api/scrape.',
      tip: 'Initial scrape takes about 10-15 seconds after server start',
      lastScrapeTime
    });
  }
  res.json(euServerData);
});

app.get('/api/scrape', async (req, res) => {
  await scrapeG2G();
  res.json({
    status: euServerData.length ? 'success' : 'error',
    serverCount: euServerData.length,
    lastScrapeTime,
    data: euServerData.length ? euServerData : null,
    message: euServerData.length ? '' : 'Scrape completed but no data found'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));