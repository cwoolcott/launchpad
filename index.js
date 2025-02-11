const Alpaca = require('@alpacahq/alpaca-trade-api');
const axios = require('axios');
require('dotenv').config();

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true, // Set to false for live trading
});

const STOCKS_TO_MONITOR = process.env.STOCKS_TO_MONITOR || 10; // Number of high-volume stocks to monitor
const CHECK_INTERVAL =  15 * 60 * 1000; // 30 minutes in milliseconds
const WEEKLY_INTERVAL =  3 * 24 * 60 * 60 * 1000; // One week in milliseconds
let monitoredStocks = [];

async function getHighVolumeStocks() {
   

  try {
    const response = await axios.get('https://financialmodelingprep.com/api/v3/stock_market/actives', {
      params: { apikey: process.env.FMP_API_KEY },
      timeout: 5000
    });
    
    return response.data.slice(0, STOCKS_TO_MONITOR).map(stock => stock.symbol);
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.warn('Rate limit exceeded. Retrying in 60 seconds...');
      await new Promise(resolve => setTimeout(resolve, 60000));
      return getHighVolumeStocks();
    }
    console.error('Error fetching high-volume stocks:', error);
    return [];
  }
}

async function getCurrentPositions() {
  try {
    const positions = await alpaca.getPositions();
    return positions.map(position => ({ symbol: position.symbol, qty: parseInt(position.qty) }));
  } catch (error) {
    console.error('Error fetching positions:', error);
    return [];
  }
}

async function getStockPrice(symbol) {
  try {
    const barset = await alpaca.getBars('minute', symbol, { limit: 1 });
    return barset[symbol][0].c;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    return null;
  }
}

async function tradeStocks() {
  if (!(await alpaca.getClock()).is_open) {
    console.log('Market is closed. Skipping trade cycle.');
    return;
  }
  console.log('Running trade cycle...');
  
  const positions = await getCurrentPositions();
  
  for (const stock of monitoredStocks) {
    const price = await getStockPrice(stock);
    if (!price) continue;
    
    const position = positions.find(pos => pos.symbol === stock);
    const riskFactor = 2; // Aggressive strategy multiplier
    const tradeAmount = Math.max(10, Math.floor((1000 / price) * riskFactor));
    
    if (position) {
      // Sell if price increased by 5% (aggressive strategy)
      const buyPrice = position.avg_entry_price;
      if (price >= buyPrice * 1.05) {
        console.log(`Selling ${position.qty} shares of ${stock} at $${price}`);
        await alpaca.createOrder({
          symbol: stock,
          qty: position.qty,
          side: 'sell',
          type: 'market',
          time_in_force: 'gtc',
        });
      }
    } else {
      // Buy if price is low (simple naive strategy)
      console.log(`Buying ${tradeAmount} shares of ${stock} at $${price}`);
      await alpaca.createOrder({
        symbol: stock,
        qty: tradeAmount,
        side: 'buy',
        type: 'market',
        time_in_force: 'gtc',
      });
    }
  }
}

async function checkMarketAndTrade() {
    const clock = await alpaca.getClock();
    if (clock.is_open) {
        console.log('Executing trade cycle during market hours.');
        tradeStocks();
    } else {
        console.log('Market is closed. Skipping trade cycle.');
    }
}

async function checkMarketAndUpdateStocks() {
    const clock = await alpaca.getClock();
    if (!clock.is_open) {
        console.log('Market is closed. Skipping weekly stock update.');
        return;
    }
    monitoredStocks = await getHighVolumeStocks();
    console.log('Updated monitored stocks:', monitoredStocks);
    checkMarketAndTrade();
}

async function startTrading() {

  monitoredStocks = await getHighVolumeStocks();
  console.log('Monitoring stocks:', monitoredStocks);

  setInterval(async () => {
    const clock = await alpaca.getClock();
    checkMarketAndTrade();
    if (!clock.is_open) {
        console.log('Market is closed. Skipping weekly stock update.');
        return;
    }
    monitoredStocks = await getHighVolumeStocks();
    console.log('Updated monitored stocks:', monitoredStocks);

    if (clock.is_open) {
        console.log('Executing trade cycle during market hours.');
        await tradeStocks();
    } else {
        console.log('Market is closed. Skipping trade cycle.');
    }
}, CHECK_INTERVAL);
}
  setInterval(async () => {
    checkMarketAndUpdateStocks();
    const clock = await alpaca.getClock();
    if (!clock.is_open) {
        console.log('Market is closed. Skipping weekly stock update.');
        return;
    }
    monitoredStocks = await getHighVolumeStocks();
    console.log('Updated monitored stocks:', monitoredStocks);
    if (clock.is_open) {

    console.log('Executing trade cycle during market hours.');
    await tradeStocks();
    } else {
        console.log('Market is closed. Skipping weekly trade cycle.');
    }

    console.log('Updated monitored stocks:', monitoredStocks);
  }, WEEKLY_INTERVAL);


startTrading();

