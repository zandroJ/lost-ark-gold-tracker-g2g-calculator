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
        const response = await axios.get('https://your-render-app.onrender.com/api/prices');
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