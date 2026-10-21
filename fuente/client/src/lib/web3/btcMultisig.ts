/**
 * Mini coordinador de multisig Bitcoin (el rol de Sparrow), watch-only:
 *
 *   - Importa un descriptor `wsh(sortedmulti(m, [origin]xpub/<0;1>/*, …))`
 *   - Deriva direcciones de recepción/cambio (P2WSH sorted multisig)
 *   - Escanea UTXOs y saldo vía mempool.space
 *   - Construye el PSBT de gasto (sin firmar)
 *   - Combina PSBTs firmados por los cosigners, finaliza y emite
 *
 * Los firmantes son externos: Tapsigner (PSBT vía app NFC), Sparrow, o una
 * clave Turnkey (firma programática del sighash — ver doc de arquitectura).
 * Aquí no hay claves privadas: todo es información pública + PSBTs.
 */
import { HDKey } from "@scure/bip32";
import { descriptorChecksum } from "./btc/descriptorChecksum";
import { base64, hex } from "@scure/base";
import * as btc from "@scure/btc-signer";

// ─── Descriptor ──────────────────────────────────────────────────────────────

export interface DescriptorKey {
  /** [fingerprint/path] tal cual aparece en el descriptor (informativo). */
  origin?: string;
  /** xpub base (sin sufijo de derivación). Excluyente con `pubkey`. */
  xpub?: string;
  /**
   * Pubkey comprimida fija de 33 bytes (hex), p.ej. la pata Turnkey en
   * "camino B": misma clave en todas las direcciones (sin derivación ranged).
   */
  pubkey?: string;
}

/**
 * Tope de cosigners de una multifirma P2WSH: el script serializa `m` y `n` con
 * los opcodes pequeños OP_1…OP_16, así que 16 llaves es el techo duro (a partir
 * de ahí `@scure/btc-signer` ni construye el script). El umbral va de 1 a n.
 */
export const MAX_COSIGNERS = 16;

export interface MultisigDescriptor {
  threshold: number;
  keys: DescriptorKey[];
  sorted: boolean;
  raw: string;
}

/**
 * Parsea descriptores estilo Sparrow: `wsh(sortedmulti(2,[fp/48h/0h/0h/2h]xpub…/<0;1>/*,…))#checksum`.
 * Acepta `multi`/`sortedmulti`, sufijos `/<0;1>/*`, `/0/*` o ninguno, y `h` o `'`.
 */
export function parseDescriptor(input: string): MultisigDescriptor {
  const raw = input.trim();
  const noChecksum = raw.replace(/#[a-z0-9]+$/i, "").trim();
  const m = noChecksum.match(
    /^wsh\(\s*(sortedmulti|multi)\(\s*(\d+)\s*,(.+)\)\s*\)$/s
  );
  if (!m) {
    throw new Error(
      "Descriptor no soportado. Esperado: wsh(sortedmulti(m, xpub1, xpub2, …))"
    );
  }
  const sorted = m[1] === "sortedmulti";
  const threshold = parseInt(m[2], 10);

  // Split top-level por comas (los corchetes de origin contienen '/', no comas).
  const keys: DescriptorKey[] = m[3]
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(part => {
      const originMatch = part.match(/^\[([^\]]+)\]/);
      const origin = originMatch?.[1];
      let rest = origin ? part.slice(originMatch![0].length) : part;
      // Quita el sufijo de derivación (/**, /<0;1>/*, /0/*, /1/*, /*)
      rest = rest
        .replace(/\/\*\*$/, "")
        .replace(/\/<\d+;\d+>\/\*$/, "")
        .replace(/\/\{\d+,\d+\}\/\*$/, "")
        .replace(/\/\d+\/\*$/, "")
        .replace(/\/\*$/, "");
      if (/^[xt]pub[1-9A-HJ-NP-Za-km-z]+$/.test(rest)) {
        return { origin, xpub: rest };
      }
      // Pubkey comprimida literal (33 bytes): pata de clave fija (camino B).
      if (/^0[23][0-9a-fA-F]{64}$/.test(rest)) {
        return { origin, pubkey: rest.toLowerCase() };
      }
      throw new Error(
        `Clave no soportada: "${rest.slice(0, 12)}…". Usa un xpub (Sparrow normaliza Zpub→xpub) o una pubkey comprimida de 33 bytes.`
      );
    });

  if (keys.length < 2)
    throw new Error("El descriptor necesita al menos 2 claves.");
  if (keys.length > MAX_COSIGNERS) {
    throw new Error(
      `El descriptor trae ${keys.length} claves y una multifirma P2WSH admite como mucho ${MAX_COSIGNERS}.`
    );
  }
  if (threshold < 1 || threshold > keys.length) {
    throw new Error(`Umbral inválido: ${threshold}-de-${keys.length}.`);
  }
  return { threshold, keys, sorted, raw };
}

/**
 * Extrae el descriptor de un fichero de configuración multisig.
 * Soporta BSMS (BIP-129): localiza la línea `wsh(...)` y opcionalmente la
 * primera dirección para verificación. Si el contenido ya es un descriptor
 * suelto, lo devuelve tal cual.
 */
export function extractDescriptor(content: string): {
  descriptor: string;
  firstAddress?: string;
} {
  const text = content.trim();
  // Caso simple: ya es un descriptor.
  if (/^wsh\(/.test(text) && !/\n/.test(text.split("#")[0])) {
    return { descriptor: text };
  }
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const descriptor = lines.find(l => /^wsh\(/.test(l));
  if (!descriptor) {
    throw new Error(
      "No se encontró un descriptor wsh(...) en el fichero. ¿Es un .bsms válido?"
    );
  }
  // BSMS suele incluir la primera dirección en la última línea (bc1q…).
  const firstAddress = lines.find(l => /^(bc1|tb1|bcrt1)[a-z0-9]+$/i.test(l));
  return { descriptor, firstAddress };
}

// ─── Checksum de descriptor (BIP-380) ────────────────────────────────────────

export { descriptorChecksum };

// ─── Crear un vault (descriptor multisig a partir de claves públicas) ─────────

const RANGE_SUFFIX = /\/(?:\*\*|<\d+;\d+>\/\*|\{\d+,\d+\}\/\*|\d+\/\*|\*)$/;

/**
 * Normaliza una expresión de clave de cosigner para el descriptor:
 *   - xpub/tpub (con o sin `[origin]` y sufijo de rango) → garantiza `/<0;1>/*`
 *     para que derive por dirección (camino A: todo-xpub, registrable en Nunchuk).
 *   - pubkey comprimida de 33 bytes (02/03…) → literal sin derivación
 *     (camino B: pata Turnkey fija; descriptor mixto, solo coordinador).
 */
function normalizeKeyExpr(raw: string, index: number): string {
  const k = raw.trim();
  if (!k) throw new Error(`Falta la clave del cosigner ${index + 1}.`);
  const originMatch = k.match(/^\[([^\]]+)\]/);
  const body = originMatch ? k.slice(originMatch[0].length) : k;
  const stripped = body.replace(RANGE_SUFFIX, "").replace(/^0x/i, "");
  // Pubkey comprimida literal (camino B).
  if (/^0[23][0-9a-fA-F]{64}$/.test(stripped)) return stripped.toLowerCase();
  // xpub/tpub ranged (camino A).
  if (/^[xt]pub[1-9A-HJ-NP-Za-km-z]+$/.test(stripped)) {
    try {
      HDKey.fromExtendedKey(stripped);
    } catch {
      throw new Error(`Cosigner ${index + 1}: el xpub no es válido.`);
    }
    return RANGE_SUFFIX.test(body) ? k : `${k}/<0;1>/*`;
  }
  throw new Error(
    `Cosigner ${index + 1}: usa un xpub/tpub o una pubkey comprimida (02/03…).`
  );
}

/**
 * Origina un descriptor `wsh(sortedmulti(m, …))#chk` a partir de una lista de
 * cosigners (xpubs y/o pubkeys fijas). Calcula el checksum BIP-380 y valida
 * parseando el resultado. Sirve tanto al camino A (todo-xpub, Nunchuk) como al
 * camino B (xpub + pubkey fija de Turnkey, solo coordinador).
 */
export function buildVaultDescriptor(params: {
  threshold: number;
  /** Expresiones de clave: `[fp/…]xpub…` ranged y/o pubkey comprimida hex. */
  keys: string[];
}): { descriptor: string; parsed: MultisigDescriptor } {
  const { threshold, keys } = params;
  if (keys.length < 2) throw new Error("Aporta al menos 2 cosigners.");
  if (keys.length > MAX_COSIGNERS)
    throw new Error(
      `Como mucho ${MAX_COSIGNERS} cosigners: el script multifirma de Bitcoin no admite más llaves.`
    );
  if (threshold < 1 || threshold > keys.length)
    throw new Error(`Umbral inválido: ${threshold}-de-${keys.length}.`);
  const keyExprs = keys.map(normalizeKeyExpr);
  const bodyDesc = `wsh(sortedmulti(${threshold},${keyExprs.join(",")}))`;
  const descriptor = `${bodyDesc}#${descriptorChecksum(bodyDesc)}`;
  return { descriptor, parsed: parseDescriptor(descriptor) };
}

export interface DescriptorInterop {
  /** ¿Lo registran monederos de terceros (Sparrow, Nunchuk, Keystone…)? */
  ok: boolean;
  /** Por qué no, en lenguaje de usuario. Vacío si `ok`. */
  reasons: string[];
}

/**
 * ¿Este descriptor se puede registrar FUERA de nuestro coordinador?
 *
 * Es la misma pregunta que responde `toBsms`, pero sin lanzar, porque también
 * la necesita el QR de la copia de seguridad: un `ur:crypto-output` con una
 * pubkey fija es válido según el estándar y nosotros lo leemos de vuelta, pero
 * los monederos de terceros NO lo aceptan y conviene decirlo antes de que el
 * usuario se lleve el chasco delante del hardware:
 *
 * - **Pubkey fija (camino B)** → en el UR va como `crypto-eckey` (etiqueta 306).
 *   Sparrow separa las eckeys de las hdkeys y su importador solo consume las
 *   hdkeys: se traga el QR y monta la bóveda **sin esa llave**. Nunchuk es más
 *   brusco: su `decodeCryptoOutput` lanza en cuanto una llave no es la etiqueta
 *   303, y sale un «could not parse descriptor». Ninguno de los dos es capaz de
 *   derivar direcciones de un descriptor mixto, así que no hay arreglo por
 *   nuestra parte: es estructural (BSMS lo prohíbe por lo mismo).
 * - **`multi` sin ordenar** → Nunchuk solo acepta `sortedmulti`.
 */
export function descriptorInterop(desc: MultisigDescriptor): DescriptorInterop {
  const reasons: string[] = [];
  const fixed = desc.keys.filter(k => !k.xpub).length;
  if (fixed > 0) {
    reasons.push(
      `${fixed === 1 ? "Una llave no es" : `${fixed} llaves no son`} de un dispositivo con clave pública extendida (xpub): ${fixed === 1 ? "es" : "son"} de (mucho)wallet en la nube. Sparrow importaría la bóveda dejándose esa llave fuera (verías ${desc.keys.length - fixed} de ${desc.keys.length} firmantes) y Nunchuk da «could not parse descriptor».`
    );
  }
  if (!desc.sorted) {
    reasons.push(
      "El descriptor usa `multi` en vez de `sortedmulti`, y Nunchuk solo acepta `sortedmulti`."
    );
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Exporta el vault como fichero **BSMS 1.0 (BIP-129)** para registrarlo en
 * Sparrow/Nunchuk y comprobar compatibilidad. Formato de 4 líneas:
 * `BSMS 1.0` / descriptor con `/**` + checksum / `/0/*,/1/*` / primera dirección.
 * Solo válido para vaults todo-xpub (camino A): BSMS no admite pubkeys fijas.
 */
export function toBsms(desc: MultisigDescriptor): string {
  if (desc.keys.some(k => !k.xpub)) {
    throw new Error(
      "BSMS solo admite cosigners por xpub. Este vault tiene una pubkey fija (camino B), que Sparrow/Nunchuk no registran — usa un vault camino A."
    );
  }
  const inner = desc.keys
    .map(k => `${k.origin ? `[${k.origin}]` : ""}${k.xpub}/**`)
    .join(",");
  const kw = desc.sorted ? "sortedmulti" : "multi";
  const body = `wsh(${kw}(${desc.threshold},${inner}))`;
  const descriptor = `${body}#${descriptorChecksum(body)}`;
  const firstAddress = deriveAddress(desc, 0, 0).address;
  return `BSMS 1.0\n${descriptor}\n/0/*,/1/*\n${firstAddress}\n`;
}

// ─── Derivación de direcciones ───────────────────────────────────────────────

export interface DerivedAddress {
  branch: 0 | 1; // 0 = recepción, 1 = cambio
  index: number;
  address: string;
  /** scriptPubKey (P2WSH) */
  script: Uint8Array;
  witnessScript: Uint8Array;
}

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * Cosigners de una dirección EN EL ORDEN EN QUE ENTRAN AL SCRIPT, con el índice
 * de la pata del descriptor al que pertenece cada pubkey.
 *
 * Con `sortedmulti` ese orden se recalcula en CADA dirección (las pubkeys
 * derivadas se ordenan byte a byte), así que no se puede suponer el del
 * descriptor. Lo usan `deriveAddress` y el firmante por USB de OneKey: si cada
 * uno lo calculara por su cuenta, un día divergirían y el dispositivo firmaría
 * contra un script distinto del que se emite.
 */
export function orderedCosigners(
  desc: MultisigDescriptor,
  branch: 0 | 1,
  index: number
): Array<{ keyIndex: number; pubkey: Uint8Array }> {
  const pubs = desc.keys.map((k, keyIndex) => ({
    keyIndex,
    // Pata de clave fija (camino B): misma pubkey en toda dirección.
    pubkey: k.pubkey
      ? hex.decode(k.pubkey)
      : HDKey.fromExtendedKey(k.xpub!).deriveChild(branch).deriveChild(index)
          .publicKey!,
  }));
  return desc.sorted
    ? [...pubs].sort((a, b) => cmpBytes(a.pubkey, b.pubkey))
    : pubs;
}

export function deriveAddress(
  desc: MultisigDescriptor,
  branch: 0 | 1,
  index: number
): DerivedAddress {
  const ordered = orderedCosigners(desc, branch, index).map(c => c.pubkey);
  const pay = btc.p2wsh(btc.p2ms(desc.threshold, ordered));
  return {
    branch,
    index,
    address: pay.address!,
    script: pay.script,
    witnessScript: (pay as { witnessScript?: Uint8Array }).witnessScript!,
  };
}

// ─── UTXOs y saldo (mempool.space) ──────────────────────────────────────────

export interface ScannedUtxo {
  txid: string;
  vout: number;
  value: number; // sats
  derived: DerivedAddress;
}

export interface ScanResult {
  utxos: ScannedUtxo[];
  /** Direcciones de recepción (rama 0) escaneadas, con su marca de uso. */
  receive: Array<DerivedAddress & { used: boolean }>;
  /** Índices con historial on-chain por rama (0=recepción, 1=cambio). */
  usedIndices: { 0: number[]; 1: number[] };
}

// ─── Construcción del PSBT de gasto ─────────────────────────────────────────

export interface BuildPsbtResult {
  psbtBase64: string;
  feeSats: number;
  changeSats: number;
  inputs: ScannedUtxo[];
  /** true si hubo que fusionar varios UTXOs (relevante para CIOH/privacidad). */
  merged: boolean;
  /** Índice de la rama de cambio usado, si se creó output de cambio. */
  changeIndex?: number;
}

const DUST = 546;

/** Estimación de vsize para inputs P2WSH m-de-n y 2 outputs. */
function estimateVsize(
  nIn: number,
  m: number,
  witnessScriptLen: number
): number {
  const witnessPerInput = 1 + 1 + m * 73 + 1 + witnessScriptLen; // items + empty + sigs + script
  const inputVb = 41 + Math.ceil(witnessPerInput / 4);
  return Math.ceil(11 + nIn * inputVb + 2 * 43);
}

/** Parsea el origin `fp/48h/0h/0h/2h` → fingerprint (uint32) + ruta base (hardened-aware). */
function parseOrigin(origin: string): {
  fingerprint: number;
  basePath: number[];
} {
  const [fpHex, ...parts] = origin.split("/");
  const fingerprint = parseInt(fpHex, 16) >>> 0;
  const basePath = parts.map(p => {
    const hardened = /[h']$/i.test(p);
    const n = parseInt(p.replace(/[h']$/i, ""), 10);
    return hardened ? (n + 0x80000000) >>> 0 : n;
  });
  return { fingerprint, basePath };
}

/**
 * Derivaciones BIP32 (pubkey → fingerprint+path) de un input, para que firmantes
 * con wallet policy (Ledger) o air-gapped (Coldcard/Passport) identifiquen su
 * clave. Solo para cosigners xpub con origen; las pubkeys fijas no llevan ruta.
 */
function bip32DerivationsFor(
  desc: MultisigDescriptor,
  branch: number,
  index: number
): Array<[Uint8Array, { fingerprint: number; path: number[] }]> {
  const out: Array<[Uint8Array, { fingerprint: number; path: number[] }]> = [];
  for (const k of desc.keys) {
    if (!k.xpub || !k.origin) continue;
    const pub = HDKey.fromExtendedKey(k.xpub)
      .deriveChild(branch)
      .deriveChild(index).publicKey;
    if (!pub) continue;
    const { fingerprint, basePath } = parseOrigin(k.origin);
    out.push([pub, { fingerprint, path: [...basePath, branch, index] }]);
  }
  return out;
}

/**
 * Selección de monedas. En **modo privacidad** (`avoidMerge`) intenta usar un
 * **único UTXO** que cubra importe+fee, eligiendo el que deje **menos cambio**
 * (idealmente sin cambio: 1-in/1-out, sin output de cambio que delate) — así
 * no enlaza monedas por la heurística CIOH (common-input-ownership). Si ningún
 * UTXO basta por sí solo, fusiona el mínimo número (mayor primero). En modo
 * económico, greedy mayor-primero.
 */
function selectUtxos(
  utxos: ScannedUtxo[],
  amountSats: number,
  feeRate: number,
  m: number,
  wsLen: number,
  avoidMerge: boolean
): { selected: ScannedUtxo[]; fee: number } {
  const feeFor = (n: number) => Math.ceil(estimateVsize(n, m, wsLen) * feeRate);

  if (avoidMerge) {
    const fee1 = feeFor(1);
    // Único UTXO que cubre, con el menor sobrante (→ menos/ningún cambio).
    const singles = utxos
      .filter(u => u.value >= amountSats + fee1)
      .sort((a, b) => a.value - b.value);
    if (singles.length) return { selected: [singles[0]], fee: fee1 };
    // Ninguno basta solo: hay que fusionar (cae al greedy de abajo).
  }

  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const selected: ScannedUtxo[] = [];
  let inSum = 0;
  let fee = 0;
  for (const u of sorted) {
    selected.push(u);
    inSum += u.value;
    fee = feeFor(selected.length);
    if (inSum >= amountSats + fee) break;
  }
  if (inSum < amountSats + fee) {
    throw new Error(
      `Fondos insuficientes: necesitas ~${amountSats + fee} sats y hay ${inSum}.`
    );
  }
  return { selected, fee };
}

export function buildSpendPsbt(params: {
  desc: MultisigDescriptor;
  utxos: ScannedUtxo[];
  toAddress: string;
  amountSats: number;
  feeRate: number; // sat/vB
  changeAddress: DerivedAddress;
  /** Modo privacidad: evita fusionar UTXOs (CIOH) cuando es posible. */
  avoidMerge?: boolean;
}): BuildPsbtResult {
  const {
    desc,
    utxos,
    toAddress,
    amountSats,
    feeRate,
    changeAddress,
    avoidMerge = false,
  } = params;
  if (amountSats <= DUST) throw new Error("Importe demasiado pequeño (dust).");

  const wsLen = (deriveAddress(desc, 0, 0).witnessScript ?? new Uint8Array())
    .length;
  const { selected, fee: selFee } = selectUtxos(
    utxos,
    amountSats,
    feeRate,
    desc.threshold,
    wsLen,
    avoidMerge
  );
  let fee = selFee;
  const inSum = selected.reduce((s, u) => s + u.value, 0);

  const tx = new btc.Transaction();
  for (const u of selected) {
    tx.addInput({
      txid: u.txid,
      index: u.vout,
      witnessUtxo: { script: u.derived.script, amount: BigInt(u.value) },
      witnessScript: u.derived.witnessScript,
      bip32Derivation: bip32DerivationsFor(
        desc,
        u.derived.branch,
        u.derived.index
      ),
    });
  }
  tx.addOutputAddress(toAddress, BigInt(amountSats));

  let change = inSum - amountSats - fee;
  if (change > DUST) {
    // Con su script y sus rutas: así un firmante (el firmador sin conexión,
    // Coldcard…) puede COMPROBAR que el cambio vuelve a la bóveda.
    tx.addOutput({
      script: changeAddress.script,
      amount: BigInt(change),
      witnessScript: changeAddress.witnessScript,
      bip32Derivation: bip32DerivationsFor(desc, changeAddress.branch, changeAddress.index),
    });
  } else {
    fee += change; // change too small → goes to fee
    change = 0;
  }

  return {
    psbtBase64: base64.encode(tx.toPSBT()),
    feeSats: fee,
    changeSats: change,
    inputs: selected,
    merged: selected.length > 1,
    changeIndex: change > 0 ? changeAddress.index : undefined,
  };
}

// ─── Combinar firmas, finalizar y emitir ─────────────────────────────────────

const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff]; // "psbt\xff"

/** Acepta un PSBT como bytes (fichero .psbt binario) o como string base64. */
export function toPsbtBytes(input: string | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    if (PSBT_MAGIC.every((b, i) => input[i] === b)) return input;
    // Algún wallet exporta el base64 dentro de un fichero de texto.
    return base64.decode(new TextDecoder().decode(input).trim());
  }
  return base64.decode(input.trim());
}

export function combineAndFinalize(inputs: Array<string | Uint8Array>): {
  txHex: string;
  txid: string;
} {
  if (inputs.length === 0) throw new Error("Aporta al menos un PSBT firmado.");
  const txs = inputs.map(i => btc.Transaction.fromPSBT(toPsbtBytes(i)));
  const main = txs[0];
  for (const other of txs.slice(1)) main.combine(other);
  main.finalize();
  return { txHex: main.hex, txid: main.id };
}

/**
 * Combina varios PSBT del mismo gasto **sin finalizar** (acumula firmas
 * parciales) y devuelve el PSBT en base64. Para ir juntando las firmas de los
 * cosigners según llegan, conservando el borrador hasta alcanzar el umbral.
 */
export function combinePsbts(inputs: Array<string | Uint8Array>): string {
  if (inputs.length === 0) throw new Error("Nada que combinar.");
  const txs = inputs.map(i => btc.Transaction.fromPSBT(toPsbtBytes(i)));
  const main = txs[0];
  for (const other of txs.slice(1)) main.combine(other);
  return base64.encode(main.toPSBT());
}

/**
 * Nº de firmas distintas en un PSBT: cuenta las partial signatures del primer
 * input (los firmantes firman todos los inputs a la vez). 0 si no parsea.
 */
export function countSignatures(psbtBase64: string): number {
  try {
    const tx = btc.Transaction.fromPSBT(base64.decode(psbtBase64.trim()));
    if (tx.inputsLength === 0) return 0;
    const inp = tx.getInput(0) as unknown as { partialSig?: unknown[] };
    return inp.partialSig?.length ?? 0;
  } catch {
    return 0;
  }
}

// ─── Cosigner Turnkey: firma raw del sighash → firma parcial en el PSBT ──────
//
// Turnkey no expone xpub, pero su `signRawPayload` firma un sighash de 32 bytes
// (HASH_FUNCTION_NO_OP) y devuelve r/s crudos. Aquí está el pegamento:
//   1. sighashForInput  → el sighash BIP-143 de un input P2WSH (lo que firma Turnkey)
//   2. attachPartialSig → inserta la firma (r,s) como partial signature en el PSBT,
//      normalizando low-S y codificando DER + el byte SIGHASH_ALL.
// Verificado offline simulando la salida de Turnkey (ver tests del repo).

const SIGHASH_ALL = 0x01;
// Orden de la curva secp256k1 (para normalizar low-S; sin esto, los nodos
// rechazan la tx como no estándar — la doc de Turnkey no garantiza low-S).
const SECP256K1_N = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
);

function bigToMinimalBytes(x: bigint): Uint8Array {
  let h = x.toString(16);
  if (h.length % 2) h = "0" + h;
  let b = hex.decode(h);
  if (b.length && (b[0] & 0x80) !== 0) b = Uint8Array.from([0, ...b]); // DER positivo
  return b;
}

function derEncode(r: bigint, s: bigint): Uint8Array {
  const rb = bigToMinimalBytes(r);
  const sb = bigToMinimalBytes(s);
  return Uint8Array.from([
    0x30,
    rb.length + sb.length + 4,
    0x02,
    rb.length,
    ...rb,
    0x02,
    sb.length,
    ...sb,
  ]);
}

/** Sighash BIP-143 (P2WSH) de un input — el digest de 32 bytes que firma Turnkey. */
export function sighashForInput(
  tx: ReturnType<typeof btc.Transaction.fromPSBT>,
  idx: number
): Uint8Array {
  const inp = tx.getInput(idx) as {
    witnessScript?: Uint8Array;
    witnessUtxo?: { amount: bigint };
  };
  if (!inp.witnessScript || !inp.witnessUtxo) {
    throw new Error(`Input ${idx} sin witnessScript/witnessUtxo (¿es P2WSH?).`);
  }
  return tx.preimageWitnessV0(
    idx,
    inp.witnessScript,
    SIGHASH_ALL,
    inp.witnessUtxo.amount
  );
}

/**
 * Firma (r,s hex) de Turnkey → DER canónica (low-S) + byte SIGHASH_ALL, lista
 * para un witness. La reutiliza el lending (gastos de staging/escrow P2WSH).
 */
export function derSigWithHashType(rHex: string, sHex: string): Uint8Array {
  const r = BigInt("0x" + rHex.replace(/^0x/, ""));
  let s = BigInt("0x" + sHex.replace(/^0x/, ""));
  if (s > SECP256K1_N / 2n) s = SECP256K1_N - s; // low-S
  return Uint8Array.from([...derEncode(r, s), SIGHASH_ALL]);
}

/** Inserta la firma (r,s hex) de Turnkey como firma parcial del cosigner `pubkey`. */
export function attachPartialSig(
  tx: ReturnType<typeof btc.Transaction.fromPSBT>,
  idx: number,
  pubkey: Uint8Array,
  rHex: string,
  sHex: string
): void {
  const sig = derSigWithHashType(rHex, sHex);
  tx.updateInput(idx, { partialSig: [[pubkey, sig]] });
}

/**
 * Firma todos los inputs de un PSBT con el cosigner Turnkey.
 * `derivePubkey(idx)` da la pubkey del cosigner Turnkey para ese input
 * (de la xpub importada — camino A — o la pubkey fija — camino B).
 * `signSighash(sighashHex)` envuelve la llamada a Turnkey `signRawPayload`.
 */
export async function cosignWithExternalSigner(
  psbtBase64: string,
  derivePubkey: (idx: number) => Uint8Array,
  signSighash: (sighashHex: string) => Promise<{ r: string; s: string }>
): Promise<string> {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbtBase64.trim()));
  for (let i = 0; i < tx.inputsLength; i++) {
    const sighash = sighashForInput(tx, i);
    const { r, s } = await signSighash(hex.encode(sighash));
    attachPartialSig(tx, i, derivePubkey(i), r, s);
  }
  return base64.encode(tx.toPSBT());
}
