// ===============================================================================
// APEX TITAN v65.4 (OMNISCIENT STABILIZED MERGE) - HIGH-FREQUENCY ENGINE
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const axios = require('axios');
const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, formatEther, parseEther, Interface, AbiCoder } = require('ethers');
require('dotenv').config();

// --- NOISE SUPPRESSION: Suppresses RPC handshake/rate-limit noise ---
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    if (msg.includes('429') || msg.includes('network') || msg.includes('coalesce') || msg.includes('subscribe') || msg.includes('infura')) return; 
    console.error("\n\x1b[31m[SYSTEM ERROR]\x1b[0m", msg);
});

process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || "";
    if (msg.includes('429') || msg.includes('network') || msg.includes('coalesce') || msg.includes('subscribe') || msg.includes('infura')) return;
});

const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", cyan: "\x1b[36m",
    yellow: "\x1b[33m", magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m"
};

// --- MERGED CONFIGURATION ---
const GLOBAL_CONFIG = {
    // SYNC: Target contract from v65.3
    TARGET_CONTRACT: process.env.EXECUTOR_CONTRACT || "0xYOUR_DEPLOYED_CONTRACT",
    
    // 🚦 TRAFFIC CONTROL (v65.4 Optimized)
    // Core cap remains at 8 to prevent 429 bans on standard API keys
    MAX_CORES: Math.min(os.cpus().length, 8), 
    WORKER_BOOT_DELAY_MS: 15000, 
    RPC_COOLDOWN_MS: 15000,
    HEARTBEAT_INTERVAL_MS: 180000,
    
    // 🐋 OMNISCIENT SETTINGS (v64.0 Integration)
    WHALE_THRESHOLD: parseEther("15.0"), 
    LEVIATHAN_MIN_ETH: parseEther("10.0"),
    GAS_LIMIT: 1250000n,
    MARGIN_ETH: "0.015",

    NETWORKS: [
        {
            name: "ETH_MAINNET",
            chainId: 1,
            rpc: process.env.ETH_RPC || "https://mainnet.infura.io/v3/YOUR_KEY",
            wss: process.env.ETH_WSS || "wss://mainnet.infura.io/ws/v3/YOUR_KEY", 
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            priceFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
            weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            color: TXT.cyan
        },
        {
            name: "BASE_MAINNET",
            chainId: 8453,
            rpc: process.env.BASE_RPC || "https://mainnet.base.org",
            wss: process.env.BASE_WSS || "wss://mainnet.base.org",
            uniswapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481", 
            priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
            weth: "0x4200000000000000000000000000000000000006",
            color: TXT.magenta
        },
        {
            name: "ARBITRUM",
            chainId: 42161,
            rpc: process.env.ARB_RPC || "https://arb1.arbitrum.io/rpc",
            wss: process.env.ARB_WSS || "wss://arb1.arbitrum.io/feed",
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564", 
            priceFeed: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
            weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            color: TXT.blue
        }
    ]
};

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}
╔════════════════════════════════════════════════════════╗
║   ⚡ APEX TITAN v65.4 | OMNISCIENT HYBRID ENGINE      ║
║   STRATEGY: SHARED LISTENER + MULTI-NETWORK STRIKE    ║
╚════════════════════════════════════════════════════════╝${TXT.reset}`);

    const cpuCount = GLOBAL_CONFIG.MAX_CORES;
    console.log(`${TXT.cyan}[SYSTEM] Initializing Optimized ${cpuCount}-Core Cluster...${TXT.reset}`);

    const workers = [];
    const spawnWorker = (i) => {
        if (i >= cpuCount) return;
        const worker = cluster.fork();
        workers.push(worker);

        // IPC Messaging: Listeners alert all executors to strike instantly
        worker.on('message', (msg) => {
            if (msg.type === 'WHALE_SIGNAL') {
                workers.forEach(w => { if (w.id !== worker.id) w.send(msg); });
            }
        });

        setTimeout(() => spawnWorker(i + 1), GLOBAL_CONFIG.WORKER_BOOT_DELAY_MS);
    };

    spawnWorker(0);

    cluster.on('exit', (worker) => {
        console.log(`${TXT.red}⚠️ Core offline. Rebooting...${TXT.reset}`);
        setTimeout(() => cluster.fork(), 180000);
    });
} 
else {
    const networkIndex = (cluster.worker.id - 1) % GLOBAL_CONFIG.NETWORKS.length;
    const NETWORK = GLOBAL_CONFIG.NETWORKS[networkIndex];
    
    // Initial Jitter to spread handshake load
    const startDelay = (cluster.worker.id % 8) * 5000;
    setTimeout(() => {
        initWorker(NETWORK).catch(() => process.exit(1));
    }, startDelay);
}

async function initWorker(CHAIN) {
    const TAG = `${CHAIN.color}[${CHAIN.name}]${TXT.reset}`;
    // Pattern: Only workers 1, 2, 3 act as Listeners to save API quota. Others are Strikers.
    const IS_LISTENER = (cluster.worker.id <= 3);
    const ROLE = IS_LISTENER ? "LISTENER" : "STRIKER";
    
    let isProcessing = false;
    let currentEthPrice = 0;
    const walletKey = (process.env.PRIVATE_KEY || "").trim();

    async function safeConnect() {
        try {
            const netObj = ethers.Network.from(CHAIN.chainId);
            // v64.0 Handshake Bypass Integration
            const provider = new JsonRpcProvider(CHAIN.rpc, netObj, { staticNetwork: true, batchMaxCount: 1 });
            const wsProvider = IS_LISTENER ? new WebSocketProvider(CHAIN.wss, netObj) : null;
            
            if (wsProvider) {
                wsProvider.on('error', (e) => {
                    if (e.message.includes("429")) process.stdout.write(`${TXT.red}!${TXT.reset}`);
                });
                if (wsProvider.websocket) {
                    wsProvider.websocket.onclose = () => setTimeout(safeConnect, 60000);
                }
            }

            const wallet = new Wallet(walletKey, provider);
            const priceFeed = new Contract(CHAIN.priceFeed, ["function latestRoundData() view returns (uint80,int256,uint256,uint80,uint80)"], provider);

            // Heartbeat Logic
            setInterval(async () => {
                if (isProcessing) return;
                try {
                    const [, price] = await priceFeed.latestRoundData();
                    currentEthPrice = Number(price) / 1e8;
                } catch (e) {}
            }, GLOBAL_CONFIG.HEARTBEAT_INTERVAL_MS);

            // SYNC: Interface updated to match executeFlashArbitrage from ApexFlashArbitrage.sol
            const apexIface = new Interface([
                "function executeFlashArbitrage(address tokenA, address tokenOut, uint256 amount)"
            ]);

            console.log(`${TXT.green}✅ CORE ${cluster.worker.id} ${ROLE} SYNCED on ${TAG}${TXT.reset}`);

            // --- IPC HANDLER ---
            process.on('message', async (msg) => {
                if (msg.type === 'WHALE_SIGNAL' && msg.chainId === CHAIN.chainId && !isProcessing) {
                    isProcessing = true;
                    await strike(provider, wallet, apexIface, CHAIN, msg.target, "IPC_STRIKE");
                    setTimeout(() => isProcessing = false, GLOBAL_CONFIG.RPC_COOLDOWN_MS);
                }
            });

            // --- PRIMARY LISTENER LOGIC (v64.0 Intercepts) ---
            if (IS_LISTENER && wsProvider) {
                // MEMPOOL SNIPER
                wsProvider.on("pending", async (txHash) => {
                    if (isProcessing) return;
                    try {
                        const tx = await provider.getTransaction(txHash).catch(() => null);
                        if (tx && tx.to && tx.value >= GLOBAL_CONFIG.WHALE_THRESHOLD) {
                            // BROADCAST instantly via IPC
                            process.send({ type: 'WHALE_SIGNAL', chainId: CHAIN.chainId, target: tx.to });
                            
                            const isDEX = (tx.to.toLowerCase() === CHAIN.uniswapRouter.toLowerCase());
                            if (isDEX) {
                                console.log(`\n${TAG} ${TXT.gold}⚡ PRIMARY INTERCEPT: ${formatEther(tx.value)} ETH whale detected!${TXT.reset}`);
                                isProcessing = true;
                                await strike(provider, wallet, apexIface, CHAIN, tx.to, "PRIMARY_SNIPE");
                                setTimeout(() => isProcessing = false, GLOBAL_CONFIG.RPC_COOLDOWN_MS);
                            }
                        }
                    } catch (err) {}
                });

                // BLOCK LOG DECODER (Leviathan Logic)
                const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
                wsProvider.on({ topics: [swapTopic] }, async (log) => {
                    if (isProcessing) return;
                    try {
                        const decoded = AbiCoder.defaultAbiCoder().decode(["uint256", "uint256", "uint256", "uint256"], log.data);
                        const maxSwap = decoded.reduce((max, val) => val > max ? val : max, 0n);
                        if (maxSwap >= GLOBAL_CONFIG.LEVIATHAN_MIN_ETH) {
                            process.send({ type: 'WHALE_SIGNAL', chainId: CHAIN.chainId, target: log.address });
                            isProcessing = true;
                            console.log(`\n${TAG} ${TXT.yellow}🐳 LEVIATHAN LOG: ${formatEther(maxSwap)} ETH verified!${TXT.reset}`);
                            await strike(provider, wallet, apexIface, CHAIN, log.address, "LEVIATHAN_STRIKE");
                            setTimeout(() => isProcessing = false, GLOBAL_CONFIG.RPC_COOLDOWN_MS);
                        }
                    } catch (e) {}
                });
            }
        } catch (e) {
            setTimeout(safeConnect, 30000);
        }
    }

    await safeConnect();
}

async function strike(provider, wallet, iface, CHAIN, targetToken, mode) {
    try {
        const txData = iface.encodeFunctionData("executeFlashArbitrage", [CHAIN.weth, targetToken, 0]);
        
        // Simulation check
        const simulation = await provider.call({ 
            to: GLOBAL_CONFIG.TARGET_CONTRACT, 
            data: txData, 
            from: wallet.address 
        }).catch(() => null);

        if (simulation && simulation !== "0x") {
            console.log(`\n${TXT.gold}🚀 [${mode}] OPPORTUNITY DETECTED. EXECUTING...${TXT.reset}`);
            const tx = {
                to: GLOBAL_CONFIG.TARGET_CONTRACT,
                data: txData,
                type: 2,
                chainId: CHAIN.chainId,
                gasLimit: GLOBAL_CONFIG.GAS_LIMIT,
                maxFeePerGas: parseEther("0.00000006"),
                maxPriorityFeePerGas: parseEther("0.00000006")
            };
            await wallet.sendTransaction(tx).catch(() => {});
        }
    } catch (e) {}
}
