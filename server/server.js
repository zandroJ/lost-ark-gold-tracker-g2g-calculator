// server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// const DEBUG_PATH = path.join(__dirname, 'debug.json');
let euServerData = [];

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
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1280, height: 900 });

    console.log('Navigating to G2G...');
    await page.goto('https://www.g2g.com/categories/lost-ark-gold', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for cards container
    await page.waitForSelector('div.q-pa-md', { timeout: 25000 });

    // Scroll so lazy cards are rendered
    await autoScroll(page);

    // Wait until at least one USD label exists on the page (so numeric spans likely present)
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('span')).some(s => /\bUSD\b/i.test(s.textContent)),
      { timeout: 20000 }
    );

    // short pause to be safe
    await new Promise(r => setTimeout(r, 800));

    // Main extraction: find USD spans, then extract the numeric sibling within that card
    const raw = await page.evaluate(() => {
      const usdSpans = Array.from(document.querySelectorAll('span')).filter(s => /\bUSD\b/i.test(s.textContent));
      const map = new Map();

      usdSpans.forEach(usdSpan => {
        // find card ancestor - the site uses div.q-pa-md for cards
        const card = usdSpan.closest('div.q-pa-md') || usdSpan.closest('.col-sm-6') || usdSpan.closest('a');
        if (!card) return;

        // Find numeric float inside card spans (e.g., 0.000056). Prefer the span immediately before USD if exists.
        let price = 0;
        // Prefer previousElementSibling numeric
        if (usdSpan.previousElementSibling && /[0-9]+\.[0-9]+/.test(usdSpan.previousElementSibling.textContent)) {
          const cleaned = usdSpan.previousElementSibling.textContent.replace(/[^\d.,]/g, '').trim().replace(',', '.');
          price = parseFloat(cleaned) || 0;
        } else {
          // fallback: search any span inside card with a float
          const candidate = Array.from(card.querySelectorAll('span')).find(s => /[0-9]+\.[0-9]+/.test(s.textContent));
          if (candidate) {
            const m = candidate.textContent.match(/[0-9]+(?:\.[0-9]+)?/);
            if (m) price = parseFloat(m[0].replace(',', '.')) || 0;
          } else {
            // last fallback: regex on card text for "from <num>"
            const m = card.innerText.match(/from\s*([0-9.,]+)/i);
            if (m) price = parseFloat(m[1].replace(',', '.')) || 0;
          }
        }

        // offers: try g-chip-counter then fallback to regex
        let offers = 0;
        const offersEl = card.querySelector('.g-chip-counter');
        if (offersEl) {
          const n = offersEl.textContent.replace(/\D/g, '');
          offers = n ? parseInt(n, 10) : 0;
        } else {
          const m = card.innerText.match(/(\d+)\s+offers?/i);
          offers = m ? parseInt(m[1], 10) : 0;
        }

        // server name: try targeted selectors then fallback to scanning spans for a "name - region" pattern
        let server = '';
        const trySelectors = [
          '.text-body1.ellipsis-2-lines span',
          '.text-body1.ellipsis-2-lines',
          '.text-h6',
          'h3',
          'span'
        ];
        for (const sel of trySelectors) {
          const el = card.querySelector(sel);
          if (el && el.textContent.trim()) {
            // prefer the string that contains " - " (server - region)
            const txt = el.textContent.trim();
            if (txt.includes(' - ')) {
              server = txt;
              break;
            } else if (!server) {
              server = txt;
            }
          }
        }

        // If server still not clearly found, search spans for something with " - "
        if (!/ - /i.test(server)) {
          const spanWithDash = Array.from(card.querySelectorAll('span')).find(s => / - /.test(s.textContent));
          if (spanWithDash) server = spanWithDash.textContent.trim();
        }

        // Final fallback: regex on whole card innerText for "Name - Region" (shorter than 80 chars)
        if (!server || server.length > 80) {
          const m = card.innerText.match(/(.{1,60}?\s-\s(?:EU Central|US East|US West|EU|[^\n]+))/i);
          if (m) server = m[0].trim();
        }

        if (!server) {
          // give up naming this card (still store numeric data under empty server to inspect)
          server = card.innerText.split('\n').map(s => s.trim()).find(s => s.length > 0) || '';
        }

        // deduplicate by server string
        if (!map.has(server)) {
          map.set(server, {
            server,
            offers,
            priceUSD: price,
            valuePer100k: price ? (100000 * price).toFixed(6) : '0.000000'
          });
        }
      });

      return Array.from(map.values());
    });

    // write debug file (raw results)
    // fs.writeFileSync(DEBUG_PATH, JSON.stringify({ timestamp: new Date().toISOString(), rawCount: raw.length, raw }, null, 2), 'utf8');
    // console.log(`Saved debug dump to ${DEBUG_PATH}`);

    // filter EU Central, using case-insensitive match
    euServerData = raw.filter(r => /EU Central/i.test(r.server));

    console.log('Scraped EU Central data:', euServerData);

  } catch (err) {
    console.error('Scraping error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

// run at start and every 30 minutes
scrapeG2G();
cron.schedule('*/30 * * * *', scrapeG2G);

app.get('/api/prices', (req, res) => res.json(euServerData));
app.get('/test', (req, res) => res.send('Server running'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
