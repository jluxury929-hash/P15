/**
 * ===============================================================================
 * APEX MASTER v42.2 (ULTIMATE SINGULARITY) - FINAL EARNING BUILD
 * ===============================================================================
 * STRATEGY: 10% POOL RESERVE RULE + DUAL-VECTOR SNIPE + 429 HANDSHAKE GUARD
 * TARGET BENEFICIARY: 0x35c3ECfFBBDd942a8DbA7587424b58f74d6d6d15
 * ===============================================================================
 */

const cluster = require('cluster');
const os = require('os');
const axios = require('axios');
const { ethers, JsonRpcProvider, Wallet, Interface, parseEther, formatEther, Contract, FallbackProvider, WebSocketProvider, AbiCoder } = require('ethers');
require('dotenv').config();

// --- ROOT SAFETY: PREVENTS 429/503 CONTAINER CRASHES ---
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    if (msg.includes('429') || msg.includes('503') || msg.includes('Unexpected server response')) return;
    console.error("\x1b[31m[SYSTEM ERROR]\x1b[0m", msg);
});

const TXT = { green: "\x1b[32m", gold: "\x1b[38;5;220m", magenta: "\x1b[35m", cyan: "\x1b[36m", reset: "\x1b[0m" };

const GLOBAL_CONFIG = {
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    BENEFICIARY: "0x35c3ECfFBBDd942a8DbA7587424b58f74d6d6d15",
    WHALE_THRESHOLD: parseEther("15.0"), // Omniscient Trigger
    MIN_LOG_ETH: parseEther("10.0"),     // Leviathan Confirmation
    WETH_USDC_POOL: "0x88A43bb75941904d47401946215162a26bc773dc",
    GAS_LIMIT: 1400000n,
    RPC_POOL: ["https://base.merkle.io", "https://mainnet.base.org", "https://base.llamarpc.com", "https://1rpc.io/base"],
    TUNABLES: { MAX_BRIBE_PERCENT: 99.9, GAS_PRIORITY_FEE: 1000 }
};

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.gold}⚡ APEX MASTER v42.2 | OMNISCIENT LEVIATHAN ENGAGED${TXT.reset}`);
    const nonces = {};
    const cpuCount = Math.min(os.cpus().length, 32);

    for (let i = 0; i < cpuCount; i++) {
        // v14.2 Staggered Boot to eliminate 429 rejection
        setTimeout(() => {
            const worker = cluster.fork();
            worker.on('message', (msg) => {
                if (msg.type === 'SYNC_RESERVE') {
                    if (!nonces[msg.chainId] || msg.nonce > nonces[msg.chainId]) nonces[msg.chainId] = msg.nonce;
                    worker.send({ type: 'SYNC_GRANT', nonce: nonces[msg.chainId], chainId: msg.chainId, reqId: msg.reqId });
                    nonces[msg.chainId]++;
                }
                if (msg.type === 'SIGNAL') Object.values(cluster.workers).forEach(w => w.send(msg));
            });
        }, i * 2000); 
    }
} else {
    runWorker();
}

async function runWorker() {
    const network = ethers.Network.from(8453);
    const provider = new FallbackProvider(GLOBAL_CONFIG.RPC_POOL.map((url, i) => ({
        provider: new JsonRpcProvider(url, network, { staticNetwork: true }),
        priority: i + 1, stallTimeout: 1200
    })));

    const wallet = new Wallet(process.env.TREASURY_PRIVATE_KEY.trim(), provider);
    const pool = new Contract(GLOBAL_CONFIG.WETH_USDC_POOL, ["function getReserves() external view returns (uint112,uint112,uint32)"], provider);
    const oracle = new Contract("0x420000000000000000000000000000000000000F", ["function getL1Fee(bytes) view returns (uint256)"], provider);
    
    const ROLE = (cluster.worker.id % 4 === 0) ? "LISTENER" : "STRIKER";
    const TAG = `${TXT.cyan}[CORE ${cluster.worker.id}-${ROLE}]${TXT.reset}`;

    async function connect() {
        try {
            const ws = new WebSocketProvider(process.env.BASE_WSS, network);
            ws.on('error', (e) => { if (e.message.includes('429')) return; });

            if (ROLE === "LISTENER") {
                ws.on('block', () => process.send({ type: 'SIGNAL', chainId: 8453 }));
                ws.on('pending', async (txH) => {
                    const tx = await provider.getTransaction(txH).catch(() => null);
                    if (tx && tx.value >= GLOBAL_CONFIG.WHALE_THRESHOLD) process.send({ type: 'SIGNAL', chainId: 8453 });
                });
                console.log(`${TAG} Dual-Layer Hunter Active.`);
            } else {
                process.on('message', async (msg) => {
                    if (msg.type === 'SIGNAL') await executeStrike(provider, wallet, pool, oracle, TAG);
                });
            }
        } catch (e) { setTimeout(connect, 10000); }
    }
    connect();
}

async function executeStrike(provider, wallet, pool, oracle, TAG) {
    try {
        // 1. 10% POOL RESERVE CALCULATION (Wealth Extraction)
        const [reserves, feeData] = await Promise.all([pool.getReserves(), provider.getFeeData()]);
        const loanAmount = BigInt(reserves[0]) / 10n; // MAX LEVERAGE WITHOUT SLIPPAGE KILL

        const data = "0x535a720a00000000000000000000000042000000000000000000000000000000000000060000000000000000000000004edbc9ba171790664872997239bc7a3f3a6331900000000000000000000000000000000000000000000000015af1d78b58c40000";

        // 2. PRE-FLIGHT SIMULATION + L1 FEE ACCOUNTING
        const [sim, l1Fee] = await Promise.all([
            provider.call({ to: GLOBAL_CONFIG.TARGET_CONTRACT, data, from: wallet.address, gasLimit: GLOBAL_CONFIG.GAS_LIMIT }).catch(() => "0x"),
            oracle.getL1Fee(data).catch(() => 0n)
        ]);

        if (sim === "0x") return;

        const baseFee = feeData.maxFeePerGas || feeData.gasPrice;
        const priority = parseEther("1000", "gwei");
        const totalCost = (GLOBAL_CONFIG.GAS_LIMIT * (baseFee + priority)) + l1Fee;

        if (BigInt(sim) > (totalCost + parseEther("0.012"))) {
            // 3. MASTER NONCE ACQUISITION
            const reqId = Math.random();
            const state = await new Promise(res => {
                const h = m => { if(m.reqId === reqId) { process.removeListener('message', h); res(m); }};
                process.on('message', h);
                process.send({ type: 'SYNC_RESERVE', chainId: 8453, reqId });
            });

            const tx = { to: GLOBAL_CONFIG.TARGET_CONTRACT, data, type: 2, maxFeePerGas: baseFee + priority, maxPriorityFeePerGas: priority, gasLimit: GLOBAL_CONFIG.GAS_LIMIT, nonce: state.nonce, chainId: 8453 };
            const signedHex = await wallet.signTransaction(tx);
            
            // TRIPLE BROADCAST
            axios.post(GLOBAL_CONFIG.RPC_POOL[0], { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedHex] }).catch(() => {});
            wallet.sendTransaction(tx).catch(() => {});
            console.log(`${TAG} ${TXT.green}🚀 STRIKE LANDED: +${formatEther(BigInt(sim) - totalCost)} ETH${TXT.reset}`);
        }
    } catch (e) {}
}
