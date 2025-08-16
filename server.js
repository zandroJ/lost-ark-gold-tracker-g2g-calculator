const express = require("express");
const cors = require("cors");
const axios = require("axios"); // Replace Puppeteer with Axios
const cron = require("node-cron");

const app = express();
app.use(cors());

// Get your API key from scraperapi.com dashboard
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;
const SCRAPER_API_URL = `https://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=`;

let euServerData = [];

async function scrapeG2G() {
  try {
    console.log("🚀 Starting G2G scrape via ScraperAPI...");
    
    // Target URL with query parameters
    const targetUrl = encodeURIComponent(
      "https://www.g2g.com/categories/lost-ark-gold?q=eu"
    );

    // Fetch page via ScraperAPI
    const response = await axios.get(`${SCRAPER_API_URL}${targetUrl}`, {
      timeout: 30000
    });
    
    // Extract offer data from HTML
    const offers = extractOfferData(response.data);
    
    euServerData = processOffers(offers);
    console.log(`✅ Scraped ${euServerData.length} servers`);
    
  } catch (err) {
    console.error("❌ Scraping error:", err);
  }
}

// HTML parsing function
function extractOfferData(html) {
  const offers = [];
  
  // Basic regex to find offer sections
  const offerRegex = /<div[^>]*class="[^"]*sell-offer-card[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let match;
  
  while ((match = offerRegex.exec(html)) {
    const offerHtml = match[1];
    const text = offerHtml.replace(/<[^>]*>/g, " "); // Remove HTML tags
    
    // Extract data using more flexible regex
    const serverMatch = text.match(/(EU Central[^|]+)/i);
    const priceMatch = text.match(/(\d+\.\d+)\s*USD/i);
    const offersMatch = text.match(/(\d+)\s+offers?/i);
    
    if (serverMatch && priceMatch) {
      offers.push({
        server: serverMatch[1].trim(),
        priceUSD: parseFloat(priceMatch[1]),
        offers: offersMatch ? parseInt(offersMatch[1], 10) : 1
      });
    }
  }
  
  return offers;
}

// Process and group offers
function processOffers(offers) {
  const serverMap = new Map();
  
  offers.forEach(offer => {
    const serverName = offer.server.replace("EU Central -", "").trim();
    
    if (!serverMap.has(serverName)) {
      serverMap.set(serverName, {
        server: serverName,
        priceUSD: offer.priceUSD,
        offers: 0
      });
    }
    
    const serverData = serverMap.get(serverName);
    serverData.offers += offer.offers;
    
    // Keep the lowest price
    if (offer.priceUSD < serverData.priceUSD) {
      serverData.priceUSD = offer.priceUSD;
    }
  });
  
  // Convert to array and calculate value
  return Array.from(serverMap.values()).map(server => ({
    ...server,
    valuePer100k: (100000 * server.priceUSD).toFixed(6)
  }));
}

// Routes (unchanged)
app.get("/", (req, res) => {
  res.send("✅ Lost Ark Gold Tracker backend is running. Use /api/prices");
});

app.get("/api/prices", (req, res) => {
  if (!euServerData.length) {
    return res.json({ message: "No server data available. Try again later." });
  }
  res.json({
    lastUpdated: new Date(),
    servers: euServerData,
  });
});

// Schedule scraper
cron.schedule("*/30 * * * *", scrapeG2G);
scrapeG2G(); // Initial run

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));