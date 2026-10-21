/**
 * El firmador sin conexión como llave de una MULTIFIRMA EVM (Safe del monedero,
 * `docs/MULTIFIRMA-EVM.md` §13–§14; `docs/MUCHOSIGNER.md`
 * §«Multifirma EVM»). Puro, sin red ni DOM.
 *
 * La llave EVM sale de la MISMA frase que la de Bitcoin, en la ruta de siempre
 * de MetaMask (`m/44'/60'/0'/0/0`): con la frase, cualquier monedero la
 * recupera. En la multifirma se añade como una llave de fuera (firma desde el
 * enlace del buzón).
 *
 * Reglas que no se relajan, las mismas que en la bóveda Bitcoin:
 *  - Solo se firma para una multifirma REGISTRADA en este móvil, y solo se
 *    registra una cuya dirección sale de sus llaves, su quórum y su salt
 *    (recalculada aquí sin red) y en la que ESTA llave es una de las dueñas.
 *  - El hash se calcula AQUÍ, con la misma función que el servidor
 *    (`proposalHash`): lo que se enseña y lo que se firma salen de los mismos
 *    campos. Y siempre `operation = 0` (`safeTxTypedData`): nada de
 *    `delegatecall`.
 *  - Una operación que toca la propia multifirma (cambiar llaves, quórum,
 *    módulos, guard) se avisa en rojo: es la forma de quitarte el control.
 */
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { bytesToHex, getAddress, slice, size, type Address, type Hex } from "viem";
import { privateKeyToAddress, signTypedData } from "viem/accounts";
import { counterfactualMultisigAddress } from "@shared/wallet/safeAddress";
import { MULTISIG_CHAINS, multisigChainName, type MultisigChain } from "@shared/wallet/safeMultisig";
import { proposalHash, proposalTypedData } from "@shared/wallet/safeMailbox";
import { getChain } from "@shared/wallet/chains";
import { knownTokens } from "@shared/wallet/knownTokens";
import { decodeCalldata, type DecodedCall, type TokenMetaMap } from "@/lib/web3/dapp/decodeCalldata";
import type { OfflineSafeReg, OfflineSafeTx } from "@/lib/web3/safeMultisig/offlineQr";

/** La ruta de la llave EVM: la cuenta 1 de MetaMask y de casi todos los monederos. */
export const EVM_PATH = "m/44'/60'/0'/0/0";

export interface EvmKey {
  address: Address;
  privateKey: Hex;
}

export function deriveEvmKey(mnemonic: string, passphrase = ""): EvmKey {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase)).derive(EVM_PATH);
  if (!node.privateKey) throw new Error("No se pudo derivar la llave EVM.");
  const privateKey = bytesToHex(node.privateKey);
  return { address: privateKeyToAddress(privateKey), privateKey };
}

// ─── Registrar una multifirma ────────────────────────────────────────────────

export interface RegisteredSafe {
  name: string;
  safe: Address;
  owners: Address[];
  threshold: number;
  saltNonce: string;
}

/**
 * Comprueba la multifirma que enseña el monedero y devuelve lo que se apunta.
 * Lanza si la dirección no sale de sus llaves o si esta llave no está entre
 * ellas (lo normal: otra frase u otra passphrase).
 */
export async function checkSafeReg(reg: OfflineSafeReg, key: Pick<EvmKey, "address">): Promise<RegisteredSafe> {
  if (!reg.owners.some((o) => o.toLowerCase() === key.address.toLowerCase())) {
    throw new Error(
      `Tu llave (${key.address}) no es una de las de esta multifirma. Comprueba que has abierto la frase y la passphrase con las que la añadiste.`,
    );
  }
  const computed = await counterfactualMultisigAddress(reg.owners, reg.threshold, BigInt(reg.saltNonce));
  if (computed.toLowerCase() !== reg.safe.toLowerCase()) {
    throw new Error(
      "La dirección de la multifirma no sale de sus llaves y su quórum: no se apunta. Vuelve a enseñar el QR desde la multifirma en el monedero.",
    );
  }
  return { name: reg.name, safe: getAddress(reg.safe), owners: reg.owners, threshold: reg.threshold, saltNonce: reg.saltNonce };
}

/** Lo guardado en el móvil, validado: lo raro se descarta. Puro. */
export function parseStoredSafes(raw: string | null): RegisteredSafe[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (s): s is RegisteredSafe =>
        !!s &&
        typeof s.safe === "string" &&
        Array.isArray(s.owners) &&
        typeof s.threshold === "number" &&
        typeof s.saltNonce === "string",
    );
  } catch {
    return [];
  }
}

/** Añade o sustituye (misma dirección) una multifirma registrada. */
export function upsertSafe(list: readonly RegisteredSafe[], s: RegisteredSafe): RegisteredSafe[] {
  return [...list.filter((x) => x.safe.toLowerCase() !== s.safe.toLowerCase()), s];
}

// ─── Revisar y firmar una operación ──────────────────────────────────────────

/** Funciones de la PROPIA multifirma: con ellas se le cambian las llaves. */
const SAFE_ADMIN: Record<string, string> = {
  "0x0d582f13": "añadir una llave y cambiar el quórum (addOwnerWithThreshold)",
  "0xf8dc5dd9": "quitar una llave (removeOwner)",
  "0xe318b52b": "cambiar una llave por otra (swapOwner)",
  "0x694e80c3": "cambiar el quórum (changeThreshold)",
  "0x610b5925": "activar un módulo (enableModule)",
  "0xe009cfde": "desactivar un módulo (disableModule)",
  "0xe19a9dd9": "poner un guard (setGuard)",
  "0xf08a0323": "cambiar el gestor de respaldo (setFallbackHandler)",
};

export interface SafeTxReview {
  safe: RegisteredSafe;
  chain: MultisigChain;
  chainName: string;
  nonce: string;
  hash: Hex;
  decoded: DecodedCall;
  /** Si la llamada es a la propia multifirma y qué hace. */
  selfAdmin: string | null;
  to: Address;
  value: bigint;
  data: Hex;
}

function chainOf(chainId: number): MultisigChain | null {
  return MULTISIG_CHAINS.find((c) => getChain(c).evmChainId === chainId) ?? null;
}

/** Símbolo y decimales de los tokens conocidos de esa red, para traducir la llamada. */
function tokenMeta(chain: MultisigChain): TokenMetaMap {
  const out: TokenMetaMap = {};
  for (const t of knownTokens(chain)) out[String(t.address).toLowerCase()] = { symbol: t.symbol, decimals: t.decimals };
  return out;
}

export function reviewSafeTx(
  tx: OfflineSafeTx,
  registered: readonly RegisteredSafe[],
  key: Pick<EvmKey, "address">,
): SafeTxReview {
  const safe = registered.find((s) => s.safe.toLowerCase() === tx.safe.toLowerCase());
  if (!safe) {
    throw new Error(
      `Esta operación es de una multifirma que este móvil no tiene registrada (${tx.safe}). Regístrala antes desde la multifirma en el monedero.`,
    );
  }
  if (!safe.owners.some((o) => o.toLowerCase() === key.address.toLowerCase())) {
    throw new Error("La llave que tienes abierta no es una de las de esta multifirma: abre la frase (y la passphrase) con la que la registraste.");
  }
  const chain = chainOf(tx.chainId);
  if (!chain) throw new Error(`La operación es de una red que la multifirma no usa (chainId ${tx.chainId}).`);
  const value = BigInt(tx.call.value);
  const data = tx.call.data;
  const decoded = decodeCalldata({ chainId: tx.chainId, to: tx.call.to, data, value, from: tx.safe }, tokenMeta(chain));
  const selector = size(data) >= 4 ? (slice(data, 0, 4) as Hex).toLowerCase() : null;
  const self = tx.call.to.toLowerCase() === tx.safe.toLowerCase();
  const selfAdmin = self ? (selector && SAFE_ADMIN[selector]) || "una llamada a la propia multifirma" : null;
  return {
    safe,
    chain,
    chainName: multisigChainName(chain),
    nonce: tx.nonce,
    hash: proposalHash(tx),
    decoded,
    selfAdmin,
    to: tx.call.to,
    value,
    data,
  };
}

/** Firma el `SafeTx` (EIP-712). 65 bytes con `v` en 27/28, lo que espera el Safe. */
export async function signSafeTx(tx: OfflineSafeTx, key: EvmKey): Promise<Hex> {
  const typed = proposalTypedData(tx);
  return signTypedData({ privateKey: key.privateKey, ...typed });
}
