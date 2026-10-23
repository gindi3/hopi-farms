// Explorer links for a transaction or wallet, by its own format, so Solana history from before
// the switch to Robinhood Chain still links to the right explorer.
const isEvm = (s) => /^0x/i.test(String(s));
export const txHref = (sig) => (isEvm(sig)
  ? `https://robinhoodchain.blockscout.com/tx/${encodeURIComponent(String(sig).split(':')[0])}`
  : `https://solscan.io/tx/${encodeURIComponent(sig)}`);
export const addressHref = (addr) => (isEvm(addr)
  ? `https://robinhoodchain.blockscout.com/address/${encodeURIComponent(addr)}`
  : `https://solscan.io/account/${encodeURIComponent(addr)}`);
