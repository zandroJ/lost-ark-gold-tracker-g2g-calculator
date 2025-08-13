const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());

let euServerData = [];

const scrapeG2G = async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    
    await page.goto('https://www.g2g.com/categories/lost-ark-gold', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Wait for server cards to appear
    await page.waitForSelector('div.q-pa-md', { timeout: 10000 });
    
    // Extract data
    const servers = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('div.q-pa-md');
      
      cards.forEach(card => {
        // Server name - get the first span in the card
        const serverSpan = card.querySelector('span');
        const server = serverSpan ? serverSpan.textContent.trim() : '';
        
        // Offers count - look for the g-chip-counter element
        let offers = 0;
        const offersEl = card.querySelector('.g-chip-counter');
        if (offersEl) {
          const offersText = offersEl.textContent.trim();
          offers = parseInt(offersText.replace(/\D/g, '')) || 0;
        }
        
        // Price - look for the span containing the price value
        let price = 0;
        // Find all spans and look for the one with a numeric price
        const spans = card.querySelectorAll('span');
        for (const span of spans) {
          const text = span.textContent.trim();
          // Match decimal numbers with optional scientific notation
          const numMatch = text.match(/[\d.]+(?:[eE][-+]?\d+)?/);
          if (numMatch) {
            const num = parseFloat(numMatch[0]);
            // Only accept prices in the expected range
            if (!isNaN(num) && num > 0.000001 && num < 1) {
              price = num;
              break;
            }
          }
        }
        
        // Only include EU Central servers
        if (server.includes('EU Central')) {
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
    
    euServerData = servers;
    console.log('Scraped data:', euServerData);
    
  } catch (error) {
    console.error('Puppeteer error:', error);
  } finally {
    if (browser) await browser.close();
  }
};

// Scrape immediately on start and then every 30 minutes
scrapeG2G();
cron.schedule('*/30 * * * *', scrapeG2G);

app.get('/api/prices', (req, res) => {
  res.json(euServerData);
});

app.get('/test', (req, res) => {
  res.send('Server running');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));