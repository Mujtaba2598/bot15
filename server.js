const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Database
const database = {
    sessions: {},
    activeTrades: {}
};

// AI Trading Engine
class AITradingEngine {
    constructor() {
        this.performance = { totalTrades: 0, successfulTrades: 0, totalProfit: 0 };
    }

    analyzeMarket(symbol, marketData) {
        const { price = 0, volume24h = 0, priceChange24h = 0, high24h = 0, low24h = 0 } = marketData;
        
        const volatility = Math.abs(priceChange24h) / 100 || 0.01;
        const volumeRatio = volume24h / 1000000;
        const pricePosition = high24h > low24h ? (price - low24h) / (high24h - low24h) : 0.5;
        
        let confidence = 0.5;
        if (volumeRatio > 1.5) confidence += 0.1;
        if (volumeRatio > 2.0) confidence += 0.15;
        if (priceChange24h > 5) confidence += 0.15;
        if (priceChange24h > 10) confidence += 0.2;
        if (pricePosition < 0.3) confidence += 0.1;
        if (pricePosition > 0.7) confidence += 0.1;
        
        confidence = Math.min(confidence, 0.95);
        
        const action = (pricePosition < 0.3 && priceChange24h > -5 && volumeRatio > 1.2) ? 'BUY' :
                      (pricePosition > 0.7 && priceChange24h > 5 && volumeRatio > 1.2) ? 'SELL' : 
                      (Math.random() > 0.3 ? 'BUY' : 'SELL');
        
        return { symbol, price, confidence, action };
    }

    calculatePositionSize(initialInvestment, currentProfit, targetProfit, timeElapsed, timeLimit, confidence) {
        const timeRemaining = Math.max(0.1, (timeLimit - timeElapsed) / timeLimit);
        const remainingProfit = Math.max(1, targetProfit - currentProfit);
        const baseSize = Math.max(5, initialInvestment * 0.15);
        const timePressure = 1 / timeRemaining;
        const targetPressure = remainingProfit / (initialInvestment * 5);
        
        let positionSize = baseSize * timePressure * targetPressure * confidence;
        const maxPosition = initialInvestment * 2;
        positionSize = Math.min(positionSize, maxPosition);
        positionSize = Math.max(positionSize, 5);
        
        return positionSize;
    }
}

// REAL Binance API - USING API GATEWAY
class BinanceAPI {
    static baseUrl = 'https://api-gateway.binance.com';
    
    static async signRequest(queryString, secret) {
        return crypto
            .createHmac('sha256', secret)
            .update(queryString)
            .digest('hex');
    }

    static async makeRequest(endpoint, method, apiKey, secret, params = {}) {
        try {
            const timestamp = Date.now();
            const queryParams = { ...params, timestamp };
            const queryString = Object.keys(queryParams)
                .map(key => `${key}=${queryParams[key]}`)
                .join('&');
            
            const signature = await this.signRequest(queryString, secret);
            
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios({
                method,
                url,
                headers: { 'X-MBX-APIKEY': apiKey }
            });
            
            return response.data;
        } catch (error) {
            console.error('Binance API Error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.msg || error.message);
        }
    }

    static async getAccountBalance(apiKey, secret) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret);
            const usdtBalance = data.balances.find(b => b.asset === 'USDT');
            return {
                success: true,
                free: parseFloat(usdtBalance?.free || 0),
                locked: parseFloat(usdtBalance?.locked || 0),
                total: parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0)
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async getTicker(symbol) {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`);
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async placeMarketOrder(apiKey, secret, symbol, side, quoteOrderQty) {
        try {
            const orderData = await this.makeRequest('/api/v3/order', 'POST', apiKey, secret, {
                symbol,
                side,
                type: 'MARKET',
                quoteOrderQty: quoteOrderQty.toFixed(2)
            });
            
            return {
                success: true,
                orderId: orderData.orderId,
                executedQty: parseFloat(orderData.executedQty),
                price: parseFloat(orderData.fills?.[0]?.price || 0),
                data: orderData
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async verifyApiKey(apiKey, secret) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret);
            return {
                success: true,
                permissions: data.permissions,
                canTrade: data.canTrade,
                canWithdraw: data.canWithdraw,
                canDeposit: data.canDeposit
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

const app = express();
const aiEngine = new AITradingEngine();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Halal AI Trading Bot - REAL MONEY MODE with API Gateway',
        version: '5.0.0'
    });
});

app.post('/api/connect', async (req, res) => {
    const { email, accountNumber, apiKey, secretKey } = req.body;
    
    if (!apiKey || !secretKey) {
        return res.status(400).json({
            success: false,
            message: 'API key and secret are required'
        });
    }
    
    try {
        const verification = await BinanceAPI.verifyApiKey(apiKey, secretKey);
        
        if (!verification.success) {
            return res.status(401).json({
                success: false,
                message: `API verification failed: ${verification.error}`
            });
        }
        
        if (!verification.canTrade) {
            return res.status(403).json({
                success: false,
                message: 'API key does not have trading permission enabled. Please enable "Spot & Margin Trading" in Binance API settings.'
            });
        }
        
        const balance = await BinanceAPI.getAccountBalance(apiKey, secretKey);
        
        const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        database.sessions[sessionId] = {
            id: sessionId,
            email,
            accountNumber,
            apiKey,
            secretKey,
            connectedAt: new Date(),
            isActive: true,
            balance: balance.success ? balance.total : 0,
            permissions: verification.permissions
        };
        
        res.json({ 
            success: true, 
            sessionId,
            balance: balance.success ? balance.total : 0,
            accountInfo: { 
                balance: balance.success ? balance.total : 0,
                canTrade: verification.canTrade
            },
            message: '✅ Connected to REAL Binance account via API Gateway - Ready for real trading'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Connection failed: ' + error.message
        });
    }
});

app.post('/api/startTrading', async (req, res) => {
    const { sessionId, initialInvestment, targetProfit, timeLimit, riskLevel, tradingPairs } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session) {
        return res.status(401).json({
            success: false,
            message: 'Invalid session'
        });
    }
    
    const balanceCheck = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    if (!balanceCheck.success || balanceCheck.free < 10) {
        return res.status(400).json({
            success: false,
            message: 'Insufficient USDT balance. Need at least 10 USDT to trade.'
        });
    }
    
    const botId = 'bot_' + Date.now();
    database.activeTrades[botId] = {
        id: botId,
        sessionId,
        initialInvestment: parseFloat(initialInvestment) || 1,
        targetProfit: parseFloat(targetProfit) || 10,
        timeLimit: parseFloat(timeLimit) || 1,
        riskLevel: riskLevel || 'medium',
        tradingPairs: tradingPairs || ['BTCUSDT', 'ETHUSDT'],
        startedAt: new Date(),
        isRunning: true,
        currentProfit: 0,
        trades: [],
        totalRealizedProfit: 0
    };
    
    session.activeBot = botId;
    
    res.json({ 
        success: true, 
        botId, 
        message: `🔥 REAL TRADING ACTIVE! Target: $${parseFloat(targetProfit).toLocaleString()} in ${timeLimit} hour(s)`,
        balance: balanceCheck.free
    });
});

app.post('/api/stopTrading', (req, res) => {
    const { sessionId } = req.body;
    const session = database.sessions[sessionId];
    if (session?.activeBot) {
        database.activeTrades[session.activeBot].isRunning = false;
        session.activeBot = null;
    }
    res.json({ success: true, message: 'Trading stopped' });
});

app.post('/api/tradingUpdate', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session?.activeBot) {
        return res.json({ success: true, currentProfit: 0, newTrades: [] });
    }
    
    const trade = database.activeTrades[session.activeBot];
    if (!trade.isRunning) {
        return res.json({ success: true, currentProfit: trade.currentProfit, newTrades: [] });
    }
    
    const newTrades = [];
    const now = Date.now();
    
    const timeElapsed = (now - trade.startedAt) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, trade.timeLimit - timeElapsed);
    
    if (timeRemaining > 0) {
        const symbol = trade.tradingPairs[Math.floor(Math.random() * trade.tradingPairs.length)] || 'BTCUSDT';
        
        const tickerData = await BinanceAPI.getTicker(symbol);
        
        if (tickerData.success) {
            const marketPrice = parseFloat(tickerData.data.lastPrice);
            const marketData = {
                price: marketPrice,
                volume24h: parseFloat(tickerData.data.volume),
                priceChange24h: parseFloat(tickerData.data.priceChangePercent),
                high24h: parseFloat(tickerData.data.highPrice),
                low24h: parseFloat(tickerData.data.lowPrice)
            };
            
            const signal = aiEngine.analyzeMarket(symbol, marketData);
            
            if (signal.action !== 'HOLD') {
                const positionSize = aiEngine.calculatePositionSize(
                    trade.initialInvestment,
                    trade.currentProfit,
                    trade.targetProfit,
                    timeElapsed,
                    trade.timeLimit,
                    signal.confidence
                );
                
                const orderResult = await BinanceAPI.placeMarketOrder(
                    session.apiKey,
                    session.secretKey,
                    symbol,
                    signal.action,
                    positionSize
                );
                
                if (orderResult.success) {
                    const entryPrice = orderResult.price;
                    const currentPrice = marketPrice;
                    
                    let profit = 0;
                    if (signal.action === 'BUY') {
                        profit = (currentPrice - entryPrice) * orderResult.executedQty;
                    } else {
                        profit = (entryPrice - currentPrice) * orderResult.executedQty;
                    }
                    
                    trade.currentProfit += profit;
                    trade.totalRealizedProfit += profit;
                    
                    newTrades.push({
                        symbol: symbol,
                        side: signal.action,
                        quantity: orderResult.executedQty.toFixed(6),
                        price: entryPrice.toFixed(2),
                        profit: profit,
                        size: '$' + positionSize.toFixed(2),
                        orderId: orderResult.orderId,
                        timestamp: new Date().toISOString(),
                        real: true
                    });
                    
                    trade.trades.unshift(...newTrades);
                    
                    if (trade.currentProfit >= trade.targetProfit) {
                        trade.targetReached = true;
                        trade.isRunning = false;
                    }
                } else {
                    console.error('Order failed:', orderResult.error);
                }
            }
        }
    }
    
    if (timeElapsed >= trade.timeLimit) {
        trade.timeExceeded = true;
        trade.isRunning = false;
    }
    
    if (trade.trades.length > 50) {
        trade.trades = trade.trades.slice(0, 50);
    }
    
    const balance = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    
    res.json({ 
        success: true, 
        currentProfit: trade.currentProfit || 0,
        totalRealizedProfit: trade.totalRealizedProfit || 0,
        timeElapsed: timeElapsed.toFixed(2),
        timeRemaining: timeRemaining.toFixed(2),
        targetReached: trade.targetReached || false,
        timeExceeded: trade.timeExceeded || false,
        newTrades: newTrades,
        balance: balance.success ? balance.free : 0
    });
});

app.post('/api/balance', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = database.sessions[sessionId];
    if (!session) {
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
    
    const balance = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey);
    
    res.json({
        success: balance.success,
        balance: balance.success ? balance.free : 0,
        error: balance.error
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🌙 HALAL AI TRADING BOT - REAL MONEY MODE');
    console.log('='.repeat(50));
    console.log(`✅ Server running on port: ${PORT}`);
    console.log('='.repeat(50) + '\n');
});
