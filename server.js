// server.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();

// Configure CORS
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://lost-ark-backend-production.up.railway.app' 
    : '*'
};
app.use(cors(corsOptions));

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
    console.log('🚀 Launching Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || null
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1280, height: 900 });

    console.log('🌍 Navigating to G2G...');
    await page.goto('https://www.g2g.com/categories/lost-ark-gold?q=eu', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for cards to load
    await page.waitForSelector('div[class*="col-sm-6"]', { timeout: 60000 });

    // Scroll to trigger lazy load
    await autoScroll(page);

    // Give sellers extra time
    await new Promise(r => setTimeout(r, 10000));

    // Save debug artifacts
    await page.screenshot({ path: 'debug.png', fullPage: true });
    const html = await page.content();
    fs.writeFileSync('debug.html', html);

    // Scrape data - fixed logic
    const raw = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('div[class*="col-sm-6"]');
      
      cards.forEach(card => {
        const serverElement = card.querySelector('div.text-body1 span');
        if (!serverElement) return;
        
        const server = serverElement.textContent.trim();
        
        let price = 0;
        const priceElement = card.querySelector('div.row.items-baseline > div > span:not(.text-font-2nd)');
        if (priceElement) {
          price = parseFloat(priceElement.textContent.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
        }
        
        let offers = 0;
        const offersElement = card.querySelector('.g-chip-counter');
        if (offersElement) {
          offers = parseInt(offersElement.textContent.replace(/\D/g, '')) || 0;
        }
        
        results.push({
          server,
          offers,
          priceUSD: price,
          valuePer100k: price ? (100000 * price).toFixed(6) : '0.000000'
        });
      });
      
      return results;
    });

    // Filter for EU Central servers
    euServerData = raw.filter(r => 
      r.server && /EU Central/i.test(r.server) && r.priceUSD > 0
    );
    
    console.log(`✅ Scraped ${euServerData.length} EU servers`);
    console.log('Sample data:', euServerData.slice(0, 3));

  } catch (err) {
    console.error('❌ Scraping error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

// Run immediately + schedule every 30 min
scrapeG2G();
cron.schedule('*/30 * * * *', scrapeG2G);

// API routes
app.get('/api/prices', (req, res) => {
  if (euServerData.length > 0) {
    res.json({ lastUpdated: new Date(), servers: euServerData });
  } else {
    res.status(503).json({ message: 'No server data available', servers: [] });
  }
});

// Debug endpoints
app.get('/debug/screenshot', (req, res) => {
  const filePath = path.join(__dirname, 'debug.png');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Screenshot not found');
  }
});

app.get('/debug/html', (req, res) => {
  const filePath = path.join(__dirname, 'debug.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('HTML not found');
  }
});

// Serve a simple HTML frontend
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Lost Ark Gold Tracker</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
               background: linear-gradient(135deg, #1a2a6c, #2a4d69); color: white; 
               min-height: 100vh; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { text-align: center; padding: 2rem 0; }
        h1 { font-size: 2.5rem; margin-bottom: 1rem; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
        .subtitle { font-size: 1.2rem; opacity: 0.8; max-width: 600px; margin: 0 auto; }
        
        .dashboard { display: grid; grid-template-columns: 1fr; gap: 2rem; margin-top: 2rem; }
        @media (min-width: 768px) {
          .dashboard { grid-template-columns: 1fr 1fr; }
        }
        
        .card { background: rgba(255, 255, 255, 0.1); 
                backdrop-filter: blur(10px); border-radius: 16px; 
                padding: 2rem; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); 
                border: 1px solid rgba(255, 255, 255, 0.18); }
        .card h2 { margin-bottom: 1.5rem; font-size: 1.8rem; color: #f8c630; }
        
        .status { display: flex; justify-content: space-between; }
        .status-item { text-align: center; }
        .status-value { font-size: 2rem; font-weight: bold; color: #4cd964; }
        .status-label { opacity: 0.7; }
        
        .servers { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }
        .server-card { background: rgba(0, 0, 0, 0.2); padding: 1rem; border-radius: 8px; }
        .server-name { font-weight: bold; font-size: 1.2rem; }
        .server-price { color: #f8c630; font-size: 1.1rem; }
        
        footer { text-align: center; margin-top: 3rem; opacity: 0.7; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>Lost Ark Gold Tracker</h1>
          <p class="subtitle">Track gold prices across EU Central servers in real time</p>
        </header>
        
        <div class="dashboard">
          <div class="card">
            <h2>System Status</h2>
            <div class="status">
              <div class="status-item">
                <div class="status-value" id="serverCount">0</div>
                <div class="status-label">Servers Tracked</div>
              </div>
              <div class="status-item">
                <div class="status-value" id="lastUpdated">-</div>
                <div class="status-label">Last Updated</div>
              </div>
            </div>
          </div>
          
          <div class="card">
            <h2>API Endpoints</h2>
            <ul>
              <li><a href="/api/prices" style="color: #64d2ff;">/api/prices</a> - Get current gold prices</li>
              <li><a href="/debug/screenshot" style="color: #64d2ff;">/debug/screenshot</a> - Latest scrape screenshot</li>
              <li><a href="/debug/html" style="color: #64d2ff;">/debug/html</a> - Latest scrape HTML</li>
            </ul>
          </div>
        </div>
        
        <div class="card">
          <h2>Tracked Servers</h2>
          <div class="servers" id="serversContainer">
            <div class="server-card">
              <div class="server-name">Loading server data...</div>
            </div>
          </div>
        </div>
        
        <footer>
          <p>Backend is running smoothly. Use the API to integrate with your application.</p>
        </footer>
      </div>
      
      <script>
        async function fetchData() {
          try {
            const response = await fetch('/api/prices');
            const data = await response.json();
            
            // Update status
            document.getElementById('serverCount').textContent = data.servers.length;
            document.getElementById('lastUpdated').textContent = 
              new Date(data.lastUpdated).toLocaleTimeString();
            
            // Update servers list
            const container = document.getElementById('serversContainer');
            container.innerHTML = '';
            
            if (data.servers.length === 0) {
              container.innerHTML = '<div class="server-card">No server data available</div>';
              return;
            }
            
            data.servers.forEach(server => {
              const card = document.createElement('div');
              card.className = 'server-card';
              card.innerHTML = \`
                <div class="server-name">\${server.server}</div>
                <div class="server-price">
                  \${server.priceUSD ? '$' + server.priceUSD.toFixed(6) + '/gold' : 'N/A'} 
                  • \${server.offers} offers
                </div>
                <div>100k Gold: \${server.priceUSD ? '$' + (100000 * server.priceUSD).toFixed(2) : 'N/A'}</div>
              \`;
              container.appendChild(card);
            });
          } catch (error) {
            console.error('Error fetching data:', error);
            document.getElementById('serversContainer').innerHTML = 
              '<div class="server-card">Error loading server data</div>';
          }
        }
        
        // Fetch data on load and every 2 minutes
        fetchData();
        setInterval(fetchData, 120000);
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));