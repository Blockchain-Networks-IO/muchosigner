/**
 * MuchoSigner › «Ver mis direcciones» (`docs/MUCHOSIGNER.md` §«Ver mis
 * direcciones»; petición del dueño, 11-11-2026): con la frase abierta, el móvil
 * enseña las direcciones que salen de ella, sin conexión, para comprobar que
 * es la misma frase que la del monedero sin restaurarla en otra app con
 * dinero dentro. Lo que hace la página de Ian Coleman, pero en español, sin
 * red y con la MISMA numeración de cuentas que la Mucho Wallet:
 *
 *  - EVM: la cuenta N del monedero es `m/44'/60'/0'/0/{N-1}` (esquema de
 *    MetaMask, `evmAccounts.ts` del monedero): una dirección por cuenta. Se
 *    puede elegir otro esquema (Ledger Live `m/44'/60'/{N-1}'/0/0` o el
 *    antiguo `m/44'/60'/0'/{N-1}`), los MISMOS de `evmDerivation.ts`, para
 *    comprobar la frase de un aparato o de otra app (petición del dueño,
 *    12-11-2026). En la Cuenta 1, MetaMask y Ledger Live coinciden.
 *  - Bitcoin: la cuenta N es `m/{tipo}'/0'/{N-1}'` (`btcAccounts.ts`) y cada
 *    una tiene muchas direcciones de recepción (rama 0) y de cambio (rama 1),
 *    en los cuatro tipos que maneja el monedero.
 *
 * Lo que NO sale de aquí, y la pantalla lo dice: las direcciones de depósito
 * (salen de una firma, no de una ruta: las recupera la herramienta de
 * rescate) y Solana (aún no). Puro, sin red ni DOM.
 */
import type { HDKey } from "@scure/bip32";
import { bytesToHex, type Address } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { evmSchemePath, type EvmPathScheme } from "@shared/wallet/evmDerivation";
import { SINGLE_TYPES, paymentFor, type SinglePurpose } from "./single";

/** Cuántas direcciones se enseñan de una vez. */
export const ADDRESSES_PAGE = 10;
/** Hasta dónde se puede pedir (cuentas EVM y direcciones de una rama Bitcoin). */
export const ADDRESSES_MAX = 1000;

export interface ShownAddress {
  /** Número que ve el usuario: «Cuenta 3» en EVM, «n.º 3» en Bitcoin (desde 1). */
  n: number;
  path: string;
  address: string;
}

function checkRange(from: number, count: number) {
  if (!Number.isInteger(from) || !Number.isInteger(count) || from < 0 || count < 1 || from + count > ADDRESSES_MAX) {
    throw new Error(`Se pueden ver hasta ${ADDRESSES_MAX} direcciones.`);
  }
}

/** Las cuentas EVM, de la `from + 1` en adelante, en el esquema elegido (por defecto, el del monedero). */
export function evmAccountAddresses(
  root: HDKey,
  from: number,
  count = ADDRESSES_PAGE,
  scheme: EvmPathScheme = "metamask",
): ShownAddress[] {
  checkRange(from, count);
  return Array.from({ length: count }, (_, k) => {
    const i = from + k;
    const path = evmSchemePath(scheme, i);
    const node = root.derive(path);
    if (!node.privateKey) throw new Error("No se pudo derivar la cuenta EVM.");
    const address: Address = privateKeyToAddress(bytesToHex(node.privateKey));
    return { n: i + 1, path, address };
  });
}

/** Direcciones Bitcoin de una cuenta, un tipo y una rama (0 recepción, 1 cambio). */
export function btcAddresses(
  root: HDKey,
  purpose: SinglePurpose,
  accountIndex: number,
  branch: 0 | 1,
  from: number,
  count = ADDRESSES_PAGE,
): ShownAddress[] {
  checkRange(from, count);
  if (!SINGLE_TYPES.some(t => t.purpose === purpose)) throw new Error("Tipo de dirección desconocido.");
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex >= ADDRESSES_MAX) throw new Error("Número de cuenta no válido.");
  const chain = root.derive(`m/${purpose}'/0'/${accountIndex}'/${branch}`);
  return Array.from({ length: count }, (_, k) => {
    const i = from + k;
    const pub = chain.deriveChild(i).publicKey;
    if (!pub) throw new Error("No se pudo derivar la dirección.");
    return { n: i + 1, path: `m/${purpose}'/0'/${accountIndex}'/${branch}/${i}`, address: paymentFor(pub, purpose).address! };
  });
}
