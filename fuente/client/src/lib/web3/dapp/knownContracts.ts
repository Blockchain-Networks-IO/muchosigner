/**
 * Contratos CONOCIDOS para poner nombre a lo que una dApp pide firmar.
 *
 * Es una lista corta y a mano: solo direcciones canónicas de las que estamos
 * seguros (deterministas o publicadas por el propio protocolo). Poner aquí una
 * dirección equivocada sería PEOR que no poner nada: le diríamos al usuario
 * «esto es Aave» de algo que no lo es. Ante la duda, fuera de la lista; el
 * decodificador la marcará como «no reconocido» y el usuario comprobará.
 *
 * Los tokens NO van aquí: se resuelven con `knownTokens` + lectura on-chain
 * (`tokenMeta.ts`).
 */
import type { Address } from "viem";
import type { ChainKey } from "@shared/wallet/chains";
import { AAVE_V3_POOL } from "@shared/wallet/defiContracts";

export interface KnownContract {
  name: string;
  /** Familia, para la frase («router de intercambio», «pool de préstamos»…). */
  kind: "permit2" | "router" | "lending" | "wrapped-native" | "position-manager";
}

/** Permit2 de Uniswap: MISMA dirección en todas las EVM (deployer determinista). */
export const PERMIT2_ADDRESS: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** Dirección → contrato, válida en TODAS las cadenas. */
const GLOBAL: Record<string, KnownContract> = {
  [PERMIT2_ADDRESS.toLowerCase()]: { name: "Uniswap Permit2", kind: "permit2" },
};

/** Dirección → contrato, por cadena. */
const BY_CHAIN: Partial<Record<ChainKey, Record<string, KnownContract>>> = {
  ethereum: {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { name: "WETH", kind: "wrapped-native" },
  },
  arbitrum: {
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": { name: "WETH", kind: "wrapped-native" },
  },
  optimism: {
    "0x4200000000000000000000000000000000000006": { name: "WETH", kind: "wrapped-native" },
  },
  polygon: {
    "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": { name: "WPOL", kind: "wrapped-native" },
  },
  base: {
    "0x4200000000000000000000000000000000000006": { name: "WETH", kind: "wrapped-native" },
  },
};

// Los pools de Aave v3 salen del registro de posiciones DeFi (`defi/contracts.ts`):
// una sola fuente para nombrar lo que se firma y para leer lo que se tiene.
for (const [chain, pool] of Object.entries(AAVE_V3_POOL) as [ChainKey, Address][]) {
  (BY_CHAIN[chain] ??= {})[pool.toLowerCase()] = { name: "Aave v3 (Pool)", kind: "lending" };
}

/** Contrato del «nativo envuelto» (WETH/WPOL) de una cadena, si lo conocemos. */
export function wrappedNativeAddress(chainKey: ChainKey): string | undefined {
  const entries = Object.entries(BY_CHAIN[chainKey] ?? {});
  return entries.find(([, c]) => c.kind === "wrapped-native")?.[0];
}

export function knownContract(
  chainKey: ChainKey | undefined,
  address: string | undefined
): KnownContract | undefined {
  if (!address) return undefined;
  const lc = address.toLowerCase();
  return GLOBAL[lc] ?? (chainKey ? BY_CHAIN[chainKey]?.[lc] : undefined);
}

/** Direcciones «mágicas» del Universal Router de Uniswap para el destinatario. */
export const UR_MSG_SENDER = "0x0000000000000000000000000000000000000001";
export const UR_ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
