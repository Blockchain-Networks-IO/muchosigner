/**
 * Tokens conocidos por cadena — catálogo COMPARTIDO cliente/servidor.
 *
 * El cliente lo usa para los selectores de envío/swap (`knownTokens(chainKey)`)
 * y el servidor para leer POR RPC el saldo de las redes que Moralis no cubre
 * (`server/wallet/rpcBalances.ts`): en esas redes solo se ve lo que está aquí,
 * así que añadir un token = añadir una entrada. Mínimo viable: la moneda nativa
 * (implícita) + USDC (+ USDG en Robinhood Chain).
 *
 * En Robinhood Chain el 1Click entrega además WETH, USDe y un par de tokens
 * largos (changelog de NEAR Intents del 18-09-2026). NO están aquí a propósito:
 * el símbolo y los decimales de un token los dice el CONTRATO, y esas
 * direcciones no se han podido leer en cadena (el RPC de la red no es
 * alcanzable desde el entorno de desarrollo). Mientras tanto su saldo sale por
 * el catálogo aprobado de Li.Fi o añadiéndolos como token personalizado, que
 * SÍ leen los metadatos del contrato (`docs/TOKENS-PERSONALIZADOS.md`).
 *
 * Vive en `shared/` y NO importa viem a propósito: `Address` de viem es
 * `` `0x${string}` ``, así que el tipo es intercambiable y el servidor no
 * arrastra el cliente entero.
 */
import type { ChainKey } from "./chains";

export type TokenAddress = `0x${string}`;

export interface KnownToken {
  symbol: string;
  /**
   * Dirección del token: contrato ERC-20 (EVM) o mint SPL (Solana, base58). En
   * Solana se tipa igual por uniformidad del selector; a efectos de firma se
   * trata como string (igual que `Origin.contract` en el swap).
   */
  address: TokenAddress;
  decimals: number;
  isStablecoin?: boolean;
}

/** USDC oficial por cadena EVM. */
const USDC: Partial<Record<ChainKey, KnownToken>> = {
  ethereum: {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    isStablecoin: true,
  },
  arbitrum: {
    symbol: "USDC",
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    isStablecoin: true,
  },
  base: {
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    isStablecoin: true,
  },
  optimism: {
    symbol: "USDC",
    address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    decimals: 6,
    isStablecoin: true,
  },
  polygon: {
    symbol: "USDC",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
    isStablecoin: true,
  },
  bnb: {
    symbol: "USDC",
    // USDC en BNB Chain (Binance-Peg): **18 decimales**, no 6 como en el resto
    // de redes. Contrastado contra la reserva USDC del mercado AaveV3BNB
    // (0x6807dc…e0cB). Poner 6 aquí descuadraría el saldo por un billón.
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
    isStablecoin: true,
  },
  hyperevm: {
    symbol: "USDC",
    // USDC NATIVO de Circle en HyperEVM (FiatTokenV2_2, CCTP V2 — anuncio oficial
    // de Circle). 6 decimales. Habilita HyperEVM como origen privado y de envío.
    address: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
    decimals: 6,
    isStablecoin: true,
  },
  solana: {
    symbol: "USDC",
    // Mint SPL de USDC en Solana (Circle). base58, NO es una dirección EVM: el
    // envío lo trata como mint (ver `solana/send.ts`). 6 decimales.
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as TokenAddress,
    decimals: 6,
    isStablecoin: true,
  },
};

/**
 * USDG (Global Dollar, Paxos) en Robinhood Chain: el colateral de la instancia
 * de Lighter en esa cadena. OFT de LayerZero; 6 decimales (docs de Lighter).
 * Dirección publicada por el explorador oficial (robinhoodchain.blockscout.com).
 */
export const USDG_ROBINHOOD: KnownToken = {
  symbol: "USDG",
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
  isStablecoin: true,
};

/**
 * USDT en BNB Chain (Binance-Peg BSC-USD): la stablecoin dominante de la red,
 * así que sin ella el selector de envío/intercambio se quedaría corto. También
 * **18 decimales**; dirección contrastada contra la reserva USDT del mercado
 * AaveV3BNB.
 */
export const USDT_BNB: KnownToken = {
  symbol: "USDT",
  address: "0x55d398326f99059fF775485246999027B3197955",
  decimals: 18,
  isStablecoin: true,
};

/** Otros tokens conocidos por cadena (además del USDC). */
const EXTRA: Partial<Record<ChainKey, KnownToken[]>> = {
  bnb: [USDT_BNB],
  robinhood: [USDG_ROBINHOOD],
};

/** Tokens ERC-20 conocidos para una cadena (sin contar la moneda nativa). */
export function knownTokens(chainKey: ChainKey): KnownToken[] {
  const list: KnownToken[] = [];
  const usdc = USDC[chainKey];
  if (usdc) list.push(usdc);
  for (const t of EXTRA[chainKey] ?? []) list.push(t);
  return list;
}
