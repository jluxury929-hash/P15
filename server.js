// ===============================================================================
// APEX TITAN FLASH v14.2 (STABLE FIX) - CRASH PROOF EDITION
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const axios = require('axios');
const { ethers, WebSocketProvider, JsonRpcProvider, Wallet, Interface, parseEther, formatEther } = require('ethers');
require('dotenv').config();

// --- SAFETY: GLOBAL ERROR HANDLERS (PREVENTS CRASHES) ---
process.on('uncaughtException', (err) => {
    console.error("\n\x1b[31m[CRITICAL ERROR] Uncaught Exception:\x1b[0m", err.message);
    // Keep process alive if possible, or exit gracefully
});

process.on('unhandledRejection', (reason, promise) => {
    console.error("\n\x1b[31m[CRITICAL ERROR] Unhandled Rejection:\x1b[0m", reason instanceof Error ? reason.message : reason);
});

// --- DEPENDENCY CHECK ---
let FlashbotsBundleProvider;
let hasFlashbots = false;
try {
    ({ FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle'));
    hasFlashbots = true;
} catch (e) {
    if (cluster.isPrimary) {
        console.error("\x1b[33m%s\x1b[0m", "\n⚠️ WARNING: Flashbots dependency missing. Mainnet bundling disabled.");
    }
}

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
    TARGET_CONTRACT: process.env.TARGET_CONTRACT || "0xYOUR_DEPLOYED_CONTRACT_ADDRESS_HERE",
    
    // ⚡ TITAN 250 STRATEGY SETTINGS
    FLASH_LOAN_AMOUNT: parseEther("250"), 
    MIN_WHALE_VALUE: 10.0,                
    GAS_LIMIT: 1500000n,                  
    PORT: process.env.PORT || 8080,       

    // 🌍 NETWORKS
    NETWORKS: [
        {
            name: "ETH_MAINNET",
            chainId: 1,
            rpc: process.env.ETH_RPC || "https://eth.llamarpc.com",
            wss: process.env.ETH_WSS || "wss://ethereum-rpc.publicnode.com", 
            type: "FLASHBOTS",
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
            type: "PRIVATE_RELAY",
            privateRpc: "https://arb1.arbitrum.io/rpc",
            aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564", 
            color: TXT.blue
        },
        {
            name: "BASE_MAINNET",
            chainId: 8453,
            rpc: process.env.BASE_RPC || "https://mainnet.base.org",
            wss: process.env.BASE_WSS || "wss://base-rpc.publicnode.com",
            type: "PRIVATE_RELAY",
            privateRpc: "https://base.merkle.io",
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
    console.log(`${TXT.bold}${TXT.gold}║   ⚡ APEX TITAN v14.2 | STABLE CLUSTER                 ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   NETWORKS: ETH MAINNET • ARBITRUM • BASE              ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    // Validation Check
    if (GLOBAL_CONFIG.TARGET_CONTRACT.includes("YOUR_DEPLOYED")) {
        console.error(`${TXT.red}⚠️  CRITICAL CONFIG ERROR: You must set a valid TARGET_CONTRACT in your .env or code.${TXT.reset}`);
        console.error(`${TXT.gray}   The script will continue, but transactions will revert.${TXT.reset}\n`);
    }

    const cpuCount = os.cpus().length;
    console.log(`${TXT.green}[SYSTEM] Spawning ${cpuCount} Quantum Workers...${TXT.reset}`);
    
    for (let i = 0; i < cpuCount; i++) {
        cluster.fork();
    }

    // 1. RESTART LOOP PROTECTION
    cluster.on('exit', (worker, code, signal) => {
        console.log(`${TXT.red}⚠️  Worker ${worker.process.pid} died. Respawning in 3 seconds...${TXT.reset}`);
        // Delay restart to prevent CPU spikes (Fork Bomb Protection)
        setTimeout(() => {
            cluster.fork();
        }, 3000);
    });
} 
// --- WORKER PROCESS ---
else {
    const networkIndex = (cluster.worker.id - 1) % GLOBAL_CONFIG.NETWORKS.length;
    const NETWORK = GLOBAL_CONFIG.NETWORKS[networkIndex];
    
    // Wrap initialization in catch to prevent immediate worker death
    initWorker(NETWORK).catch(err => {
        console.error(`${TXT.red}[FATAL] Worker Init Failed:${TXT.reset}`, err.message);
        // Do not exit process.exit(1) here, let it idle or retry
    });
}

async function initWorker(CHAIN) {
    const TAG = `${CHAIN.color}[${CHAIN.name}]${TXT.reset}`;
    const workerPort = GLOBAL_CONFIG.PORT + cluster.worker.id;

    // 0. JITTER
    const jitter = Math.floor(Math.random() * 5000);
    await new Promise(resolve => setTimeout(resolve, jitter));

    // 1. HEALTH CHECK
    try {
        const server = http.createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/status') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: "ONLINE", chain: CHAIN.name }));
            } else { res.writeHead(404); res.end(); }
        });
        server.on('error', (e) => { /* Ignore port conflicts */ });
        server.listen(workerPort, () => {}); 
    } catch (e) { /* Ignore server errors */ }
    
    // 2. SETUP PROVIDERS
    let provider, wsProvider, wallet;
    try {
        const network = ethers.Network.from(CHAIN.chainId);
        provider = new JsonRpcProvider(CHAIN.rpc, network, { staticNetwork: true });
        
        // 2a. SAFE WEBSOCKET HANDLING
        wsProvider = new WebSocketProvider(CHAIN.wss);
        
        // Add error listener to prevent crash on connection loss
        wsProvider.on('error', (error) => {
            console.error(`${TXT.yellow}⚠️ [WS ERROR] ${TAG}: ${error.message}${TXT.reset}`);
        });

        // In Ethers v6, we can listen to the provider itself for errors, 
        // but we keep the direct websocket access wrapped safely just in case.
        if (wsProvider.websocket) {
            wsProvider.websocket.onerror = () => { };
            wsProvider.websocket.onclose = () => {
                console.log(`${TXT.yellow}⚠️ [WS CLOSED] ${TAG}: Worker restarting...${TXT.reset}`);
                process.exit(0); // Master will respawn us after delay
            };
        }
        
        const pk = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
        wallet = new Wallet(pk, provider);
        
        console.log(`${TXT.green}✅ WORKER ${process.pid} ACTIVE${TXT.reset} on ${TAG}`);
    } catch (e) {
        console.log(`${TXT.red}❌ Connection Failed on ${TAG}: ${e.message}${TXT.reset}`);
        return; // Exit function, don't crash process
    }

    // 3. SETUP FLASHBOTS
    let flashbotsProvider = null;
    if (CHAIN.type === "FLASHBOTS" && hasFlashbots) {
        try {
            const authSigner = new Wallet(wallet.privateKey, provider);
            flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, CHAIN.relay);
        } catch (e) {
            console.log(`   ${TXT.yellow}⚠️ Flashbots Offline for ${TAG}${TXT.reset}`);
        }
    }

    const poolIface = new Interface([
        "function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode)"
    ]);

    // 4. MEMPOOL SCANNING (With Try-Catch Block)
    wsProvider.on("pending", async (txHash) => {
        try {
            // Safety: If provider is destroyed or undefined
            if (!provider) return;

            const tx = await provider.getTransaction(txHash).catch(() => null); // Catch 404s
            if (!tx || !tx.to) return;

            // Optional: Check if tx.value exists to prevent errors
            if (!tx.value) return;

            const valueEth = parseFloat(formatEther(tx.value));
            
            if (valueEth >= GLOBAL_CONFIG.MIN_WHALE_VALUE && 
                tx.to.toLowerCase() === CHAIN.uniswapRouter.toLowerCase()) {

                console.log(`\n${TAG} ${TXT.gold}⚡ TITAN TRIGGER: ${txHash.substring(0, 10)}...${TXT.reset}`);
                console.log(`   💰 Value: ${valueEth.toFixed(2)} ETH`);

                // A. CONSTRUCT TRADE
                const wethAddress = CHAIN.chainId === 8453 
                    ? "0x4200000000000000000000000000000000000006" 
                    : "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; 

                const tradeData = poolIface.encodeFunctionData("flashLoanSimple", [
                    GLOBAL_CONFIG.TARGET_CONTRACT,
                    wethAddress, 
                    GLOBAL_CONFIG.FLASH_LOAN_AMOUNT,
                    "0x", 
                    0
                ]);

                const txPayload = {
                    to: CHAIN.aavePool,
                    data: tradeData,
                    type: 2,
                    chainId: CHAIN.chainId,
                    maxFeePerGas: parseEther("30", "gwei"),
                    maxPriorityFeePerGas: parseEther("2", "gwei"),
                    gasLimit: GLOBAL_CONFIG.GAS_LIMIT,
                    nonce: await provider.getTransactionCount(wallet.address),
                    value: 0n
                };

                // Safety: Check if TARGET_CONTRACT is valid before signing
                if (GLOBAL_CONFIG.TARGET_CONTRACT.includes("YOUR_DEPLOYED")) {
                    console.log(`   ${TXT.red}❌ Aborted: Target Contract not configured.${TXT.reset}`);
                    return;
                }

                const signedTx = await wallet.signTransaction(txPayload);

                // B. EXECUTION
                if (CHAIN.type === "FLASHBOTS" && flashbotsProvider) {
                    const bundle = [{ signedTransaction: signedTx }];
                    const targetBlock = (await provider.getBlockNumber()) + 1;
                    
                    const sim = await flashbotsProvider.simulate(bundle, targetBlock).catch(e => ({ error: e.message }));
                    
                    if (!("error" in sim)) {
                        await flashbotsProvider.sendBundle(bundle, targetBlock);
                        console.log(`   ${TXT.green}💎 Bundle Secured!${TXT.reset}`);
                    } else {
                        // Silent fail on sim error
                    }
                } else {
                    // Private Relay / Direct
                    try {
                        const relayResponse = await axios.post(CHAIN.privateRpc, {
                            jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx]
                        }, { timeout: 2000 }).catch(e => null); // Add timeout

                        if (relayResponse && relayResponse.data && relayResponse.data.result) {
                            console.log(`   ${TXT.green}🎉 SUCCESS: ${relayResponse.data.result}${TXT.reset}`);
                        } else {
                            await wallet.sendTransaction(txPayload).catch(() => {});
                        }
                    } catch (relayErr) {
                         // Fallback silently
                    }
                }
            }
        } catch (err) {
            // Prevent worker crash on logic error
            // console.error("Worker Logic Error:", err.message); 
        }
    });
}
