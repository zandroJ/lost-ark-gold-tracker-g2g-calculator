// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

const app = express();
app.use(cors());

let euServerData = [];

// Main scrape function
async function scrapeG2G() {
  try {
    console.log("🚀 Starting G2G scrape...");
    
    // Fetch the page with proper headers
    const response = await axios.get('https://www.g2g.com/categories/lost-ark-gold', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://www.g2g.com/'
      }
    });

    const $ = cheerio.load(response.data);
    const serverMap = new Map();

    console.log(`📄 Page loaded with ${response.data.length} characters`);
    
    // Process each offer card
    $('div[data-v-1c4d3f28]').each((i, element) => {
      const card = $(element);
      
      // Extract server name - using multiple selectors
      let server = card.find('.offer-seller a').text().trim() || 
                  card.find('.text-body1.ellipsis-2-lines').text().trim() || 
                  card.find('.text-h6').text().trim() ||
                  card.find('.seller-name').text().trim() ||
                  card.find('.offer-title').text().trim();
      
      // Extract price
      let priceText = card.find('.offer-price-amount').text().trim() || 
                     card.find('.price').text().trim() || 
                     card.find('.amount').text().trim();
      
      // Extract the numeric value from price text
      const priceMatch = priceText.match(/[\d.]+/);
      const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
      
      // Extract offers count
      let offersText = card.find('.offer-stock').text().trim() || 
                      card.find('.stock').text().trim() || 
                      card.find('.available').text().trim();
      
      const offersMatch = offersText.match(/\d+/);
      const offers = offersMatch ? parseInt(offersMatch[0], 10) : 0;
      
      // Only process EU Central servers
      if (server && /EU Central/i.test(server)) {
        server = server.replace(/\s+/g, ' ').replace(/\s-\sEU Central/i, '').trim();
        
        // Deduplicate by server name
        if (!serverMap.has(server)) {
          serverMap.set(server, {
            server,
            offers,
            priceUSD: price,
            valuePer100k: price ? (100000 * price).toFixed(6) : '0.000000'
          });
        }
      }
    });

    // Alternative approach if no cards found
    if (serverMap.size === 0) {
      console.log("⚠️ No cards found, trying alternative approach");
      
      // Look for server names in the page
      $('div').each((i, element) => {
        const text = $(element).text();
        if (/EU Central/i.test(text) && /USD/i.test(text)) {
          const serverMatch = text.match(/([A-Za-z]+)\s+-\s+EU Central/i);
          const priceMatch = text.match(/USD\s*([\d.]+)/i);
          const offersMatch = text.match(/(\d+)\s+offers/i);
          
          if (serverMatch && priceMatch) {
            const server = serverMatch[1].trim();
            const price = parseFloat(priceMatch[1]);
            const offers = offersMatch ? parseInt(offersMatch[1], 10) : 0;
            
            if (!serverMap.has(server)) {
              serverMap.set(server, {
                server,
                offers,
                priceUSD: price,
                valuePer100k: price ? (100000 * price).toFixed(6) : '0.000000'
              });
            }
          }
        }
      });
    }

    euServerData = Array.from(serverMap.values())
      .sort((a, b) => a.priceUSD - b.priceUSD);
    
    console.log(`✅ Scraped ${euServerData.length} EU Central servers`);
    
    // Log the first server if available for debugging
    if (euServerData.length > 0) {
      console.log(`📊 Sample server: ${euServerData[0].server} - $${euServerData[0].priceUSD}`);
    }
  } catch (err) {
    console.error('❌ Scraping error:', err.message);
    console.error('❌ Error details:', err.response ? {
      status: err.response.status,
      headers: err.response.headers,
      data: err.response.data.substring(0, 500) // First 500 characters
    } : 'No response details');
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
      tip: 'Initial scrape takes about 10-15 seconds after server start'
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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));