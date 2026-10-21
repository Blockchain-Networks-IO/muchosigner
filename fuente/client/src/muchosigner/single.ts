/**
 * MuchoSigner como BILLETERA DE FIRMA ÚNICA de Bitcoin
 * (`docs/MUCHOSIGNER.md` §«Firma única»): el móvil es la única llave de una
 * cuenta Bitcoin normal, como un SeedSigner. El monedero la sigue como cuenta
 * de solo lectura (su xpub con origen) y prepara los envíos
 * (`buildLedgerBtcPsbt`); el móvil los revisa y los firma. Puro, sin red ni DOM.
 *
 * Cuentas: cualquier índice (`m/{tipo}'/0'/{cuenta}'`) y los cuatro tipos de
 * dirección que maneja el monedero (`BTC_PURPOSES` de `lib/web3/ledgerBtc.ts`):
 *  - 84 · nativa `bc1q…` (P2WPKH), ECDSA con RFC 6979;
 *  - 49 · anidada `3…` (P2SH-P2WPKH), ECDSA con RFC 6979;
 *  - 86 · Taproot `bc1p…` (BIP-86, solo key-path), Schnorr BIP-340 con el
 *    ajuste de BIP-341 y azar auxiliar a CERO (determinista: ver
 *    `nonce.test.ts`);
 *  - 44 · Legacy `1…`: solo se ENSEÑA para vigilarla; nunca se firma (como en
 *    el monedero: `LEGACY_SPEND_REASON`).
 *
 * Las reglas son las de la bóveda (`core.ts`):
 *  - Solo se firma una entrada que es DE ESTA FRASE: su tipo y su cuenta se
 *    deducen de la ruta que trae el PSBT (con la huella de la frase), la clave
 *    se deriva aquí y el script de la entrada tiene que ser exactamente el de
 *    esa clave para ese tipo. Una entrada ajena —otra frase, otra passphrase,
 *    la bóveda, Legacy— rechaza el envío entero.
 *  - El cambio se COMPRUEBA: una salida solo es «vuelve a tu cuenta» si su
 *    script es una dirección derivada aquí.
 *  - Lo que se enseña antes de firmar sale del MISMO PSBT que se firma.
 *
 * ⚠️ No importa `lib/web3/ledgerBtc.ts`: arrastraría la parte de red del
 * monedero al paquete (lo vigila `paquete.test.ts`). Las direcciones se
 * calculan aquí con las mismas primitivas, y `single.test.ts` comprueba que
 * salen iguales que en el monedero.
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

/** Tipos de dirección (el «purpose» de la ruta). */
export type SinglePurpose = 84 | 49 | 86 | 44;

export interface SingleType {
  purpose: SinglePurpose;
  /** Rótulo corto para la pantalla. */
  label: string;
  /** Cómo empiezan sus direcciones. */
  prefix: string;
  /** El móvil firma sus envíos (Legacy no: solo se vigila). */
  signs: boolean;
}

/** En el orden en que se ofrecen. Mismos tipos que `BTC_PURPOSES` del monedero. */
export const SINGLE_TYPES: readonly SingleType[] = [
  { purpose: 84, label: "Nativa", prefix: "bc1q…", signs: true },
  { purpose: 86, label: "Taproot", prefix: "bc1p…", signs: true },
  { purpose: 49, label: "Anidada", prefix: "3…", signs: true },
  { purpose: 44, label: "Legacy", prefix: "1…", signs: false },
];

/** Cuentas que se pueden elegir: de la 1 (índice 0) a la 100. */
export const SINGLE_MAX_ACCOUNT_INDEX = 99;

export const LEGACY_SIGN_REASON =
  "Legacy (direcciones 1…): MuchoSigner la enseña para que el monedero la vigile, pero no la firma. Para gastar desde ella hace falta otro monedero que firme Legacy.";

const H = 0x80000000;
const SPENDABLE: readonly SinglePurpose[] = [84, 49, 86];

export const typeOf = (purpose: SinglePurpose): SingleType => SINGLE_TYPES.find(t => t.purpose === purpose)!;

/** «Nativa · cuenta 2» (el índice 1 es la cuenta 2, como en el monedero). */
export const accountLabel = (purpose: SinglePurpose, accountIndex: number) =>
  `${typeOf(purpose).label} · cuenta ${accountIndex + 1}`;

export const originOf = (purpose: SinglePurpose, accountIndex: number) => `${purpose}h/0h/${accountIndex}h`;

export interface SingleAccount {
  purpose: SinglePurpose;
  accountIndex: number;
  /** Ruta de la cuenta, `m/84'/0'/0'`. */
  path: string;
  /** Llave de cuenta (privada: no sale de la pestaña). */
  account: HDKey;
  xpub: string;
  /** Lo que lee el monedero: `wpkh([huella/84h/0h/0h]xpub…/<0;1>/*)`, `sh(wpkh(…))`, `tr(…)` o `pkh(…)`. */
  descriptor: string;
  /** Primera dirección de recepción, para comprobarla en el monedero. */
  firstAddress: string;
}

export interface SingleSig extends SingleAccount {
  fingerprint: string;
  /** Raíz de la frase (privada). De ella sale cualquier tipo y cuenta. */
  root: HDKey;
}

const xOnly = (pub: Uint8Array) => pub.slice(1);

/** Pago (script, y redeemScript en la anidada) de una clave para un tipo. */
function paymentFor(pub: Uint8Array, purpose: SinglePurpose) {
  if (purpose === 84) return btc.p2wpkh(pub);
  if (purpose === 86) return btc.p2tr(xOnly(pub));
  if (purpose === 44) return btc.p2pkh(pub);
  return btc.p2sh(btc.p2wpkh(pub));
}

function wrapDescriptor(purpose: SinglePurpose, key: string): string {
  if (purpose === 84) return `wpkh(${key})`;
  if (purpose === 49) return `sh(wpkh(${key}))`;
  if (purpose === 86) return `tr(${key})`;
  return `pkh(${key})`;
}

function checkAccountIndex(accountIndex: number) {
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > SINGLE_MAX_ACCOUNT_INDEX) {
    throw new Error(`La cuenta tiene que ser un número del 1 al ${SINGLE_MAX_ACCOUNT_INDEX + 1}.`);
  }
}

const accountCache = new WeakMap<HDKey, Map<string, SingleAccount>>();

/** La cuenta `m/{tipo}'/0'/{cuenta}'` de la frase. */
export function singleAccount(s: Pick<SingleSig, "root" | "fingerprint">, purpose: SinglePurpose, accountIndex: number): SingleAccount {
  checkAccountIndex(accountIndex);
  if (!SINGLE_TYPES.some(t => t.purpose === purpose)) throw new Error("Tipo de dirección desconocido.");
  const key = `${purpose}/${accountIndex}`;
  let byRoot = accountCache.get(s.root);
  if (!byRoot) accountCache.set(s.root, (byRoot = new Map()));
  const hit = byRoot.get(key);
  if (hit) return hit;
  const path = `m/${purpose}'/0'/${accountIndex}'`;
  const account = s.root.derive(path);
  const xpub = account.publicExtendedKey;
  const first = account.deriveChild(0).deriveChild(0).publicKey!;
  const acc: SingleAccount = {
    purpose,
    accountIndex,
    path,
    account,
    xpub,
    descriptor: wrapDescriptor(purpose, `[${s.fingerprint}/${originOf(purpose, accountIndex)}]${xpub}/<0;1>/*`),
    firstAddress: paymentFor(first, purpose).address!,
  };
  byRoot.set(key, acc);
  return acc;
}

/**
 * La frase como billetera de firma única. Por defecto (y en los campos de
 * primer nivel) la cuenta 1 nativa, `m/84'/0'/0'`: la de casi todos los
 * monederos. Las demás, con `singleAccount`.
 */
export function deriveSingleSig(mnemonic: string, passphrase = ""): SingleSig {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase));
  const fingerprint = (root.fingerprint >>> 0).toString(16).padStart(8, "0");
  return { fingerprint, root, ...singleAccount({ root, fingerprint }, 84, 0) };
}

// ─── Revisar un envío ────────────────────────────────────────────────────────

export interface SingleOwn {
  purpose: SinglePurpose;
  accountIndex: number;
  branch: 0 | 1;
  index: number;
}

export interface SingleReviewedOutput extends ReviewedOutput {
  own: null | SingleOwn;
}

export interface SinglePsbtReview {
  inputs: Array<{ txid: string; vout: number; sats: bigint } & SingleOwn>;
  outputs: SingleReviewedOutput[];
  /** Cuentas (tipo + número) de las que salen las monedas, sin repetir. */
  accounts: Array<{ purpose: SinglePurpose; accountIndex: number }>;
  /** Lo que sale de la frase hacia fuera (sin el cambio). */
  sendingSats: bigint;
  feeSats: bigint;
  /** Todas las entradas ya llevan la firma de esta llave. */
  alreadySigned: boolean;
}

type Derivations = Array<[Uint8Array, { fingerprint: number; path: number[] }]>;
type TapDerivations = Array<[Uint8Array, { hashes: Uint8Array[]; der: { fingerprint: number; path: number[] } }]>;

interface Found extends SingleOwn {
  /** La clave que declara el PSBT (33 bytes; x-only en Taproot). */
  declared: Uint8Array;
}

/**
 * Nuestra derivación en una entrada o salida: `{tipo}'/0'/{cuenta}'/rama/índice`
 * con la huella de la frase. El tipo tiene que casar con el campo: Taproot va en
 * `tapBip32Derivation`; nativa, anidada y Legacy en `bip32Derivation`.
 */
function ourPath(fp: number, bip32: Derivations | undefined, tap: TapDerivations | undefined): Found | null {
  const rows: Array<{ declared: Uint8Array; fingerprint: number; path: number[]; tap: boolean }> = [
    ...(bip32 ?? []).map(([declared, d]) => ({ declared, fingerprint: d.fingerprint, path: d.path, tap: false })),
    ...(tap ?? []).map(([declared, { der }]) => ({ declared, fingerprint: der.fingerprint, path: der.path, tap: true })),
  ];
  for (const { declared, fingerprint, path, tap: isTap } of rows) {
    if (fingerprint >>> 0 !== fp || path.length !== 5) continue;
    const [p, coin, acct, branch, index] = path.map(n => n >>> 0);
    const purpose = (p - H) as SinglePurpose;
    if (p < H || !SINGLE_TYPES.some(t => t.purpose === purpose)) continue;
    if (isTap !== (purpose === 86)) continue;
    if (coin !== H || acct < H || acct - H > SINGLE_MAX_ACCOUNT_INDEX) continue;
    if ((branch !== 0 && branch !== 1) || index >= H) continue;
    return { purpose, accountIndex: acct - H, branch: branch as 0 | 1, index, declared };
  }
  return null;
}

const childKey = (s: SingleSig, o: Pick<SingleOwn, "purpose" | "accountIndex" | "branch" | "index">) =>
  singleAccount(s, o.purpose, o.accountIndex).account.deriveChild(o.branch).deriveChild(o.index);

/** Lee el envío y dice qué hace. Lanza si alguna entrada no es de esta frase. */
export function reviewSinglePsbt(psbt: Uint8Array, s: SingleSig): SinglePsbtReview {
  const tx = parsePsbt(psbt);
  if (tx.inputsLength === 0) throw new Error("El envío no tiene entradas.");
  const fp = parseInt(s.fingerprint, 16) >>> 0;
  const inputs: SinglePsbtReview["inputs"] = [];
  const accounts: SinglePsbtReview["accounts"] = [];
  const maxIndex = new Map<string, number>();
  let inSum = 0n;
  let alreadySigned = true;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const n = i + 1;
    if (!inp.witnessUtxo) throw new Error(`La entrada ${n} no dice cuánto vale (falta witnessUtxo): no se puede comprobar la comisión.`);
    const mine = ourPath(fp, inp.bip32Derivation, inp.tapBip32Derivation);
    if (!mine) {
      throw new Error(
        `La entrada ${n} no es de tu cuenta de firma única (no deriva de esta frase). Si es de tu bóveda multifirma, léela en «Firmar un envío» de la bóveda; si es de otra frase u otra passphrase, ábrela con esa.`
      );
    }
    if (mine.purpose === 44) throw new Error(`La entrada ${n} es de una cuenta Legacy. ${LEGACY_SIGN_REASON}`);
    const pub = childKey(s, mine).publicKey!;
    const declaredOk = mine.purpose === 86 ? sameBytes(xOnly(pub), mine.declared) : sameBytes(pub, mine.declared);
    if (!declaredOk) throw new Error(`La entrada ${n} dice usar tu llave, pero la clave no coincide con tu frase.`);
    const pay = paymentFor(pub, mine.purpose);
    const label = accountLabel(mine.purpose, mine.accountIndex);
    if (!sameBytes(pay.script, inp.witnessUtxo.script)) {
      throw new Error(`La entrada ${n} no es una dirección ${typeOf(mine.purpose).prefix} de tu cuenta (${label}). No se firma.`);
    }
    if (mine.purpose === 49 && !sameBytes("redeemScript" in pay ? pay.redeemScript : undefined, inp.redeemScript)) {
      throw new Error(`La entrada ${n} (${label}) no trae el redeemScript de su dirección. No se firma.`);
    }
    if (mine.purpose === 86) {
      if (!sameBytes(xOnly(pub), inp.tapInternalKey)) {
        throw new Error(`La entrada ${n} (${label}) no trae su clave Taproot (tapInternalKey). No se firma.`);
      }
      if (inp.tapMerkleRoot?.length || inp.tapLeafScript?.length) {
        throw new Error(`La entrada ${n} (${label}) trae scripts Taproot: MuchoSigner solo firma direcciones bc1p… normales (BIP-86). No se firma.`);
      }
    }
    const signed =
      (mine.purpose === 86
        ? !!inp.tapKeySig?.length
        : (inp.partialSig ?? []).some(([p]) => sameBytes(p, pub))) || !!inp.finalScriptWitness?.length;
    if (!signed) alreadySigned = false;
    inSum += inp.witnessUtxo.amount;
    const acctKey = `${mine.purpose}/${mine.accountIndex}`;
    if (!maxIndex.has(acctKey)) accounts.push({ purpose: mine.purpose, accountIndex: mine.accountIndex });
    maxIndex.set(acctKey, Math.max(maxIndex.get(acctKey) ?? 0, mine.index));
    inputs.push({
      txid: toHex(inp.txid ?? new Uint8Array()),
      vout: inp.index ?? 0,
      sats: inp.witnessUtxo.amount,
      purpose: mine.purpose,
      accountIndex: mine.accountIndex,
      branch: mine.branch,
      index: mine.index,
    });
  }

  // Para el cambio que no declara su ruta: las direcciones de los tres tipos
  // que se firman, en cada número de cuenta que usa el envío.
  const lookup = () => {
    const map = new Map<string, SingleOwn>();
    const indexes = [...new Set(accounts.map(a => a.accountIndex))];
    for (const accountIndex of indexes) {
      const top = Math.max(...SPENDABLE.map(p => maxIndex.get(`${p}/${accountIndex}`) ?? 0));
      const until = Math.min(top + CHANGE_LOOKAHEAD, CHANGE_LOOKUP_MAX);
      for (const purpose of SPENDABLE) {
        for (const [script, own] of accountScripts(singleAccount(s, purpose, accountIndex), until)) map.set(script, own);
      }
    }
    return map;
  };
  let lookupMap: Map<string, SingleOwn> | null = null;

  const outputs: SingleReviewedOutput[] = [];
  let outSum = 0n;
  let sendingSats = 0n;
  for (let o = 0; o < tx.outputsLength; o++) {
    const out = tx.getOutput(o);
    if (!out.script || out.amount === undefined) throw new Error(`La salida ${o + 1} está incompleta.`);
    let own: SingleOwn | null = null;
    const declared = ourPath(fp, out.bip32Derivation, out.tapBip32Derivation);
    if (declared && declared.purpose !== 44 && sameBytes(paymentFor(childKey(s, declared).publicKey!, declared.purpose).script, out.script)) {
      own = { purpose: declared.purpose, accountIndex: declared.accountIndex, branch: declared.branch, index: declared.index };
    } else {
      lookupMap ??= lookup();
      own = lookupMap.get(toHex(out.script)) ?? null;
    }
    outSum += out.amount;
    if (!own) sendingSats += out.amount;
    outputs.push({ address: addressOf(out.script), sats: out.amount, own });
  }
  if (outSum > inSum) throw new Error("Las salidas suman más que las entradas: el envío no es válido.");
  return { inputs, outputs, accounts, sendingSats, feeSats: inSum - outSum, alreadySigned };
}

const scriptCache = new WeakMap<HDKey, { until: number; map: Map<string, SingleOwn> }>();

/** Scripts de una cuenta hasta `until`, para reconocer un cambio sin su ruta. */
function accountScripts(acc: SingleAccount, until: number) {
  const cached = scriptCache.get(acc.account);
  if (cached && cached.until >= until) return cached.map;
  const map = cached?.map ?? new Map<string, SingleOwn>();
  const from = cached ? cached.until + 1 : 0;
  for (const branch of [1, 0] as const) {
    const node = acc.account.deriveChild(branch);
    for (let index = from; index <= until; index++) {
      map.set(toHex(paymentFor(node.deriveChild(index).publicKey!, acc.purpose).script), {
        purpose: acc.purpose,
        accountIndex: acc.accountIndex,
        branch,
        index,
      });
    }
  }
  scriptCache.set(acc.account, { until, map });
  return map;
}

/**
 * Azar auxiliar de BIP-340 a cero: la firma Schnorr queda determinista (la
 * misma entrada da la misma firma), como el ECDSA con RFC 6979. Lo permite
 * BIP-340 y lo fija `nonce.test.ts`.
 */
const SCHNORR_AUX = new Uint8Array(32);

/** Firma todas las entradas (tras las mismas comprobaciones) y devuelve el PSBT. */
export function signSinglePsbt(psbt: Uint8Array, s: SingleSig): Uint8Array {
  reviewSinglePsbt(psbt, s);
  const tx = parsePsbt(psbt);
  const fp = parseInt(s.fingerprint, 16) >>> 0;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const mine = ourPath(fp, inp.bip32Derivation, inp.tapBip32Derivation)!;
    const key = childKey(s, mine).privateKey;
    if (!key) throw new Error("No se pudo derivar la clave privada.");
    tx.signIdx(key, i, undefined, SCHNORR_AUX);
  }
  return tx.toPSBT();
}
