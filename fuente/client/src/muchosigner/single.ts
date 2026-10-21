/**
 * El firmador sin conexión como BILLETERA DE FIRMA ÚNICA de Bitcoin
 * (`docs/MUCHOSIGNER.md` §«Firma única»): el móvil es la única llave
 * de una cuenta nativa SegWit (P2WPKH, `bc1q…`), como un SeedSigner. El
 * monedero la sigue como cuenta de solo lectura (su xpub con origen) y prepara
 * los envíos; el móvil los revisa y los firma. Puro, sin red ni DOM.
 *
 * La cuenta es la 1 de BIP-84 (`m/84'/0'/0'`), la de casi todos los monederos:
 * con la frase, cualquiera la recupera.
 *
 * Las reglas son las de la bóveda (`core.ts`):
 *  - Solo se firma una entrada que es DE ESTA CUENTA: su clave se deriva aquí
 *    desde la ruta que trae el PSBT y su script tiene que ser el P2WPKH de esa
 *    clave. Una entrada ajena rechaza el envío entero.
 *  - El cambio se COMPRUEBA: una salida solo es «vuelve a tu cuenta» si su
 *    script es una dirección derivada aquí.
 *  - Lo que se enseña antes de firmar sale del MISMO PSBT que se firma.
 */
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import * as btc from "@scure/btc-signer";
import {
  CHANGE_LOOKAHEAD,
  CHANGE_LOOKUP_MAX,
  addressOf,
  parsePsbt,
  sameBytes,
  toHex,
  type ReviewedOutput,
} from "./core";

export const SINGLE_PATH = "m/84'/0'/0'";
export const SINGLE_ORIGIN = "84h/0h/0h";
const H = 0x80000000;
const SINGLE_PATH_NUMS = [84 + H, 0 + H, 0 + H];

export interface SingleSig {
  fingerprint: string;
  /** Llave de cuenta `m/84'/0'/0'` (privada: no sale de la pestaña). */
  account: HDKey;
  xpub: string;
  /** Lo que lee el monedero: `wpkh([huella/84h/0h/0h]xpub…/<0;1>/*)`. */
  descriptor: string;
  /** Primera dirección de recepción, para comprobarla en el monedero. */
  firstAddress: string;
}

const p2wpkhScript = (pubkey: Uint8Array) => btc.p2wpkh(pubkey).script;

export function deriveSingleSig(mnemonic: string, passphrase = ""): SingleSig {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase));
  const fingerprint = (root.fingerprint >>> 0).toString(16).padStart(8, "0");
  const account = root.derive(SINGLE_PATH);
  const xpub = account.publicExtendedKey;
  const first = account.deriveChild(0).deriveChild(0).publicKey!;
  return {
    fingerprint,
    account,
    xpub,
    descriptor: `wpkh([${fingerprint}/${SINGLE_ORIGIN}]${xpub}/<0;1>/*)`,
    firstAddress: btc.p2wpkh(first).address!,
  };
}

export interface SinglePsbtReview {
  inputs: Array<{ txid: string; vout: number; sats: bigint; branch: 0 | 1; index: number }>;
  outputs: ReviewedOutput[];
  /** Lo que sale de la cuenta hacia fuera (sin el cambio). */
  sendingSats: bigint;
  feeSats: bigint;
  /** Todas las entradas ya llevan la firma de esta llave. */
  alreadySigned: boolean;
}

/** Nuestra derivación en una entrada o salida (`84'/0'/0'/rama/índice`). */
function ourPath(
  derivations: Array<[Uint8Array, { fingerprint: number; path: number[] }]> | undefined,
  s: SingleSig
): { branch: 0 | 1; index: number; pubkey: Uint8Array } | null {
  const fp = parseInt(s.fingerprint, 16) >>> 0;
  for (const [pubkey, { fingerprint, path }] of derivations ?? []) {
    if (fingerprint >>> 0 !== fp || path.length !== 5) continue;
    if (!SINGLE_PATH_NUMS.every((n, i) => path[i] >>> 0 === n)) continue;
    if (path[3] !== 0 && path[3] !== 1) continue;
    return { branch: path[3], index: path[4], pubkey };
  }
  return null;
}

const childKey = (s: SingleSig, branch: 0 | 1, index: number) => s.account.deriveChild(branch).deriveChild(index);

/** Lee el envío y dice qué hace. Lanza si alguna entrada no es de esta cuenta. */
export function reviewSinglePsbt(psbt: Uint8Array, s: SingleSig): SinglePsbtReview {
  const tx = parsePsbt(psbt);
  if (tx.inputsLength === 0) throw new Error("El envío no tiene entradas.");
  const inputs: SinglePsbtReview["inputs"] = [];
  let inSum = 0n;
  let maxIndex = 0;
  let alreadySigned = true;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const n = i + 1;
    if (!inp.witnessUtxo) throw new Error(`La entrada ${n} no dice cuánto vale (falta witnessUtxo): no se puede comprobar la comisión.`);
    const mine = ourPath(inp.bip32Derivation, s);
    if (!mine) {
      throw new Error(
        `La entrada ${n} no es de tu cuenta de firma única (${SINGLE_ORIGIN}). Si es de tu bóveda multifirma, léela en «Firmar un envío» de la bóveda.`
      );
    }
    const pub = childKey(s, mine.branch, mine.index).publicKey!;
    if (!sameBytes(pub, mine.pubkey)) throw new Error(`La entrada ${n} dice usar tu llave, pero la clave no coincide con tu frase.`);
    if (!sameBytes(p2wpkhScript(pub), inp.witnessUtxo.script)) {
      throw new Error(`La entrada ${n} no es una dirección bc1q… de tu cuenta. No se firma.`);
    }
    const signed = (inp.partialSig ?? []).some(([p]) => sameBytes(p, pub)) || !!inp.finalScriptWitness?.length;
    if (!signed) alreadySigned = false;
    inSum += inp.witnessUtxo.amount;
    maxIndex = Math.max(maxIndex, mine.index);
    inputs.push({
      txid: toHex(inp.txid ?? new Uint8Array()),
      vout: inp.index ?? 0,
      sats: inp.witnessUtxo.amount,
      branch: mine.branch,
      index: mine.index,
    });
  }

  const until = Math.min(maxIndex + CHANGE_LOOKAHEAD, CHANGE_LOOKUP_MAX);
  const outputs: ReviewedOutput[] = [];
  let outSum = 0n;
  let sendingSats = 0n;
  for (let o = 0; o < tx.outputsLength; o++) {
    const out = tx.getOutput(o);
    if (!out.script || out.amount === undefined) throw new Error(`La salida ${o + 1} está incompleta.`);
    let own: ReviewedOutput["own"] = null;
    const declared = ourPath(out.bip32Derivation, s);
    if (declared && sameBytes(p2wpkhScript(childKey(s, declared.branch, declared.index).publicKey!), out.script)) {
      own = { branch: declared.branch, index: declared.index };
    } else {
      own = accountScripts(s, until).get(toHex(out.script)) ?? null;
    }
    outSum += out.amount;
    if (!own) sendingSats += out.amount;
    outputs.push({ address: addressOf(out.script), sats: out.amount, own });
  }
  if (outSum > inSum) throw new Error("Las salidas suman más que las entradas: el envío no es válido.");
  return { inputs, outputs, sendingSats, feeSats: inSum - outSum, alreadySigned };
}

const scriptCache = new WeakMap<HDKey, { until: number; map: Map<string, { branch: 0 | 1; index: number }> }>();

/** Scripts de la cuenta hasta `until`, para reconocer un cambio sin su ruta. */
function accountScripts(s: SingleSig, until: number) {
  const cached = scriptCache.get(s.account);
  if (cached && cached.until >= until) return cached.map;
  const map = cached?.map ?? new Map<string, { branch: 0 | 1; index: number }>();
  const from = cached ? cached.until + 1 : 0;
  for (const branch of [1, 0] as const) {
    const node = s.account.deriveChild(branch);
    for (let index = from; index <= until; index++) {
      map.set(toHex(p2wpkhScript(node.deriveChild(index).publicKey!)), { branch, index });
    }
  }
  scriptCache.set(s.account, { until, map });
  return map;
}

/** Firma todas las entradas (tras las mismas comprobaciones) y devuelve el PSBT. */
export function signSinglePsbt(psbt: Uint8Array, s: SingleSig): Uint8Array {
  reviewSinglePsbt(psbt, s);
  const tx = parsePsbt(psbt);
  for (let i = 0; i < tx.inputsLength; i++) {
    const mine = ourPath(tx.getInput(i).bip32Derivation, s)!;
    const key = childKey(s, mine.branch, mine.index).privateKey;
    if (!key) throw new Error("No se pudo derivar la clave privada.");
    tx.signIdx(key, i);
  }
  return tx.toPSBT();
}
