the deployment seemed successful, however it is not fetching any servers:
ok the deployment seemed successful. but when i go to the backend server link which is here https://lost-ark-gold-tracker-g2g-calculator.onrender.com/api/prices.. it has nothing:
so i went to back to the main website which is here: https://lost-ark-gold-tracker-g2g-calculator.onrender.com/
and it says "CANNOT GET /"
whats going on?

moreoever when i went to the frontend link which is:https://lost-ark-gold-tracker-g2g-calculator-1.onrender.com/

its not fetching and servers.....

can u check whats causing this issue?
this is my server.js:
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

my goldtracker.js:
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const GoldTracker = () => {
  const [servers, setServers] = useState([]);
  const [goldAmount, setGoldAmount] = useState(10000);
  const [displayGold, setDisplayGold] = useState("10,000");
  const [selectedServer, setSelectedServer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Format numbers with commas
  const formatNumber = (num) => {
    if (!Number.isFinite(num)) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  // Helper: safely parse a price-like value to a Number
  const parsePrice = (v) => {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    const cleaned = String(v).replace(/[^\d.,-]/g, '').replace(',', '.');
    return parseFloat(cleaned);
  };

  // Handle gold input with commas
  const handleGoldChange = (e) => {
    const value = e.target.value.replace(/,/g, '');
    const numValue = value === '' ? 0 : parseInt(value, 10) || 0;
    
    setGoldAmount(numValue);
    setDisplayGold(formatNumber(numValue));
  };

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get('https://lost-ark-gold-tracker-g2g-calculator.onrender.com/api/prices');
        if (!mounted) return;

        // Ensure it's an array
        const data = Array.isArray(response.data) ? response.data : [];

        // Normalize and sort by numeric price
        const normalized = data.map(d => {
          const price = parsePrice(d.priceUSD);
          return {
            server: d.server || '',
            offers: Number.isFinite(Number(d.offers)) ? Number(d.offers) : 0,
            priceUSD: Number.isFinite(price) ? price : 0
          };
        });

        normalized.sort((a, b) => {
          const pa = a.priceUSD > 0 ? a.priceUSD : Number.POSITIVE_INFINITY;
          const pb = b.priceUSD > 0 ? b.priceUSD : Number.POSITIVE_INFINITY;
          return pa - pb;
        });

        setServers(normalized);

        // Set default server
        const firstValid = normalized.find(s => s.priceUSD > 0);
        setSelectedServer(firstValid || normalized[0] || null);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Could not fetch server prices.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 300000); // refresh every 5 minutes
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Calculate values
  const goldNumber = Number(goldAmount) || 0;
  const price = selectedServer ? Number(selectedServer.priceUSD || 0) : 0;

  const calculateValue = () => {
    if (!selectedServer || price <= 0 || goldNumber <= 0) return 0;
    return goldNumber * price;
  };

  const formatCurrency = (value) => {
    if (value === 0) return '$0';
    if (!value) return 'N/A';
    
    // Format to whole number if possible, otherwise 2 decimals
    const rounded = Math.round(value * 100) / 100;
    if (rounded % 1 === 0) {
      return `$${formatNumber(rounded)}`;
    }
    return `$${rounded.toFixed(2)}`;
  };

  const conversions = [10000, 50000, 100000, 500000].map(amount => ({
    amount,
    value: (price > 0 ? amount * price : 0)
  }));

  return (
    <div className="gold-tracker">
      <div className="app-header">
        <h1>Lost Ark Gold Value Calculator</h1>
        <div className="header-decoration"></div>
      </div>

      <div className="calculator-container">
        <div className="input-section">
          <div className="input-card">
            <div className="card-icon">
              <div className="gold-icon">G</div>
            </div>
            <h3>Your Gold Amount</h3>
            <div className="input-group">
              <input
                type="text"
                value={displayGold}
                onChange={handleGoldChange}
                style={{ padding: 12, fontSize: 16 }}
              />
              <div className="input-decoration"></div>
            </div>
          </div>
        </div>

        <div className="server-selection">
          <h2>Select Server</h2>
          {loading && <div className="loading-indicator">Loading servers…</div>}
          {error && <div className="error-message">{error}</div>}
          {!loading && servers.length === 0 && <div>No servers found.</div>}

          {!loading && servers.length > 0 && (
            <div className="servers-grid">
              {servers.map(server => {
                const isActive = selectedServer && selectedServer.server === server.server;
                return (
                  <div
                    key={server.server || Math.random()}
                    onClick={() => setSelectedServer(server)}
                    className={`server-card ${isActive ? 'active' : ''}`}
                  >
                    <div className="card-header">
                      <div className="server-name">{server.server.split('-')[0].trim()}</div>
                      <div className={`server-status ${isActive ? 'active' : ''}`}>
                        {isActive ? 'SELECTED' : 'AVAILABLE'}
                      </div>
                    </div>
                    
                    <div className="server-details">
                      <div className="detail-row">
                        <span>Price:</span>
                        <span>{server.priceUSD > 0 ? `$${server.priceUSD.toFixed(6)}/gold` : 'N/A'}</span>
                      </div>
                      <div className="detail-row">
                        <span>Offers:</span>
                        <span>{server.offers}</span>
                      </div>
                      <div className="detail-row">
                        <span>100k Gold:</span>
                        <span>{server.priceUSD > 0 ? formatCurrency(100000 * server.priceUSD) : 'N/A'}</span>
                      </div>
                    </div>
                    
                    <div className="card-footer"></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="results-section">
          <div className="results-card">
            <h2>Gold Value</h2>
            
            <div className="result-row">
              <span className="result-label">Selected Server:</span>
              <span className="result-value">{selectedServer ? selectedServer.server : 'None'}</span>
            </div>
            
            <div className="result-row highlight">
              <span className="result-label">Market Value:</span>
              <span className="result-value">
                {price > 0 ? formatCurrency(calculateValue()) : 'N/A'}
              </span>
            </div>
            
            <div className="conversion-section">
              <h3>Common Conversions</h3>
              <div className="conversion-grid">
                {conversions.map(c => (
                  <div key={c.amount} className="conversion-card">
                    <div className="conversion-amount">{formatNumber(c.amount)} gold</div>
                    <div className="conversion-arrow">→</div>
                    <div className="conversion-value">{price > 0 ? formatCurrency(c.value) : 'N/A'}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* <div className="app-footer">
        <p>Enjoy! And if you desire, make a donation to support me to continue updating this project.</p>
      </div> */}
    </div>
  );
};

export default GoldTracker;