// ===============================================================================
// APEX TITAN FLASH v14.1 - STABLE MULTI-CHAIN 250 ETH CLUSTER
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http'); // Health check server
const axios = require('axios'); // High-frequency private relays
const { ethers, WebSocketProvider, JsonRpcProvider, Wallet, Interface, parseEther, formatEther } = require('ethers');

// --- DEPENDENCY CHECK ---
let FlashbotsBundleProvider;
let hasFlashbots = false;
try {
    ({ FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle'));
    hasFlashbots = true;
} catch (e) {
    if (cluster.isPrimary) {
        console.error("\x1b[33m%s\x1b[0m", "\n⚠️ WARNING: Flashbots dependency missing. Mainnet bundling disabled.");
        console.error("\x1b[33m%s\x1b[0m", "👉 Install with: npm install @flashbots/ethers-provider-bundle ethers dotenv axios\n");
    }
}
require('dotenv').config();

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", gray: "\x1b[90m"
};

// --- MULTI-CHAIN CONFIGURATION ---
const GLOBAL_CONFIG = {
    // 🔒 PROFIT TARGET (Your Deployed Contract)
    // REALITY CHECK: You MUST deploy a contract that implements `executeOperation` (Aave V3 Callback)
    // Do NOT use random addresses found online.
    TARGET_CONTRACT: "0xYOUR_DEPLOYED_CONTRACT_ADDRESS_HERE",
    
    // ⚡ TITAN 250 STRATEGY SETTINGS
    FLASH_LOAN_AMOUNT: parseEther("250"), // 250 ETH "Heavy" Strike
    MIN_WHALE_VALUE: 10.0,                // Only trigger on major movements
    GAS_LIMIT: 1500000n,                  // High buffer for complex routing
    PORT: process.env.PORT || 8080,       // Health check port

    // 🌍 NETWORKS & PRIVATE RELAYS
    NETWORKS: [
        {
            name: "ETH_MAINNET",
            chainId: 1,
            // Public Fallbacks if .env missing
            rpc: process.env.ETH_RPC || "https://eth.llamarpc.com",
            wss: process.env.ETH_WSS || "wss://ethereum-rpc.publicnode.com", 
            type: "FLASHBOTS", // Dark Pool
            relay: "https://relay.flashbots.net",
            aavePool: "0x87870Bca3F3f6332F99512Af77db630d00Z638025",
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            color: TXT.cyan
        },
        {
            name: "ARBITRUM",
            chainId: 42161,
            rpc: process.env.ARB_RPC || "https://arb1.arbitrum.io/rpc",
            wss: process.env.ARB_WSS || "wss://arb1.arbitrum.io/feed",
            type: "PRIVATE_RELAY", // L2 Direct
            privateRpc: "https://arb1.arbitrum.io/rpc", // Use private RPC if available
            aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564", 
            color: TXT.blue
        },
        {
            name: "BASE_MAINNET",
            chainId: 8453,
            rpc: process.env.BASE_RPC || "https://mainnet.base.org",
            wss: process.env.BASE_WSS || "wss://base-rpc.publicnode.com",
            type: "PRIVATE_RELAY", // L2 Direct
            privateRpc: "https://base.merkle.io", // Merkle Private Pool for Base
            aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
            uniswapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481", 
            color: TXT.magenta
        }
    ]
};

// --- MASTER PROCESS ---
if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}╔════════════════════════════════════════════════════════╗${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   ⚡ APEX TITAN v14.1 | MULTI-CHAIN 250 ETH CLUSTER    ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   NETWORKS: ETH MAINNET • ARBITRUM • BASE              ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    const cpuCount = os.cpus().length;
    console.log(`${TXT.green}[SYSTEM] Spawning ${cpuCount} Quantum Workers...${TXT.reset}`);
    console.log(`${TXT.magenta}[STRATEGY] Target: 250 ETH | Bribe: MAX | Dark Pool: ACTIVE${TXT.reset}`);

    for (let i = 0; i < cpuCount; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker) => {
        console.log(`${TXT.red}⚠️ Worker ${worker.process.pid} died. Respawning...${TXT.reset}`);
        cluster.fork();
    });
} 
// --- WORKER PROCESS ---
else {
    const networkIndex = (cluster.worker.id - 1) % GLOBAL_CONFIG.NETWORKS.length;
    const NETWORK = GLOBAL_CONFIG.NETWORKS[networkIndex];
    initWorker(NETWORK);
}

async function initWorker(CHAIN) {
    const TAG = `${CHAIN.color}[${CHAIN.name}]${TXT.reset}`;
    const workerPort = GLOBAL_CONFIG.PORT + cluster.worker.id;

    // 0. JITTER (Prevent Rate Limiting on Startup)
    // Spawning 48 workers at once triggers rate limits on public RPCs.
    // We wait a random amount between 0-5s before connecting.
    const jitter = Math.floor(Math.random() * 5000);
    await new Promise(resolve => setTimeout(resolve, jitter));

    // 1. HEALTH CHECK SERVER (Silent)
    const server = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: "ONLINE", chain: CHAIN.name, mode: "TITAN_250" }));
        } else { res.writeHead(404); res.end(); }
    });
    server.listen(workerPort, () => {}); 
    
    // 2. SETUP PROVIDERS
    let provider, wsProvider, wallet;
    try {
        // 🛠️ CRITICAL FIX: Pass 'staticNetwork' to bypass network detection
        // This stops the "JsonRpcProvider failed to detect network" error when high concurrency occurs
        const network = ethers.Network.from(CHAIN.chainId);
        provider = new JsonRpcProvider(CHAIN.rpc, network, { staticNetwork: true });
        
        wsProvider = new WebSocketProvider(CHAIN.wss);

        if (wsProvider.websocket) {
            wsProvider.websocket.onerror = () => { /* Silent error to prevent log spam */ };
            wsProvider.websocket.onclose = () => {
                console.log(`${TXT.yellow}⚠️ [WS CLOSED] ${TAG}: Reconnecting...${TXT.reset}`);
                process.exit(0);
            };
        }
        
        const pk = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
        wallet = new Wallet(pk, provider);
        
        console.log(`${TXT.green}✅ WORKER ${process.pid} ACTIVE${TXT.reset} on ${TAG}`);
    } catch (e) {
        console.log(`${TXT.red}❌ Connection Failed on ${TAG}: ${e.message}${TXT.reset}`);
        return;
    }

    // 3. SETUP DARK POOL / RELAYS
    let flashbotsProvider = null;
    if (CHAIN.type === "FLASHBOTS") {
        if (hasFlashbots) {
            try {
                const authSigner = new Wallet(wallet.privateKey, provider);
                flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, CHAIN.relay);
                console.log(`   ${TXT.dim}↳ Connected to Flashbots Relay${TXT.reset}`);
            } catch (e) {
                console.log(`   ${TXT.yellow}⚠️ Flashbots Offline for ${TAG}${TXT.reset}`);
            }
        }
    } else {
        console.log(`   ${TXT.dim}↳ Using Private RPC Relay (${CHAIN.privateRpc})${TXT.reset}`);
    }

    // 4. AAVE V3 INTERFACE (The Real "Titan" Vector)
    const poolIface = new Interface([
        "function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode)"
    ]);

    // 5. HIGH-FREQUENCY MEMPOOL SCANNING
    wsProvider.on("pending", async (txHash) => {
        try {
            const tx = await provider.getTransaction(txHash);
            if (!tx || !tx.to) return;

            const valueEth = parseFloat(formatEther(tx.value));
            
            // 🔍 WHALE FILTER
            if (valueEth >= GLOBAL_CONFIG.MIN_WHALE_VALUE && 
                tx.to.toLowerCase() === CHAIN.uniswapRouter.toLowerCase()) {

                console.log(`\n${TAG} ${TXT.gold}⚡ TITAN TRIGGER: ${txHash.substring(0, 10)}...${TXT.reset}`);
                console.log(`   💰 Value: ${valueEth.toFixed(2)} ETH | Target: Uniswap V3`);

                try {
                    // A. CONSTRUCT 250 ETH STRIKE
                    const wethAddress = CHAIN.chainId === 8453 
                        ? "0x4200000000000000000000000000000000000006" 
                        : "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; 

                    const tradeData = poolIface.encodeFunctionData("flashLoanSimple", [
                        GLOBAL_CONFIG.TARGET_CONTRACT,
                        wethAddress, 
                        GLOBAL_CONFIG.FLASH_LOAN_AMOUNT, // 250 ETH
                        "0x", 
                        0
                    ]);

                    const txPayload = {
                        to: CHAIN.aavePool,
                        data: tradeData,
                        type: 2,
                        chainId: CHAIN.chainId,
                        maxFeePerGas: parseEther("30", "gwei"), // High Gas for Priority
                        maxPriorityFeePerGas: parseEther("2", "gwei"),
                        gasLimit: GLOBAL_CONFIG.GAS_LIMIT,
                        nonce: await provider.getTransactionCount(wallet.address),
                        value: 0n
                    };

                    const signedTx = await wallet.signTransaction(txPayload);

                    // B. EXECUTION ROUTING
                    if (CHAIN.type === "FLASHBOTS" && flashbotsProvider) {
                        // --- ETHEREUM: FLASHBOTS BUNDLE ---
                        const bundle = [{ signedTransaction: signedTx }];
                        const targetBlock = (await provider.getBlockNumber()) + 1;
                        
                        console.log(`   ${TXT.magenta}🚀 Submitting to Dark Pool...${TXT.reset}`);
                        const sim = await flashbotsProvider.simulate(bundle, targetBlock);
                        
                        if (!("error" in sim)) {
                            await flashbotsProvider.sendBundle(bundle, targetBlock);
                            console.log(`   ${TXT.green}💎 Bundle Secured!${TXT.reset}`);
                        } else {
                            console.log(`   ${TXT.yellow}⚠️ Sim Failed${TXT.reset}`);
                        }

                    } else {
                        // --- L2: PRIVATE RELAY (AXIOS DIRECT) ---
                        // Uses raw RPC injection for speed (v14.0 Logic)
                        console.log(`   ${TXT.magenta}🚀 Relaying to Private RPC...${TXT.reset}`);
                        
                        try {
                            const relayResponse = await axios.post(CHAIN.privateRpc, {
                                jsonrpc: "2.0",
                                id: 1,
                                method: "eth_sendRawTransaction",
                                params: [signedTx]
                            });

                            if (relayResponse.data.result) {
                                console.log(`   ${TXT.green}🎉 SUCCESS: ${relayResponse.data.result}${TXT.reset}`);
                            } else {
                                // Fallback to standard broadcast if private relay fails
                                const txResponse = await wallet.sendTransaction(txPayload);
                                console.log(`   ${TXT.green}🎉 Standard Sent: ${txResponse.hash}${TXT.reset}`);
                            }
                        } catch (relayErr) {
                            console.log(`   ${TXT.red}⚠️ Relay Error, using Standard: ${relayErr.message}${TXT.reset}`);
                            const txResponse = await wallet.sendTransaction(txPayload);
                        }
                    }
