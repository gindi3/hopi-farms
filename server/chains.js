// Which chain $CROP lives on, behind one interface for deposits and withdrawals:
//   solana     the original pump.fun token (Phantom / Solflare wallets)
//   robinhood  the Abyss launch on Robinhood Chain, an Ethereum-style chain (MetaMask etc.)
//
// Env: HOPI_CHAIN (solana | robinhood, default solana), HOPI_CROP_MINT (the token: a Solana
// mint or a 0x token contract), HOPI_TREASURY (the wallet that receives deposits), and the
// RPC: HOPI_SOLANA_RPC or HOPI_EVM_RPC. Optional for robinhood: HOPI_EVM_CONFIRMATIONS (20),
// HOPI_EVM_START_BLOCK (where the first deposit scan starts), HOPI_CROP_BUY_URL.

import * as sol from './solana.js';
import * as evm from './evm.js';

export const CHAINS = {
  solana: {
    name: 'Solana',
    wallets: 'Phantom or Solflare',
    rpcEnv: 'HOPI_SOLANA_RPC',
    defaultRpc: 'https://api.mainnet-beta.solana.com',
    buyUrl: (mint) => `https://pump.fun/coin/${mint}`,
    buyName: 'pump.fun',
    txUrl: 'https://solscan.io/tx/',
    addressUrl: 'https://solscan.io/account/',
  },
  robinhood: {
    name: 'Robinhood Chain',
    wallets: 'MetaMask, Rabby or another Ethereum wallet',
    chainId: 4663,
    rpcEnv: 'HOPI_EVM_RPC',
    defaultRpc: 'https://rpc.mainnet.chain.robinhood.com',
    buyUrl: () => 'https://app.abyss.trading',
    buyName: 'Abyss',
    txUrl: 'https://robinhoodchain.blockscout.com/tx/',
    addressUrl: 'https://robinhoodchain.blockscout.com/address/',
  },
};

export function chainConfig(env = process.env) {
  const chain = CHAINS[(env.HOPI_CHAIN || 'solana').trim()] ? (env.HOPI_CHAIN || 'solana').trim() : 'solana';
  const info = CHAINS[chain];
  const ops = chain === 'solana' ? sol : evm;
  const mint = (env.HOPI_CROP_MINT || '').trim();
  const treasury = (env.HOPI_TREASURY || '').trim();
  return {
    chain,
    mint: chain === 'solana' ? mint : evm.normalize(mint),
    treasury: chain === 'solana' ? treasury : evm.normalize(treasury),
    rpcUrl: (env[info.rpcEnv] || info.defaultRpc).trim(),
    enabled: ops.isAddress(mint) && ops.isAddress(treasury),
    buyUrl: (env.HOPI_CROP_BUY_URL || '').trim() || null,
    confirmations: Number(env.HOPI_EVM_CONFIRMATIONS) || 20,
    startBlock: env.HOPI_EVM_START_BLOCK ? Number(env.HOPI_EVM_START_BLOCK) : null,
  };
}

// The chain-specific pieces, for a config from chainConfig (tests pass their own).
export function chainOps(config, rpcOverride, store) {
  const chain = config.chain || 'solana';
  const info = CHAINS[chain];
  const rpc = rpcOverride || (chain === 'solana' ? sol.rpcClient(config.rpcUrl) : evm.rpcClient(config.rpcUrl));
  const links = {
    chain, chainName: info.name, chainId: info.chainId || null, wallets: info.wallets,
    buyUrl: config.enabled ? (config.buyUrl || info.buyUrl(config.mint)) : null, buyName: info.buyName,
    txUrl: info.txUrl, addressUrl: info.addressUrl,
  };

  if (chain === 'solana') {
    return {
      rpc, links,
      isAddress: sol.isAddress,
      normalize: (a) => String(a || '').trim(),
      verify(wallet, message, s) {
        let bytes;
        try {
          bytes = /^[A-Za-z0-9+/=]+$/.test(s) && s.length > 80 ? Buffer.from(s, 'base64') : sol.base58Decode(s);
        } catch { return false; }
        return sol.verifyWalletSignature(wallet, message, bytes);
      },
      scan: ({ seen, record }) => sol.scanDeposits({ rpc, mint: config.mint, treasury: config.treasury, seen, record }),
      // { received } for a finalized payment from the treasury to `to`, or { error }.
      async checkPayout(signature, to) {
        try { if (sol.base58Decode(signature).length !== 64) throw new Error(); } catch { return { error: "That isn't a Solana transaction signature." }; }
        let tx;
        try {
          tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
        } catch (e) { return { error: `Couldn't look up that transaction: ${e.message}` }; }
        if (!tx) return { error: 'That transaction was not found (or not finalized yet). Wait a minute and try again.' };
        const moved = sol.parseTransfer(tx, { mint: config.mint, from: config.treasury, to });
        return moved ? { received: moved.received } : { error: "That transaction doesn't send $CROP from the treasury to this player's wallet." };
      },
    };
  }

  let decimals = null;
  const getDecimals = async () => (decimals ??= await evm.tokenDecimals(rpc, config.mint));
  const cursorKey = `evmCursor:${config.mint}`;
  return {
    rpc, links,
    isAddress: evm.isAddress,
    normalize: evm.normalize,
    verify: (wallet, message, s) => evm.verifyWalletSignature(wallet, message, s),
    async scan({ seen, record }) {
      return evm.scanDeposits({
        rpc, token: config.mint, treasury: config.treasury, seen, record,
        decimals: await getDecimals(), confirmations: config.confirmations,
        cursor: {
          get: () => store.getSetting(cursorKey) ?? config.startBlock,
          set: (block) => store.putSetting(cursorKey, block),
        },
      });
    },
    async checkPayout(hash, to) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { error: "That isn't a transaction hash (0x and 64 hex characters)." };
      let receipt;
      try { receipt = await rpc('eth_getTransactionReceipt', [hash]); } catch (e) { return { error: `Couldn't look up that transaction: ${e.message}` }; }
      if (!receipt) return { error: 'That transaction was not found (or not mined yet). Wait a moment and try again.' };
      if (receipt.status !== '0x1') return { error: 'That transaction failed on chain.' };
      const moved = evm.parseTransfer(receipt, { token: config.mint, from: config.treasury, to, decimals: await getDecimals() });
      return moved ? { received: moved.received } : { error: "That transaction doesn't send $CROP from the treasury to this player's wallet." };
    },
  };
}
