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
const BUDGET = 5000;
let remainingBudget = BUDGET; // Track remaining funds

const STOCKS_TO_MONITOR = 5; // Number of high-volume stocks to monitor

let monitoredStocks = [];

const restClient = alpaca.rest || new Alpaca().rest;
const marketData = alpaca.data;


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
    return positions.map(position => ({ symbol: position.symbol, qty: parseInt(position.qty) }));
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
  if (!(await alpaca.getClock()).is_open) {
    console.log('Market is closed. Skipping trade cycle.');
    return;
  }

  console.log(`Running trade cycle... Remaining Budget: $${remainingBudget}`);
  
  const positions = await getCurrentPositions();
  
  for (const stock of monitoredStocks) {
    const price = await getStockPrice(stock);
    console.log(`Price of ${stock}: $${price}`);
    if (!price) continue;
    
    const position = positions.find(pos => pos.symbol === stock);
   
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

    if (position) {
      // Sell if price increased by 5% (aggressive strategy)

      const buyPrice = parseFloat(position.avg_entry_price); // Ensure it's a number
      if (price >= buyPrice * 1.03) { //3%
        console.log(`Selling ${position.qty} shares of ${stock} at $${price}`);
        await alpaca.createOrder({
          symbol: stock,
          qty: position.qty,
          side: 'sell',
          type: 'market',
          time_in_force: 'gtc',
        });
        remainingBudget += position.market_value;
      }
    } else if (tradeAmount > 0) {
      // Buy stock while staying within budget
      const cost = tradeAmount * price;
      if (cost > remainingBudget) {
        console.log(`Skipping ${stock}: Cannot afford ${tradeAmount} shares (Cost: $${cost}, Remaining: $${remainingBudget})`);
        continue;
      }

      console.log(`Buying ${tradeAmount} shares of ${stock} at $${price}, staying within $${remainingBudget} budget.`);
      await alpaca.createOrder({
        symbol: stock,
        qty: tradeAmount,
        side: 'buy',
        type: 'market',
        time_in_force: 'gtc',
      });

      // Deduct from budget
      remainingBudget -= cost;
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

async function dayTrade() {
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
}

async function weekTrade() {
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

