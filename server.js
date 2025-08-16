const express = require('express');
const cors = require('cors');
const https = require('https'); // Using Node's native https module
const cheerio = require('cheerio');
const cron = require('node-cron');
const { URL } = require('url');

const app = express();
app.use(cors());

// Get your API key from scraperapi.com
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;
const SCRAPER_API_URL = 'https://api.scraperapi.com';

let euServerData = [];
let lastError = null;

async function scrapeG2G() {
  return new Promise((resolve) => {
    try {
      console.log('🚀 Starting G2G scrape via ScraperAPI...');
      
      // Build URL with query parameters
      const params = new URLSearchParams({
        api_key: SCRAPER_API_KEY,
        url: 'https://www.g2g.com/categories/lost-ark-gold?q=eu',
        render: 'true',
        timeout: '60000'
      });
      
      const url = new URL(`${SCRAPER_API_URL}?${params.toString()}`);
      
      const options = {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: 90000
      };

      const req = https.request(options, (response) => {
        let html = '';
        
        response.on('data', (chunk) => {
          html += chunk;
        });

        response.on('end', () => {
          try {
            if (response.statusCode !== 200) {
              throw new Error(`ScraperAPI returned status ${response.statusCode}`);
            }

            const $ = cheerio.load(html);
const results = [];

// Find all offer-related elements
$('*').each((i, el) => {
  const cls = $(el).attr('class');
  const text = $(el).text(); // ✅ Get element text

  if (cls && cls.toLowerCase().includes('offer')) {
    console.log('Found class:', cls);
    console.log('Element text snippet:', text.slice(0, 100));

    // Extract price
    const priceMatch = text.match(/(\d+(?:\.\d+)?)\s*USD/i);
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
        valuePer100k: (100000 * price).toFixed(6),
      });
    }
  }
});


            // Filter for EU Central servers
            euServerData = results.filter(r => /EU Central/i.test(r.server));
            console.log(`✅ Scraped ${euServerData.length} EU servers`);
            lastError = null;
            resolve();
          } catch (err) {
            console.error('❌ Parsing error:', err.message);
            lastError = err.message;
            resolve();
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ Request error:', err.message);
        lastError = err.message;
        resolve();
      });

      req.on('timeout', () => {
        console.error('❌ Request timed out');
        lastError = 'Request timed out';
        req.destroy();
        resolve();
      });

      req.end();
    } catch (err) {
      console.error('❌ Setup error:', err.message);
      lastError = err.message;
      resolve();
    }
  });
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