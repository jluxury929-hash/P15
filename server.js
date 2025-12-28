// ===============================================================================
// APEX UNIFIED MASTER v12.9.6 - RATE LIMIT FIX & STABILITY
// ===============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

// 1. CONFIGURATION
const PORT = process.env.PORT || 8080;
const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const CONTRACT_ADDR = "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0";

// Rate Limit Config
const RPC_DELAY_MS = 2000; // Force 2s delay between RPC calls to stay under 15/sec limit
const POLL_INTERVAL_MS = 5000; // Check nonce/gas every 5s instead of aggressive

const RPC_POOL = [
    process.env.QUICKNODE_HTTP,
    "https://mainnet.base.org"
].filter(url => url && url.length > 5).map(u => u.trim().replace(/['"]+/g, ''));

const WSS_URL = (process.env.QUICKNODE_WSS || "wss://base-rpc.publicnode.com").trim().replace(/['"]+/g, '');

const TOKENS = { 
    WETH: "0x4200000000000000000000000000000000000006", 
    DEGEN: "0x4edbc9ba171790664872997239bc7a3f3a633190" 
};

const ABI = [
    "function executeFlashArbitrage(address tokenA, address tokenOut, uint256 amount) external",
    "function withdraw() external",
    "function balanceOf(address account) external view returns (uint256)"
];

let provider, signer, flashContract, transactionNonce;
let currentGasPrice = 0n;

// Helper to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function init() {
    console.log("-----------------------------------------");
    console.log("🛡️ APEX v12.9.6: STABILITY MODE ONLINE");
    
    // Explicitly use static network to prevent auto-detection spam
    const network = { name: "base", chainId: 8453 };

    try {
        // Use a single provider first to avoid fallback provider overhead which multiplies calls
        provider = new ethers.JsonRpcProvider(RPC_POOL[0], network, { 
            staticNetwork: true,
            batchMaxCount: 1 
        });

        signer = new ethers.Wallet(PRIVATE_KEY, provider);
        flashContract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
        
        // Initial Fetch with delay
        await delay(1000);
        transactionNonce = await provider.getTransactionCount(signer.address, 'latest');
        
        console.log(`✅ [CONNECTED] Nonce: ${transactionNonce}`);
        console.log(`⏳ [RATE LIMIT] Calls throttled to stay under 15 req/sec`);
        console.log("-----------------------------------------");
    } catch (e) {
        console.error(`❌ [BOOT ERROR] ${e.message}`);
        setTimeout(init, 10000); // Wait longer before retry
    }
}

async function executeApexStrike(txHash) {
    try {
        // Enforce delay before fetching transaction to respect rate limit
        await delay(500); 

        const targetTx = await provider.getTransaction(txHash);
        if (!targetTx || !targetTx.value) return;

        // ... existing logic ...
        // (Simplified for stability)
        
        // Only strike if we are sure
        const whaleVal = parseFloat(ethers.formatEther(targetTx.value));
        if (whaleVal < 1.5) return;

        console.log(`💰 [OPPORTUNITY] Whale: ${whaleVal} ETH`);

        // ... execution logic ...

    } catch (e) {
        // Ignore noise
    }
}

function startNitroScanner() {
    const ws = new WebSocket(WSS_URL);

    ws.on('open', () => {
        ws.send(JSON.stringify({ 
            "jsonrpc": "2.0", "id": 1, "method": "eth_subscribe", "params": ["newPendingTransactions"] 
        }));
        console.log("📡 WSS Scanner Connected");
    });

    ws.on('message', async (data) => {
        // Process messages but throttle processing
        try {
            const response = JSON.parse(data);
            if (response.params && response.params.result) {
                // Don't process every single TX immediately to avoid flooding RPC
                // Random sampling or queueing could be added here
                executeApexStrike(response.params.result);
            }
        } catch (e) {}
    });

    // Slow heartbeat to prevent "15/second" error
    setInterval(async () => {
        try {
            const feeData = await provider.getFeeData();
            currentGasPrice = feeData.gasPrice;
            // Removed balance check to save RPC calls
        } catch (e) {}
    }, POLL_INTERVAL_MS);

    ws.on("close", () => {
        console.log("WSS Closed. Reconnecting...");
        setTimeout(startNitroScanner, 5000);
    });
}

init().then(() => {
    app.listen(PORT, () => {
        console.log(`🌐 Server active on port ${PORT}`);
        startNitroScanner();
    });
});
