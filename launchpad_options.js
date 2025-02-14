const Alpaca = require('@alpacahq/alpaca-trade-api');
const axios = require('axios');
require('dotenv').config();

// Alpaca API Setup
const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY_OPTIONS_1,
  secretKey: process.env.ALPACA_SECRET_KEY_OPTIONS_1,
  paper: true // Set to false for live trading
});

const ALPACA_API_KEY = process.env.ALPACA_API_KEY_OPTIONS_1;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY_OPTIONS_1;
const DATA_BASE_URL = 'https://paper-api.alpaca.markets/v1beta1/options';

const CHECK_INTERVAL = 2 * 60 * 1000; // Every 2 minutes
const WEEKLY_INTERVAL = 3 * 24 * 60 * 60 * 1000; // Every 3 days

let remainingBudget = 5000; // Initial budget for option trading
const STOCKS_TO_MONITOR = 5; // Number of high-volume stocks to track
let isTrading = false;
let monitoredStocks = [];
let optionsTradingEnabled = false; // Flag to check options trading access

// ✅ Check if options trading is enabled in the account
async function checkAccountDetails() {
  try {
    const account = await alpaca.getAccount();
    console.log('Account details:', JSON.stringify(account, null, 2));

    // Check if options trading is enabled
    if (account.options_trading_enabled) {
      optionsTradingEnabled = true;
      console.log("✅ Options trading is enabled.");
    } else {
      console.log("🚨 Options trading is NOT enabled on this account. Exiting.");
      process.exit(1); // Stop execution if options trading is not allowed
    }
  } catch (error) {
    console.error('Error fetching account details:', error.response?.data || error.message);
    process.exit(1); // Exit if unable to fetch account details
  }
}

// Fetch high-volume stocks
async function getHighVolumeStocks() {
  try {
    const response = await axios.get('https://financialmodelingprep.com/api/v3/stock_market/actives', {
      params: { apikey: process.env.FMP_API_KEY },
      timeout: 5000
    });

    const topSymbols = response.data.slice(0, STOCKS_TO_MONITOR).map(stock => stock.symbol);
    console.log("Monitored Stocks:", topSymbols);
    return topSymbols;
  } catch (error) {
    console.error('Error fetching high-volume stocks:', error);
    return [];
  }
}

// Fetch available option contracts for a given stock
async function getOptionsContracts(symbol) {
  try {
    const response = await axios.get(`${DATA_BASE_URL}/contracts`, {
      headers: {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
      },
      params: { underlying: symbol, status: 'active' }
    });

    console.log(`Raw response for ${symbol}:`, JSON.stringify(response.data, null, 2));

    if (!response.data || !response.data.contracts) {
      console.log(`No options data found for ${symbol}`);
      return [];
    }

    return response.data.contracts;
  } catch (error) {
    console.error(`Error fetching options for ${symbol}:`, error.response?.data || error.message);
    return [];
  }
}

// Fetch the latest option price
async function getOptionPrice(optionSymbol) {
  try {
    const response = await axios.get(`${DATA_BASE_URL}/quotes`, {
      headers: {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
      },
      params: { symbols: optionSymbol }
    });

    if (!response.data || !response.data.quotes[optionSymbol]) {
      console.log(`No price data for ${optionSymbol}`);
      return null;
    }

    return response.data.quotes[optionSymbol].ask_price;
  } catch (error) {
    console.error(`Error fetching price for ${optionSymbol}:`, error);
    return null;
  }
}

// Execute option trade
async function tradeOptions() {
  if (!(await alpaca.getClock()).is_open) {
    console.log('Market is closed. Skipping trade cycle.');
    return;
  }

  if (!optionsTradingEnabled) {
    console.log("🚨 Skipping trade: Options trading is NOT enabled.");
    return;
  }

  if (isTrading) {
    console.log("🚨 Trade cycle already running. Skipping execution.");
    return;
  }

  isTrading = true;
  remainingBudget = parseFloat((await alpaca.getAccount()).buying_power);
  console.log(`Running trade cycle... Remaining Budget: $${remainingBudget}`);

  for (const stock of monitoredStocks) {
    const options = await getOptionsContracts(stock);
    if (!options.length) continue;

    const selectedOption = options.find(opt => opt.strike_price > 0 && opt.option_type === 'call');
    if (!selectedOption) continue;

    const optionSymbol = selectedOption.symbol;
    const optionPrice = await getOptionPrice(optionSymbol);

    if (!optionPrice || optionPrice > remainingBudget) continue;

    console.log(`Attempting to buy ${optionSymbol} at $${optionPrice}`);

    try {
      await alpaca.createOrder({
        symbol: optionSymbol,
        qty: 1,
        side: 'buy',
        type: 'market',
        time_in_force: 'gtc',
      });

      remainingBudget -= optionPrice;
      console.log(`Bought 1 contract of ${optionSymbol} at $${optionPrice}`);
    } catch (error) {
      console.error(`🚨 Buy order failed for ${optionSymbol}:`, error.response?.data || error.message);
    }

    // Sell condition: If price increases by 20%
    const sellPrice = optionPrice * 1.20;
    console.log(`Setting sell condition for ${optionSymbol} at $${sellPrice}`);

    setTimeout(async () => {
      const currentPrice = await getOptionPrice(optionSymbol);
      if (currentPrice && currentPrice >= sellPrice) {
        try {
          await alpaca.createOrder({
            symbol: optionSymbol,
            qty: 1,
            side: 'sell',
            type: 'market',
            time_in_force: 'gtc',
          });

          remainingBudget += currentPrice;
          console.log(`Sold 1 contract of ${optionSymbol} at $${currentPrice}`);
        } catch (error) {
          console.error(`🚨 Sell order failed for ${optionSymbol}:`, error.response?.data || error.message);
        }
      }
    }, 5 * 60 * 1000); // Check again in 5 minutes
  }

  isTrading = false;
}

// Scheduled trading function
async function checkMarketAndTrade() {
  const clock = await alpaca.getClock();
  if (clock.is_open) {
    console.log('Executing trade cycle during market hours.');
    tradeOptions();
  } else {
    console.log('Market is closed. Skipping trade cycle.');
  }
}

// Update stocks weekly and trade daily
async function weekTrade() {
  monitoredStocks = await getHighVolumeStocks();
  console.log('Updated monitored stocks:', monitoredStocks);
  checkMarketAndTrade();
}

// Start trading automation
async function startTrading() {
  await checkAccountDetails(); // ✅ Check account details before starting trades

  monitoredStocks = await getHighVolumeStocks();
  console.log('Monitoring stocks:', monitoredStocks);

  setInterval(async () => {
    await weekTrade();
  }, WEEKLY_INTERVAL);

  setInterval(async () => {
    await checkMarketAndTrade();
  }, CHECK_INTERVAL);

  await weekTrade();
}

// Start trading
startTrading();
