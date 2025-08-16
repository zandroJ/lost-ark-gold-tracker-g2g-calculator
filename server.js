const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Replaced axios with node-fetch
const cheerio = require('cheerio');
const cron = require('node-cron');

const app = express();
app.use(cors());

// Get your API key from scraperapi.com
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;
const SCRAPER_API_URL = 'https://api.scraperapi.com';

let euServerData = [];
let lastError = null;

async function scrapeG2G() {
  try {
    console.log('🚀 Starting G2G scrape via ScraperAPI...');
    
    // Build URL with query parameters
    const params = new URLSearchParams({
      api_key: SCRAPER_API_KEY,
      url: 'https://www.g2g.com/categories/lost-ark-gold?q=eu',
      render: 'true',
      timeout: '60000'
    });
    
    const url = `${SCRAPER_API_URL}?${params.toString()}`;
    const response = await fetch(url, { timeout: 90000 });

    if (!response.ok) {
      throw new Error(`ScraperAPI returned status ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results = [];

    // Find all offer cards
    $('.sell-offer-card, div.q-pa-md').each((i, card) => {
      const text = $(card).text();
      
      // Extract price
      const priceMatch = text.match(/(\d+\.\d+)\s*USD/i);
      const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
      
      // Extract offers count
      const offersMatch = text.match(/(\d+)\s+offers?/i);
      const offers = offersMatch ? parseInt(offersMatch[1], 10) : 0;
      
      // Extract server name
      const serverMatch = text.match(/(.+?)\s*-\s*EU Central/i);
      const server = serverMatch ? serverMatch[0].trim() : '';

      if (server && price > 0) {
        results.push({
          server,
          offers,
          priceUSD: price,
          valuePer100k: (100000 * price).toFixed(6)
        });
      }
    });

    // Filter for EU Central servers
    euServerData = results.filter(r => /EU Central/i.test(r.server));
    console.log(`✅ Scraped ${euServerData.length} EU servers`);
    lastError = null;

  } catch (err) {
    console.error('❌ Scraping error:', err.message);
    lastError = err.message;
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

// Schedule every 45 minutes
cron.schedule('*/45 * * * *', () => {
  console.log('⏰ Running scheduled scrape');
  scrapeG2G();
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));