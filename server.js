const cluster = require('cluster');
const { ethers } = require('ethers');
const WebSocket = require('ws');
require('dotenv').config();

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", silver: "\x1b[38;5;250m"
};

// --- OMNISCIENT CONFIG ---
const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    
    // 🔮 ORACLES
    GAS_ORACLE: "0x420000000000000000000000000000000000000F", // Base L1 Fee
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", // ETH Price
    
    // ⚙️ EXECUTION SETTINGS
    DATA_HEX: "0x535a720a" + "0000000000000000000000004200000000000000000000000000000000000006" + "0000000000000000000000004edbc9ba171790664872997239bc7a3f3a633190" + "0000000000000000000000000000000000000000000000015af1d78b58c40000",
    GAS_LIMIT: 850000n,
    PRIORITY_BRIBE: 15n, // 15% Boost
    MIN_PROFIT_USD: 25 // $25 Minimum Profit
};

// DUAL-LANE URLS
const RPC_URL = process.env.QUICKNODE_HTTP || "https://mainnet.base.org";
const WSS_URL = process.env.QUICKNODE_WSS || "wss://base-rpc.publicnode.com";

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}╔═══════════════════════════════════════════════╗${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║     🔱 APEX v38.16.0 | MACH-1 OMNISCIENT     ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚═══════════════════════════════════════════════╝${TXT.reset}\n`);
    cluster.fork();
    cluster.on('exit', () => process.exit(1));
} else {
    runWorker();
}

async function runWorker() {
    // 1. KEY SANITIZATION
    const rawKey = process.env.TREASURY_PRIVATE_KEY;
    if (!rawKey) { console.error("❌ Key Missing"); process.exit(1); }
    const cleanKey = rawKey.trim();

    // 2. HTTP EXECUTION LANE (Stable)
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(cleanKey, provider);
    
    // 3. ORACLE SETUP
    const gasOracle = new ethers.Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], provider);
    const priceFeed = new ethers.Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider);

    const seenHashes = new Set();
    let ws = null;
    let lastActive = Date.now();
    let txCount = 0;
    let currentEthPrice = 0;

    // 4. ACCELERATOR: LOCAL NONCE
    let nextNonce = await provider.getTransactionCount(signer.address);
    process.stdout.write(`${TXT.cyan}[INIT] Mach-1 Nonce Synced: ${nextNonce}${TXT.reset}\n`);

    // 5. PRICE HEARTBEAT
    setInterval(async () => {
        try {
            const [, price] = await priceFeed.latestRoundData();
            currentEthPrice = Number(price) / 1e8;
        } catch (e) {}
    }, 12000); // Update price every block

    // 6. SCANNING TICKER
    setInterval(() => {
        const uptime = Math.floor(process.uptime());
        process.stdout.write(`\r${TXT.dim}[SCANNING]${TXT.reset} ${TXT.cyan}Active${TXT.reset} | ${TXT.silver}Tx: ${txCount}${TXT.reset} | ${TXT.gold}ETH: $${currentEthPrice.toFixed(2)}${TXT.reset}   `);
    }, 2000);

    function connect() {
        if (ws) ws.terminate();
        ws = new WebSocket(WSS_URL);

        ws.on('open', () => {
            process.stdout.write(`\n${TXT.green}📡 RAW SOCKET CONNECTED${TXT.reset}\n`);
            // Subscribe to pending transactions (Alchemy/QuickNode style)
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactionsWithBody"] }));
            lastActive = Date.now();
        });

        ws.on('message', (data) => {
            lastActive = Date.now();
            txCount++;
            try {
                const parsed = JSON.parse(data);
                const tx = parsed.params?.result;
                if (tx && tx.hash) executeStrike(tx);
            } catch (e) {}
        });

        ws.on('close', () => setTimeout(connect, 1000));
        ws.on('error', () => ws.terminate());
    }

    async function executeStrike(tx) {
        if (seenHashes.has(tx.hash)) return;
        seenHashes.add(tx.hash);

        // Filter: Ignore small dust transactions
        if (BigInt(tx.value || 0) < ethers.parseEther("0.1")) return;

        try {
            // 🛡️ OMNISCIENT PRE-FLIGHT CHECK 🛡️
            // Parallel fetch: L1 Fee + Profit Simulation + Gas Prices
            const [l1Fee, feeData, simulation] = await Promise.all([
                gasOracle.getL1Fee(CONFIG.DATA_HEX).catch(() => 0n),
                provider.getFeeData(),
                provider.call({
                    to: CONFIG.TARGET_CONTRACT,
                    data: CONFIG.DATA_HEX,
                    from: signer.address
                }).catch(() => 0n) // 0n if reverted
            ]);

            // Decode Simulation Result (assuming contract returns uint256 profit)
            const rawProfit = BigInt(simulation);
            
            if (rawProfit === 0n) return; // Not profitable

            // Calculate Costs
            const l2Cost = CONFIG.GAS_LIMIT * (feeData.maxFeePerGas || feeData.gasPrice);
            const totalCost = l2Cost + l1Fee;
            const netProfit = rawProfit - totalCost;
            
            // Convert to USD
            const profitUSD = parseFloat(ethers.formatEther(netProfit)) * currentEthPrice;

            if (profitUSD > CONFIG.MIN_PROFIT_USD) {
                process.stdout.write(`\n${TXT.bold}${TXT.magenta}⚡ OPPORTUNITY: $${profitUSD.toFixed(2)} (${ethers.formatEther(netProfit)} ETH)${TXT.reset}\n`);
                
                // 15% Bribe Calculation
                const aggressivePriority = (feeData.maxPriorityFeePerGas * (100n + CONFIG.PRIORITY_BRIBE)) / 100n;

                // 🚀 MACH-1 EXECUTION
                const responsePromise = signer.sendTransaction({
                    to: CONFIG.TARGET_CONTRACT,
                    data: CONFIG.DATA_HEX,
                    gasLimit: CONFIG.GAS_LIMIT,
                    maxPriorityFeePerGas: aggressivePriority,
                    maxFeePerGas: feeData.maxFeePerGas,
                    nonce: nextNonce++, // Local Increment
                    type: 2,
                    chainId: 8453
                });

                // Async Analysis (Doesn't block the next scan)
                responsePromise.then(async (tx) => {
                    console.log(`${TXT.green}🚀 FIRED: ${tx.hash}${TXT.reset}`);
                    await tx.wait();
                    console.log(`${TXT.gold}🏆 CONFIRMED ON-CHAIN${TXT.reset}\n`);
                }).catch((err) => {
                    if (err.message.includes("nonce")) nextNonce = -1; // Trigger resync next loop
                });
            }
        } catch (e) {
            // Silently fail on bad simulations to keep speed up
            if (nextNonce === -1) nextNonce = await provider.getTransactionCount(signer.address);
        }
    }

    // Cleanup memory
    setInterval(() => seenHashes.clear(), 3600000);
    connect();
}
