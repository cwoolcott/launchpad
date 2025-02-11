const Alpaca = require('@alpacahq/alpaca-trade-api');
const axios = require('axios');
require('dotenv').config();

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true // Set to false for live trading
});

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

getBuyingPower();
