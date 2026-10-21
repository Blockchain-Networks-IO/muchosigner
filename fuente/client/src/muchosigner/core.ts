/**
 * Núcleo del FIRMADOR SIN CONEXIÓN (`muchosigner.html`, `docs/MUCHOSIGNER.md`):
 * convierte un móvil viejo en modo avión en una llave de la bóveda multifirma.
 *
 * Puro y sin red ni DOM, para poder probarlo entero. La pantalla
 * (`standalone.ts`) solo pinta, lee la cámara y llama aquí.
 *
 * ⚠️ Maneja material PRIVADO (la frase y la clave que firma). Nada de esto se
 * guarda: la frase se escribe cada vez y vive lo que dura la pestaña. Lo único
 * que se recuerda (si el usuario quiere) es el descriptor de la bóveda, que es
 * público.
 *
 * Reglas que no se relajan:
 *  - Solo se firma una entrada que es DE LA BÓVEDA registrada y en la que
 *    está NUESTRA llave: su script se recalcula desde el descriptor y tiene que
 *    coincidir byte a byte con lo que trae el PSBT. Un PSBT que mezcle una
 *    entrada ajena se rechaza entero, no se firma «lo que se pueda».
 *  - El cambio se COMPRUEBA, no se supone: una salida solo se presenta como
 *    «vuelve a tu bóveda» si su script es una dirección derivada del
 *    descriptor. Es la defensa de un firmador frente a un ordenador
 *    comprometido que cambie el destino del cambio.
 *  - Lo que se enseña antes de firmar sale del MISMO PSBT que se firma.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as btc from "@scure/btc-signer";
import { deriveAddress, parseDescriptor, type MultisigDescriptor } from "@/lib/web3/btcMultisig";

/** Ruta de la llave de multifirma P2WSH (BIP-48, script type 2). */
export const ACCOUNT_PATH = "m/48'/0'/0'/2'";
export const ACCOUNT_ORIGIN = "48h/0h/0h/2h";
const H = 0x80000000;
const ACCOUNT_PATH_NUMS = [48 + H, 0 + H, 0 + H, 2 + H];

/** Frases que se pueden crear: 12 palabras (128 bits) o 24 (256 bits). */
export type WordCount = 12 | 24;

/**
 * Tiradas de un dado de 6 caras: log2(6) ≈ 2,585 bits cada una, así que 50
 * para 128 bits y 99 para 256 (las mismas que pide SeedSigner).
 */
export const DICE_ROLLS: Record<WordCount, number> = { 12: 50, 24: 99 };
/** Compatibilidad: lo que pedía la v1 (solo 24 palabras). */
export const DICE_ROLLS_24 = DICE_ROLLS[24];
/** Lanzamientos de moneda: un bit cada uno, EXACTOS. */
export const COIN_FLIPS: Record<WordCount, number> = { 12: 128, 24: 256 };

/**
 * Hasta qué índice se busca una salida de la bóveda que no trae su ruta en el
 * PSBT. Por encima del índice más alto que use el envío, para cubrir el
 * cambio «fresco» que elige el coordinador.
 */
export const CHANGE_LOOKAHEAD = 100;
export const CHANGE_LOOKUP_MAX = 3000;

// ─── Semilla ─────────────────────────────────────────────────────────────────

/** Deja solo las tiradas (1–6). Lanza si hay algo que no sea un dado. */
export function normalizeDice(input: string): string {
  const compact = input.replace(/[\s,.;-]+/g, "");
  const bad = compact.match(/[^1-6]/);
  if (bad) throw new Error(`«${bad[0]}» no es una tirada de dado: escribe solo números del 1 al 6.`);
  return compact;
}

/**
 * Frase a partir de las tiradas: entropía = SHA-256 del texto de las tiradas
 * (los dígitos seguidos, «16532…»); para 12 palabras, sus 16 primeros bytes.
 * Es el método de Coldcard y SeedSigner, así que la misma secuencia da la
 * misma frase allí y se puede comprobar con cualquier calculadora de SHA-256 +
 * BIP-39. Más tiradas de las mínimas no sobran: entran en el hash.
 */
export function mnemonicFromDice(input: string, words: WordCount = 24): string {
  const rolls = normalizeDice(input);
  const need = DICE_ROLLS[words];
  if (rolls.length < need) {
    throw new Error(`Faltan tiradas: llevas ${rolls.length} y hacen falta al menos ${need}.`);
  }
  const hash = sha256(new TextEncoder().encode(rolls));
  return entropyToMnemonic(words === 12 ? hash.slice(0, 16) : hash, wordlist);
}

/** Deja solo los lanzamientos (1 = cara, 0 = cruz). Lanza si hay otra cosa. */
export function normalizeCoins(input: string): string {
  const compact = input.replace(/[\s,.;-]+/g, "");
  const bad = compact.match(/[^01]/);
  if (bad) throw new Error(`«${bad[0]}» no es un lanzamiento: escribe 1 para cara y 0 para cruz.`);
  return compact;
}

/**
 * Frase a partir de lanzamientos de moneda: cada lanzamiento ES un bit de la
 * entropía, en orden (1 = cara, 0 = cruz), sin pasar por ningún hash. Así se
 * puede comprobar a mano: las palabras salen de agrupar los bits de 11 en 11
 * (la última lleva además la suma de control). Hacen falta exactamente 128 o
 * 256: ni uno más ni uno menos, porque un bit de más no tiene dónde ir.
 */
export function mnemonicFromCoins(input: string, words: WordCount = 24): string {
  const bits = normalizeCoins(input);
  const need = COIN_FLIPS[words];
  if (bits.length < need) throw new Error(`Faltan lanzamientos: llevas ${bits.length} de ${need}.`);
  if (bits.length > need) throw new Error(`Sobran lanzamientos: llevas ${bits.length} y son exactamente ${need}.`);
  const entropy = new Uint8Array(need / 8);
  for (let i = 0; i < need; i++) if (bits[i] === "1") entropy[i >> 3] |= 0x80 >> (i & 7);
  if (entropy.every(b => b === 0) || entropy.every(b => b === 0xff)) {
    throw new Error("Todos los lanzamientos salen iguales: eso no es azar. Lanza la moneda de verdad.");
  }
  return entropyToMnemonic(entropy, wordlist);
}

/** Frase con el azar del sistema (16 bytes = 12 palabras, 32 = 24). */
export function mnemonicFromRandom(random: Uint8Array): string {
  if (random.length !== 32 && random.length !== 16) throw new Error("Hacen falta 16 o 32 bytes de azar.");
  if (random.every(b => b === random[0])) throw new Error("El azar del sistema no parece azar.");
  return entropyToMnemonic(random, wordlist);
}

/**
 * Lee la frase tal como la escribe una persona: mayúsculas, espacios de más y
 * las CUATRO primeras letras de cada palabra (en BIP-39 inglés bastan para
 * saber cuál es). Lanza diciendo QUÉ palabra falla, o si es la suma de control.
 */
export function parseMnemonic(input: string): string {
  const tokens = input.toLowerCase().trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length !== 24 && tokens.length !== 12) {
    throw new Error(`La frase tiene ${tokens.length} palabras; deben ser 24 (o 12).`);
  }
  const words = tokens.map((t, i) => {
    if (wordlist.includes(t)) return t;
    const matches = t.length >= 4 ? wordlist.filter(w => w.startsWith(t.slice(0, 4))) : [];
    if (matches.length === 1 && matches[0].startsWith(t)) return matches[0];
    throw new Error(`La palabra ${i + 1} («${t}») no es de la lista BIP-39.`);
  });
  const phrase = words.join(" ");
  if (!validateMnemonic(phrase, wordlist)) {
    throw new Error(
      "Todas las palabras existen, pero la frase no cuadra (la última palabra es una suma de control). Revisa el orden y que no falte o sobre ninguna."
    );
  }
  return phrase;
}

/** Posiciones (1-based) que se piden para comprobar que la frase se apuntó bien. */
export function checkPositions(random: Uint8Array, count = 3, total = 24): number[] {
  const out: number[] = [];
  for (let i = 0; out.length < count && i < random.length; i++) {
    const p = (random[i] % total) + 1;
    if (!out.includes(p)) out.push(p);
  }
  return out.sort((a, b) => a - b);
}

// ─── La llave ────────────────────────────────────────────────────────────────

export interface Signer {
  /** Huella de la semilla (8 hex): cambia con cualquier error en frase o passphrase. */
  fingerprint: string;
  /** Llave de cuenta `m/48'/0'/0'/2'` (privada: no sale de la pestaña). */
  account: HDKey;
  xpub: string;
  /** Lo que se le da al coordinador: `[huella/48h/0h/0h/2h]xpub…`. */
  keyExpr: string;
}

export function deriveSigner(mnemonic: string, passphrase = ""): Signer {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase));
  const fingerprint = (root.fingerprint >>> 0).toString(16).padStart(8, "0");
  const account = root.derive(ACCOUNT_PATH);
  const xpub = account.publicExtendedKey;
  return { fingerprint, account, xpub, keyExpr: `[${fingerprint}/${ACCOUNT_ORIGIN}]${xpub}` };
}

// ─── La bóveda ───────────────────────────────────────────────────────────────

export interface VaultCheck {
  desc: MultisigDescriptor;
  /** Posición de nuestra llave en el descriptor (0-based). */
  keyIndex: number;
}

/**
 * Comprueba que la bóveda incluye ESTA llave. Si la huella está pero la xpub
 * no coincide, lo normal es una passphrase distinta a la de la bóveda, y se
 * dice así.
 */
export function checkVault(descriptor: string, signer: Signer): VaultCheck {
  const desc = parseDescriptor(descriptor);
  const fpOrigin = (o?: string) => o?.split("/")[0]?.toLowerCase();
  const keyIndex = desc.keys.findIndex(k => k.xpub === signer.xpub);
  if (keyIndex >= 0) {
    const origin = desc.keys[keyIndex].origin?.toLowerCase().replace(/'/g, "h");
    if (origin && origin !== `${signer.fingerprint}/${ACCOUNT_ORIGIN}`) {
      throw new Error(`Esta bóveda tiene tu llave con otra ruta (${origin}). El firmador solo firma la ruta ${ACCOUNT_ORIGIN}.`);
    }
    return { desc, keyIndex };
  }
  if (desc.keys.some(k => fpOrigin(k.origin) === signer.fingerprint)) {
    throw new Error("La bóveda tiene una llave con tu huella pero otra clave: ¿la creaste con otra passphrase o con otra ruta?");
  }
  throw new Error(`Tu llave (huella ${signer.fingerprint}) no está en esta bóveda. Comprueba la frase y la passphrase.`);
}

// ─── Revisar y firmar un envío ───────────────────────────────────────────────

export interface ReviewedOutput {
  address: string;
  sats: bigint;
  /** Dirección de la bóveda (comprobada derivándola): cambio o envío a sí misma. */
  own: null | { branch: number; index: number };
}

export interface PsbtReview {
  inputs: Array<{ txid: string; vout: number; sats: bigint; branch: number; index: number; signedBy: number }>;
  outputs: ReviewedOutput[];
  /** Lo que sale de la bóveda hacia fuera (sin el cambio). */
  sendingSats: bigint;
  feeSats: bigint;
  /** Firmas que ya trae (la que más tenga de todas las entradas). */
  signaturesBefore: number;
  threshold: number;
  /** Ya llevaba nuestra firma (firmarlo otra vez no añade nada). */
  alreadySignedByUs: boolean;
}

export const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
export const sameBytes = (a?: Uint8Array, b?: Uint8Array) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/** Nuestra entrada de bip32Derivation en una entrada o salida: rama e índice. */
function ourPath(
  derivations: Array<[Uint8Array, { fingerprint: number; path: number[] }]> | undefined,
  signer: Signer
): { branch: 0 | 1; index: number; pubkey: Uint8Array } | null {
  const fp = parseInt(signer.fingerprint, 16) >>> 0;
  for (const [pubkey, { fingerprint, path }] of derivations ?? []) {
    if (fingerprint >>> 0 !== fp || path.length !== 6) continue;
    if (!ACCOUNT_PATH_NUMS.every((n, i) => path[i] >>> 0 === n)) continue;
    // Solo recepción (0) y cambio (1), como deriva el coordinador.
    if (path[4] !== 0 && path[4] !== 1) continue;
    return { branch: path[4], index: path[5], pubkey };
  }
  return null;
}

export function addressOf(script: Uint8Array): string {
  try {
    // `OutScript.decode` y `Address().encode` no comparten el tipo exacto (como en onekey/btc.ts).
    return btc.Address(btc.NETWORK).encode(btc.OutScript.decode(script) as Parameters<ReturnType<typeof btc.Address>["encode"]>[0]);
  } catch {
    return `script ${toHex(script)}`;
  }
}

export function parsePsbt(psbt: Uint8Array): btc.Transaction {
  try {
    return btc.Transaction.fromPSBT(psbt);
  } catch {
    throw new Error("Lo leído no es un envío válido (PSBT). Vuelve a escanear el QR del envío.");
  }
}

/**
 * Lee el envío y dice qué hace, comprobándolo contra la bóveda. Lanza si
 * alguna entrada no es de la bóveda o no lleva nuestra llave.
 */
export function reviewPsbt(psbt: Uint8Array, vault: VaultCheck, signer: Signer): PsbtReview {
  const tx = parsePsbt(psbt);
  const { desc } = vault;
  if (tx.inputsLength === 0) throw new Error("El envío no tiene entradas.");
  const inputs: PsbtReview["inputs"] = [];
  let inSum = 0n;
  let maxIndex = 0;
  let alreadySignedByUs = true;
  let signaturesBefore = 0;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const n = i + 1;
    if (!inp.witnessUtxo) throw new Error(`La entrada ${n} no dice cuánto vale (falta witnessUtxo): no se puede comprobar la comisión.`);
    const mine = ourPath(inp.bip32Derivation, signer);
    if (!mine) throw new Error(`La entrada ${n} no lleva tu llave: este envío no es de tu bóveda (o no le toca firmar a esta llave).`);
    const child = signer.account.deriveChild(mine.branch).deriveChild(mine.index);
    if (!sameBytes(child.publicKey ?? undefined, mine.pubkey)) {
      throw new Error(`La entrada ${n} dice usar tu llave, pero la clave no coincide con tu frase.`);
    }
    const derived = deriveAddress(desc, mine.branch, mine.index);
    if (!sameBytes(derived.script, inp.witnessUtxo.script) || !sameBytes(derived.witnessScript, inp.witnessScript)) {
      throw new Error(`La entrada ${n} no es una dirección de esta bóveda. No se firma.`);
    }
    const sigs = inp.partialSig ?? [];
    signaturesBefore = Math.max(signaturesBefore, sigs.length);
    if (!sigs.some(([pub]) => sameBytes(pub, mine.pubkey))) alreadySignedByUs = false;
    inSum += inp.witnessUtxo.amount;
    maxIndex = Math.max(maxIndex, mine.index);
    inputs.push({
      txid: toHex(inp.txid ?? new Uint8Array()),
      vout: inp.index ?? 0,
      sats: inp.witnessUtxo.amount,
      branch: mine.branch,
      index: mine.index,
      signedBy: sigs.length,
    });
  }

  // Direcciones de la bóveda para reconocer el cambio que no trae su ruta.
  const until = Math.min(maxIndex + CHANGE_LOOKAHEAD, CHANGE_LOOKUP_MAX);
  const vaultLookup = () => vaultScripts(desc, until);

  const outputs: ReviewedOutput[] = [];
  let outSum = 0n;
  let sendingSats = 0n;
  for (let o = 0; o < tx.outputsLength; o++) {
    const out = tx.getOutput(o);
    if (!out.script || out.amount === undefined) throw new Error(`La salida ${o + 1} está incompleta.`);
    let own: ReviewedOutput["own"] = null;
    const declared = ourPath(out.bip32Derivation, signer);
    if (declared && sameBytes(deriveAddress(desc, declared.branch, declared.index).script, out.script)) {
      own = { branch: declared.branch, index: declared.index };
    } else {
      own = vaultLookup().get(toHex(out.script)) ?? null;
    }
    outSum += out.amount;
    if (!own) sendingSats += out.amount;
    outputs.push({ address: addressOf(out.script), sats: out.amount, own });
  }
  if (outSum > inSum) throw new Error("Las salidas suman más que las entradas: el envío no es válido.");
  return {
    inputs,
    outputs,
    sendingSats,
    feeSats: inSum - outSum,
    signaturesBefore,
    threshold: desc.threshold,
    alreadySignedByUs,
  };
}

const scriptCache = new WeakMap<MultisigDescriptor, { until: number; map: Map<string, { branch: 0 | 1; index: number }> }>();

/**
 * Scripts de la bóveda (recepción y cambio) hasta `until`, para reconocer una
 * salida propia que no declara su ruta. Se calcula una vez por bóveda y se
 * amplía si hace falta: en un móvil viejo cada derivación cuesta.
 */
function vaultScripts(desc: MultisigDescriptor, until: number) {
  const cached = scriptCache.get(desc);
  if (cached && cached.until >= until) return cached.map;
  const map = cached?.map ?? new Map<string, { branch: 0 | 1; index: number }>();
  const from = cached ? cached.until + 1 : 0;
  for (const branch of [1, 0] as const) {
    // Un nodo por llave y rama: así cada dirección es UNA derivación por llave.
    const nodes = desc.keys.map(k => (k.xpub ? HDKey.fromExtendedKey(k.xpub).deriveChild(branch) : null));
    for (let index = from; index <= until; index++) {
      const pubs = desc.keys.map((k, i) => (k.pubkey ? hexToBytes(k.pubkey) : nodes[i]!.deriveChild(index).publicKey!));
      if (desc.sorted) pubs.sort(cmpBytes);
      map.set(toHex(btc.p2wsh(btc.p2ms(desc.threshold, pubs)).script), { branch, index });
    }
  }
  scriptCache.set(desc, { until, map });
  return map;
}

function hexToBytes(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map(x => parseInt(x, 16)));
}

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Firma con nuestra llave todas las entradas (tras `reviewPsbt`) y devuelve el PSBT. */
export function signPsbt(psbt: Uint8Array, vault: VaultCheck, signer: Signer): Uint8Array {
  reviewPsbt(psbt, vault, signer); // las mismas comprobaciones, siempre
  const tx = parsePsbt(psbt);
  for (let i = 0; i < tx.inputsLength; i++) {
    const mine = ourPath(tx.getInput(i).bip32Derivation, signer)!;
    const key = signer.account.deriveChild(mine.branch).deriveChild(mine.index).privateKey;
    if (!key) throw new Error("No se pudo derivar la clave privada.");
    tx.signIdx(key, i);
  }
  return tx.toPSBT();
}

/** «0,00125 BTC» con los ceros que hagan falta y sin redondear. */
export function formatBtc(sats: bigint): string {
  const neg = sats < 0n;
  const abs = neg ? -sats : sats;
  const whole = abs / 100000000n;
  const frac = (abs % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  // Miles con punto a mano: es-ES no agrupa los números de 4 cifras.
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${grouped}${frac ? "," + frac : ""} BTC`;
}
