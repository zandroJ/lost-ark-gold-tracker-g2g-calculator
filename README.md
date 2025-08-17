# Lost Ark Gold Value Calculator

A full-stack web app that tracks **gold-to-USD conversion rates** for Lost Ark EU players by scraping live data from the official G2G marketplace.

## Features

- 💰 **Real-time gold price tracking** across EU servers(for now)
- 📊 **Server comparison** to find the best gold conversion rates
- ⚡ **Automatic refresh** every 5 minutes for up-to-date prices    
<!-- - 🔢 **Smart number formatting** with comma separators for large gold amounts   -->
<!-- - 💸 **Instant value calculation** for any gold amount  
- 📱 **Fully responsive design** that works on desktop and mobile  
- 🎨 **Authentic Lost Ark aesthetic** with dark theme and gold accents   -->


---

## How It Works

1. **Scraping** – The backend uses Puppeteer to scrape live marketplace prices for Lost Ark gold directly from G2G.  
2. **Processing** – Data is cleaned and formatted (server name, offer count, price per 100k gold).  
3. **API Endpoint** – The processed data is exposed at `/api/prices`.  
4. **Frontend Fetching** – The React frontend calls this endpoint and displays results in a clean, user-friendly interface.  
5. **Auto Refresh** – Prices are automatically refreshed every 5 minutes to stay current.  

---

## Tech Stack

### **Frontend**
- ⚛️ **React** – core framework for UI  
- 🎨 **CSS / custom styling** – responsive layouts and clean design  
- 📦 **Axios** – API requests from backend  
- 🔄 **React Hooks** (`useState`, `useEffect`) for state management  

### **Backend**
- 🟢 **Node.js** – server runtime  
- 🚀 **Express.js** – lightweight API server  
- 🕷️ **Cheerio** (or Puppeteer if you switched) – web scraping G2G marketplace  
- ⏱️ **node-cron** – scheduled scraping every 5 minutes  
- 🌐 **CORS** enabled for frontend-backend communication  

### **Deployment**
- ☁️ **Railway.app** – backend hosting  
- 🌍 **Render.com** – frontend hosting  

---

## Deployment Status
Frontend & backend are live, but deployment environments may still be under refinement.


 