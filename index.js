const Alpaca = require('@alpacahq/alpaca-trade-api');
const axios = require('axios');
require('dotenv').config();

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true // Set to false for live trading
});

const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const DATA_BASE_URL = 'https://data.alpaca.markets/v2/stocks';

const CHECK_INTERVAL =  2 * 60 * 1000; // 15 minutes in milliseconds
const WEEKLY_INTERVAL =  3 * 24 * 60 * 60 * 1000; // One week in milliseconds

let remainingBudget = 5000; // Track remaining funds

const STOCKS_TO_MONITOR = 5; // Number of high-volume stocks to monitor

let isTrading = false;
let monitoredStocks = [];

const restClient = alpaca.rest || new Alpaca().rest;
const marketData = alpaca.data;

async function safeAxiosRequest(url, params = {}, description = "API request", retries = 3, delay = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
      try {
          const response = await axios.get(url, { params, timeout: 15000 });
          return response.data;
      } catch (error) {
          console.error(`🚨 Error fetching ${description} (Attempt ${attempt}/${retries}):`, error.message);
          if (error.response?.status === 429) {
              console.warn('⚠️ Rate limit exceeded. Retrying in 60 seconds...');
              await new Promise(resolve => setTimeout(resolve, 60000));
              continue;
          }
          if (error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND') {
              console.warn('🔁 Retrying in 5 seconds...');
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
          }
          return null;
      }
  }
  return null;
}

async function checkAccountStatus() {
  try {
    const account = await alpaca.getAccount();
    console.log("Account Status:", account.status);
    return account.status;
  } catch (error) {
    console.error("Error fetching account status:", error.response?.data || error.message);
    return null;
  }
}


async function getBuyingPower() {
  try {
    const account = await alpaca.getAccount();
    const buyingPower = parseFloat(account.buying_power);
    console.log(`Current Buying Power: $${buyingPower}`);
    return buyingPower;
  } catch (error) {
    console.error("Error fetching buying power:", error.response?.data || error.message);
    return 0; // Return 0 if API call fails
  }
}

async function getHighVolumeStocks() {
   

  // return [
  //   'BHAT', 'CYN',
  //   'OCEA', 'INAB'
  // ];
  try {
    const response = await axios.get('https://financialmodelingprep.com/api/v3/stock_market/actives', {
      params: { apikey: process.env.FMP_API_KEY },
      timeout: 5000
    });

    console.log("Financial Modeling Prep:");
    const top10Symbols = response.data.slice(0, STOCKS_TO_MONITOR).map(stock => stock.symbol);
    console.log("top10Symbols:", top10Symbols);
    return top10Symbols;
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
    //console.log('Current positions:', positions);
    
    return positions.map(position => ({ symbol: position.symbol, avg_entry_price: parseFloat(position.avg_entry_price), qty: parseInt(position.qty) }));
  } catch (error) {
    console.error('Error fetching positions:', error);
    return [];
  }
}


async function getStockPrice(symbol) {
  try {
    // const bars = await alpaca.getBars({
    //   symbols: [symbol], // Array of symbols
    //   timeframe: "1Min",
    //   limit: 1,
    // });
    //const bars = await alpaca.rest.getBars("1Min", symbol, { limit: 1 });
    //const bars = await alpaca.getBars("1Min", symbol, { limit: 1, feed: "iex" });
    const response = await axios.get(`${DATA_BASE_URL}/${symbol}/bars`, {
      headers: {
          'APCA-API-KEY-ID': ALPACA_API_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
      },
      params: { timeframe: '15Min', limit: 1 },
  });

  if (!response.data?.bars || response.status !== 200) {
    console.log(error.response?.data );
    process.exit();
  }
    let bars = response.data.bars;


    if (bars && bars.length > 0) {
      return bars[0].c; // Closing price
    } else {
      console.error(`No data available for ${symbol}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    return null;
  }
}


async function tradeStocks() {
  const clock = await safeAlpacaRequest(() => alpaca.getClock(), "market clock");
  if (!clock || !clock.is_open) {
    console.log('Market is closed. Skipping trade cycle.');
    return;
  }

  if (isTrading) {
    console.log("🚨 Trade cycle already running. Skipping this execution.");
    return;
  }
  
  isTrading = true;

  const accountStatus = await checkAccountStatus();
  remainingBudget = await getBuyingPower();
  console.log(accountStatus);

  console.log(`Running trade cycle... Remaining Budget: $${remainingBudget}`);
  
  const positions = await getCurrentPositions();
  const processedStocks = new Set();

  for (const stock of monitoredStocks) {
    if (processedStocks.has(stock)) continue; // ✅ Skip duplicates
    processedStocks.add(stock); // ✅ Mark stock as processed

    const price = await getStockPrice(stock);
    console.log(`Price of ${stock}: $${price}`);
    if (!price) continue;
    console.log("---1---");
    const position = positions.find(pos => pos.symbol === stock);
    console.log("---pos---", position);
    // Ensure we do not exceed the remaining budget
    const maxShares = Math.floor(remainingBudget / price);

    if (maxShares <= 0) {
      console.log(`Skipping ${stock}: Not enough funds (Remaining Budget: $${remainingBudget})`);
      continue;
    }
    // Calculate how many shares can be bought within the budget

    //const riskFactor = 2; // Aggressive strategy multiplier
    //const tradeAmount = Math.min(maxShares, Math.max(10, Math.floor((1000 / price) * riskFactor)));
    const tradeAmount = Math.min(maxShares, Math.max(10, Math.floor(remainingBudget * 0.1 / price)));

    console.log("---tradeAmount---", tradeAmount);
    if (position) {
      // Sell if price increased by 5% (aggressive strategy)

      const buyPrice = parseFloat(position.avg_entry_price); // Ensure it's a number
      console.log("price >= buyPrice", price, ">=", buyPrice);
      if (price >= buyPrice * 1.03) { //3%
        console.log(`Selling ${position.qty} shares of ${stock} at $${price}`);
        
        try {
          await alpaca.createOrder({
            symbol: stock,
            qty: position.qty,
            side: 'sell',
            type: 'market',
            time_in_force: 'gtc',
          });
          remainingBudget += position.market_value;
          console.log(`Successfully sold ${position.qty} shares of ${stock} at $${price}`);
        } catch (error) {
          console.error(`🚨 Sell order failed for ${stock}:`, error.response?.data || error.message); // ✅ Log API response
        }

        

      }
    } else if (tradeAmount > 0) {
      // Buy stock while staying within budget
      const cost = tradeAmount * price;
      if (cost > remainingBudget) {
        console.log(`Skipping ${stock}: Cannot afford ${tradeAmount} shares (Cost: $${cost}, Remaining: $${remainingBudget})`);
        continue;
      }

      console.log(`Buying ${tradeAmount} shares of ${stock} at $${price}, staying within $${remainingBudget} budget.`);
      
      
      try {
        await alpaca.createOrder({
          symbol: stock,
          qty: tradeAmount,
          side: 'buy',
          type: 'market',
          time_in_force: 'gtc',
        });
  
        remainingBudget -= cost;
        console.log(`Successfully Bought ${position.qty} shares of ${stock} at $${price}`);
      } catch (error) {
        console.error(`🚨 Buy order failed for ${stock}:`, error.response?.data || error.message); // ✅ Log API response
      }
      
      
    }
    else{
      console.log(`Skipping ${stock}:`);
      console.log("price >= buyPrice", price, ">=", buyPrice);
      console.log("tradeAmount", tradeAmount);
    }
  }
  isTrading = false;
}

async function checkMarketAndTrade() {
    const clock = await safeAlpacaRequest(() => alpaca.getClock(), "market clock");
    if (clock && clock.is_open) {
        console.log('Executing trade cycle during market hours.');
        tradeStocks();
    } else {
        console.log('Market is closed. Skipping trade cycle.');
    }
}

async function checkMarketAndUpdateStocks() {
    const clock = await safeAlpacaRequest(() => alpaca.getClock(), "market clock");
    if (!clock || !clock.is_open) {
        console.log('Market is closed. Skipping weekly stock update.');
        return;
    }
    monitoredStocks = await getHighVolumeStocks();
    console.log('Updated monitored stocks:', monitoredStocks);
    checkMarketAndTrade();
}

async function dayTrade() {

    checkMarketAndTrade();
    const clock = await safeAlpacaRequest(() => alpaca.getClock(), "market clock");
    if (!clock || !clock.is_open) {
        console.log('Market is closed. Skipping weekly stock update.');
        return;
    }
    monitoredStocks = await getHighVolumeStocks();
    console.log('Updated monitored stocks:', monitoredStocks);

    if (clock || clock.is_open) {
        console.log('Executing trade cycle during market hours.');
        await tradeStocks();
    } else {
        console.log('Market is closed. Skipping trade cycle.');
    }
}

async function weekTrade() {
  checkMarketAndUpdateStocks();
  const clock = await safeAlpacaRequest(() => alpaca.getClock(), "market clock");
  if (!clock || !clock.is_open) {
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
}

async function startTrading() {

  monitoredStocks = await getHighVolumeStocks();
  console.log('Monitoring stocks:', monitoredStocks);

  setInterval(async () => {
    await weekTrade()
  }, WEEKLY_INTERVAL);
  
  await weekTrade();

  setInterval(async () => {
    await dayTrade();
  }, CHECK_INTERVAL);

  await dayTrade();
}
  


startTrading();

