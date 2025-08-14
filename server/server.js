const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

const app = express();
app.use(cors());

let euServerData = [];
let lastScrapeTime = null;

async function scrapeG2G() {
  try {
    console.log("🚀 Starting G2G scrape...");
    
    const response = await axios.get('https://www.g2g.com/categories/lost-ark-gold', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      }
    });

    const $ = cheerio.load(response.data);
    const serverMap = new Map();

    // Find all offer cards
    $('div.offer-list-item-wrapper').each((i, element) => {
      const card = $(element);
      
      // Extract server name
      const serverElement = card.find('.offer-seller a').first() || 
                           card.find('.text-body1.ellipsis-2-lines').first() || 
                           card.find('.text-h6').first();
      let server = serverElement.text().trim();
      
      // Extract price
      const priceElement = card.find('.offer-price-amount').first() || 
                          card.find('.price').first();
      const priceText = priceElement.text().trim();
      const priceMatch = priceText.match(/[\d.]+/);
      const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
      
      // Extract offers count
      const offersElement = card.find('.offer-stock').first() || 
                           card.find('.stock').first();
      const offersText = offersElement.text().trim();
      const offersMatch = offersText.match(/\d+/);
      const offers = offersMatch ? parseInt(offersMatch[0], 10) : 0;
      
      // Only process EU Central servers
      if (server && /EU Central/i.test(server)) {
        // Clean server name
        server = server
          .replace(/\s+/g, ' ')
          .replace(/\s-\sEU Central/i, '')
          .trim();
        
        // Deduplicate by server name
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

    euServerData = Array.from(serverMap.values())
      .sort((a, b) => a.priceUSD - b.priceUSD);
    
    lastScrapeTime = new Date();
    console.log(`✅ Scraped ${euServerData.length} EU Central servers`);
    
    if (euServerData.length > 0) {
      console.log(`📊 Sample server: ${euServerData[0].server} - $${euServerData[0].priceUSD}`);
    }
  } catch (err) {
    console.error('❌ Scraping error:', err.message);
    console.error('❌ Error details:', err.response ? {
      status: err.response.status,
      data: err.response.data.substring(0, 500) + '...'
    } : 'No response details');
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