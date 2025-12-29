// ===============================================================================
// APEX TITAN LEGIT v13.5 - MULTI-CHAIN QUANTUM ENGINE (ETH + ARB + BASE)
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const { ethers, WebSocketProvider, JsonRpcProvider, Wallet, Interface, parseEther, formatEther } = require('ethers');

// --- DEPENDENCY CHECK ---
let FlashbotsBundleProvider;
try {
    ({ FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle'));
} catch (e) {
    console.error("\x1b[31m%s\x1b[0m", "\n❌ CRITICAL: Missing Flashbots Dependency");
    console.error("\x1b[33m%s\x1b[0m", "👉 Run: npm install @flashbots/ethers-provider-bundle ethers dotenv\n");
    process.exit(1);
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
    // 🔒 PROFIT TARGET (Your Contract)
    // NOTE: You must deploy the SAME contract to all chains or configure per chain below
    TARGET_CONTRACT: "0xYOUR_DEPLOYED_CONTRACT_ADDRESS_HERE",
    
    // ⚡ SETTINGS
    FLASH_LOAN_AMOUNT: parseEther("50"), 
    MIN_WHALE_VALUE: 5.0, // Scan for txs > 5 ETH

    // 🌍 NETWORKS
    NETWORKS: [
        {
            name: "ETH_MAINNET",
            chainId: 1,
            rpc: process.env.ETH_RPC || "https://mainnet.infura.io/v3/YOUR_KEY",
            wss: process.env.ETH_WSS || "wss://mainnet.infura.io/ws/v3/YOUR_KEY",
            type: "FLASHBOTS", // Uses Private Relays
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
            type: "DIRECT_SEQUENCER", // L2 Sequencer is FCFS (No standard Flashbots bundle)
            aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // SwapRouter02
            color: TXT.blue
        },
        {
            name: "BASE_MAINNET",
            chainId: 8453,
            rpc: process.env.BASE_RPC || "https://mainnet.base.org",
            wss: process.env.BASE_WSS || "wss://base-rpc.publicnode.com",
            type: "DIRECT_SEQUENCER", // L2 Sequencer
            aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
            uniswapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481", // SwapRouter02 on Base
            color: TXT.magenta
        }
    ]
};

// --- MASTER PROCESS ---
if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}╔════════════════════════════════════════════════════════╗${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   ⚡ APEX TITAN v13.5 | MULTI-CHAIN QUANTUM ENGINE     ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   NETWORKS: ETH MAINNET • ARBITRUM • BASE              ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    const cpuCount = os.cpus().length;
    console.log(`${TXT.green}[SYSTEM] Spawning ${cpuCount} Workers across ${GLOBAL_CONFIG.NETWORKS.length} Chains...${TXT.reset}`);

    // Create workers
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
    // 1. SELECT NETWORK BASED ON WORKER ID
    // This distributes workers evenly across the defined chains
    // Worker 1 -> ETH, Worker 2 -> ARB, Worker 3 -> BASE, Worker 4 -> ETH...
    const networkIndex = (cluster.worker.id - 1) % GLOBAL_CONFIG.NETWORKS.length;
    const NETWORK = GLOBAL_CONFIG.NETWORKS[networkIndex];
    
    initWorker(NETWORK);
}

async function initWorker(CHAIN) {
    const TAG = `${CHAIN.color}[${CHAIN.name}]${TXT.reset}`;
    
    // 1. SETUP PROVIDERS
    let provider, wsProvider, wallet;
    try {
        provider = new JsonRpcProvider(CHAIN.rpc);
        wsProvider = new WebSocketProvider(CHAIN.wss);
        
        // Use a dummy key if env is missing to prevent crash during testing
        const pk = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
        wallet = new Wallet(pk, provider);
        
        console.log(`${TXT.green}✅ WORKER ${process.pid} ACTIVE${TXT.reset} on ${TAG}`);
    } catch (e) {
        console.log(`${TXT.red}❌ Connection Failed on ${TAG}: ${e.message}${TXT.reset}`);
        return;
    }

    // 2. SETUP EXECUTION STRATEGY
    let flashbotsProvider = null;
    if (CHAIN.type === "FLASHBOTS") {
        try {
            // Only Mainnet uses Flashbots Bundles normally
            const authSigner = new Wallet(wallet.privateKey, provider);
            flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, CHAIN.relay);
            console.log(`   ${TXT.dim}↳ Connected to Dark Pool (Flashbots)${TXT.reset}`);
        } catch (e) {
            console.log(`   ${TXT.yellow}⚠️ Flashbots Offline for ${TAG}${TXT.reset}`);
        }
    } else {
        console.log(`   ${TXT.dim}↳ Using Direct Sequencer (L2 Fast Path)${TXT.reset}`);
    }

    // 3. INTERFACES
    const poolIface = new Interface([
        "function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode)"
    ]);

    // 4. MEMPOOL SCANNING
    wsProvider.on("pending", async (txHash) => {
        try {
            const tx = await provider.getTransaction(txHash);
            if (!tx || !tx.to) return;

            // FILTER: VALUE & ROUTER
            const valueEth = parseFloat(formatEther(tx.value));
            
            // Check if talking to that chain's Uniswap Router
            if (valueEth >= GLOBAL_CONFIG.MIN_WHALE_VALUE && 
                tx.to.toLowerCase() === CHAIN.uniswapRouter.toLowerCase()) {

                console.log(`\n${TAG} ${TXT.gold}⚡ WHALE DETECTED: ${txHash.substring(0, 10)}...${TXT.reset}`);
                console.log(`   💰 Value: ${valueEth.toFixed(2)} ETH`);
                console.log(`   🎯 Target: Uniswap V3 Router`);

                // --- EXECUTION LOGIC ---
                try {
                    // A. PREPARE PAYLOAD (Aave Flash Loan)
                    const wethAddress = CHAIN.chainId === 8453 
                        ? "0x4200000000000000000000000000000000000006" // Base WETH
                        : "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // Mainnet/Arb WETH (Arb uses 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1)

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
                        maxFeePerGas: parseEther("10", "gwei"), // Dynamic pricing recommended in prod
                        maxPriorityFeePerGas: parseEther("1", "gwei"),
                        gasLimit: 600000n,
                        nonce: await provider.getTransactionCount(wallet.address),
                        value: 0n
                    };

                    // B. EXECUTE (Based on Chain Type)
                    if (CHAIN.type === "FLASHBOTS" && flashbotsProvider) {
                        // --- METHOD 1: FLASHBOTS BUNDLE (MAINNET) ---
                        const signedTx = await wallet.signTransaction(txPayload);
                        const bundle = [{ signedTransaction: signedTx }];
                        
                        const targetBlock = (await provider.getBlockNumber()) + 1;
                        console.log(`   ${TXT.magenta}🚀 Submitting Bundle to Miner (Block ${targetBlock})...${TXT.reset}`);
                        
                        // Simulate & Send
                        const sim = await flashbotsProvider.simulate(bundle, targetBlock);
                        if ("error" in sim) {
                            console.log(`   ${TXT.yellow}⚠️ Simulation Failed: ${sim.error.message}${TXT.reset}`);
                        } else {
                            await flashbotsProvider.sendBundle(bundle, targetBlock);
                            console.log(`   ${TXT.green}🎉 Bundle Sent!${TXT.reset}`);
                        }

                    } else {
                        // --- METHOD 2: DIRECT SEQUENCER (L2 ARB/BASE) ---
                        // L2s are First-Come-First-Served, so we just broadcast efficiently
                        console.log(`   ${TXT.magenta}🚀 Broadcasting to Sequencer...${TXT.reset}`);
                        const txResponse = await wallet.sendTransaction(txPayload);
                        console.log(`   ${TXT.green}🎉 Tx Sent: ${txResponse.hash}${TXT.reset}`);
                    }

                } catch (err) {
                    console.log(`   ${TXT.red}⚠️ Execution Error: ${err.message}${TXT.reset}`);
                }
            }
        } catch (e) {
            // Ignore fetch errors
        }
    });
}
