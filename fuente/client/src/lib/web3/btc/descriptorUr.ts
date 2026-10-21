/**
 * Descriptor multisig ⇄ **BC-UR2** (`ur:crypto-output`), el formato de QR de
 * Blockchain Commons que leen los firmantes y monederos serios (Sparrow,
 * Nunchuk, Keystone, Passport, BlueWallet…).
 *
 * Por qué: un descriptor es una ristra larguísima de xpubs con caracteres que
 * se confunden entre sí (l/I/1, 0/O). Teclearlo a mano es una fuente de
 * errores; escanearlo no. El QR es la vía cómoda y el **texto plano** que se
 * imprime al lado es la red de seguridad (dentro de diez años puede no haber
 * nada a mano capaz de leer un UR, pero un teclado sí).
 *
 * Alcance: `wsh(sortedmulti(m, …))` / `wsh(multi(m, …))` con cosigners por
 * xpub (con su origen `[huella/ruta]`) y/o pubkey fija (camino B). El CBOR y
 * el troceado en partes los pone `@keystonehq/bc-ur-registry` (el SDK que usa
 * Keystone para hablar con Sparrow/Nunchuk), no los reimplementamos.
 *
 * Nota sobre las partes: un UR multiparte de bc-ur es un código fuente (los
 * QR "animados"), pero las **seqLen primeras** partes son las sistemáticas —
 * cada una es un trozo literal del mensaje— así que un juego estático de esas
 * N partes impresas en papel decodifica en cualquier orden. Por eso una hoja
 * de papel con N QR vale como copia de seguridad.
 */
import { Buffer } from "buffer";
import { HDKey } from "@scure/bip32";
import {
  CryptoCoinInfo,
  CryptoCoinInfoNetwork,
  CryptoCoinInfoType,
  CryptoECKey,
  CryptoHDKey,
  CryptoKeypath,
  CryptoOutput,
  MultiKey,
  PathComponent,
  ScriptExpressions,
  URRegistryDecoder,
} from "@keystonehq/bc-ur-registry";
import {
  descriptorChecksum,
  parseDescriptor,
  type MultisigDescriptor,
} from "../btcMultisig";
import { splitUrParts } from "./urText";

export { looksLikeUr, splitUrParts } from "./urText";

/** Versiones BIP-32 de la xpub extendida, por red. */
const XPUB_VERSION = { mainnet: 0x0488b21e, testnet: 0x043587cf } as const;

/**
 * Tope de caracteres por QR. Con ~700 chars en modo alfanumérico (el UR en
 * MAYÚSCULAS entra en ese modo) el QR se queda en torno a la versión 20: denso
 * pero cómodo de escanear desde papel con la cámara de un móvil. Por encima,
 * troceamos en varias partes en vez de imprimir un QR ilegible.
 */
export const MAX_UR_CHARS_PER_PART = 700;

export interface DescriptorUr {
  /** Partes en minúsculas: la forma canónica del UR (para copiar/pegar). */
  parts: string[];
  /** Las mismas partes en MAYÚSCULAS: así el QR usa modo alfanumérico. */
  qrParts: string[];
  /** Tipo de registro UR (`crypto-output`). */
  type: string;
}

// ─── Descriptor → UR ─────────────────────────────────────────────────────────

/** `fp/48h/0h/0h/2h` → huella (4 bytes) + componentes de ruta. */
function parseOriginPath(origin: string): {
  fingerprint?: Buffer;
  components: PathComponent[];
} {
  const tokens = origin.split("/").filter(Boolean);
  let fingerprint: Buffer | undefined;
  if (tokens.length && /^[0-9a-fA-F]{8}$/.test(tokens[0])) {
    fingerprint = Buffer.from(tokens.shift()!, "hex");
  }
  const components = tokens.map(t => {
    const hardened = /[h']$/i.test(t);
    const index = parseInt(t.replace(/[h']$/i, ""), 10);
    if (!Number.isInteger(index) || index < 0)
      throw new Error(`Ruta de origen no válida: "${origin}".`);
    return new PathComponent({ index, hardened });
  });
  return { fingerprint, components };
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function hdKeyFor(
  xpub: string,
  origin: string | undefined,
  index: number
): CryptoHDKey {
  if (!origin) {
    throw new Error(
      `Cosigner ${index + 1}: al xpub le falta su origen [huella/ruta], y sin él el QR no sirve para registrar la bóveda en otro monedero. Vuelve a importar el descriptor tal cual lo exporta el dispositivo (o el .bsms).`
    );
  }
  const node = HDKey.fromExtendedKey(xpub);
  if (!node.publicKey || !node.chainCode)
    throw new Error(`Cosigner ${index + 1}: el xpub no es válido.`);
  const { fingerprint, components } = parseOriginPath(origin);
  if (!components.length) {
    throw new Error(
      `Cosigner ${index + 1}: el origen "${origin}" no tiene ruta de derivación.`
    );
  }
  const testnet = /^tpub/.test(xpub);
  return new CryptoHDKey({
    isMaster: false,
    key: Buffer.from(node.publicKey),
    chainCode: Buffer.from(node.chainCode),
    origin: new CryptoKeypath(components, fingerprint, components.length),
    parentFingerprint: u32be(node.parentFingerprint),
    ...(testnet
      ? {
          useInfo: new CryptoCoinInfo(
            CryptoCoinInfoType.bitcoin,
            CryptoCoinInfoNetwork.testnet
          ),
        }
      : {}),
  });
}

/** Arma el `crypto-output` (wsh + sortedmulti/multi) de un descriptor nuestro. */
function toCryptoOutput(desc: MultisigDescriptor): CryptoOutput {
  const keys = desc.keys.map((k, i) => {
    if (k.xpub) return hdKeyFor(k.xpub, k.origin, i);
    if (k.pubkey)
      return new CryptoECKey({ data: Buffer.from(k.pubkey, "hex") });
    throw new Error(`Cosigner ${i + 1}: sin xpub ni pubkey.`);
  });
  return new CryptoOutput(
    [
      ScriptExpressions.WITNESS_SCRIPT_HASH,
      desc.sorted
        ? ScriptExpressions.SORTED_MULTISIG
        : ScriptExpressions.MULTISIG,
    ],
    new MultiKey(desc.threshold, keys)
  );
}

/**
 * Codifica el descriptor como UR. Devuelve **una** parte si cabe en el tope de
 * caracteres; si no, el juego de partes sistemáticas (1-N … N-N), que decodifica
 * completo y en cualquier orden.
 */
export function descriptorToUr(
  desc: MultisigDescriptor,
  opts: { maxCharsPerPart?: number } = {}
): DescriptorUr {
  const max = opts.maxCharsPerPart ?? MAX_UR_CHARS_PER_PART;
  const output = toCryptoOutput(desc);

  const single = output.toUREncoder(Number.MAX_SAFE_INTEGER).nextPart();
  let parts = [single];
  if (single.length > max) {
    // 2 chars de bytewords por byte + la cabecera/CBOR de cada parte. Bajamos
    // el tamaño de fragmento hasta que TODAS las partes entren en el tope.
    let fragment = Math.max(20, Math.floor((max - 40) / 2) - 24);
    for (let attempt = 0; attempt < 8; attempt++) {
      const encoder = output.toUREncoder(fragment);
      const produced: string[] = [];
      for (let i = 0; i < encoder.fragmentsLength; i++)
        produced.push(encoder.nextPart());
      if (produced.every(p => p.length <= max)) {
        parts = produced;
        break;
      }
      parts = produced;
      fragment = Math.max(20, Math.floor(fragment * 0.8));
    }
  }
  return {
    parts,
    qrParts: parts.map(p => p.toUpperCase()),
    type: output.getRegistryType().getType(),
  };
}

// ─── UR → descriptor ─────────────────────────────────────────────────────────

/** Reconstruye la xpub extendida de un cosigner decodificado. */
function xpubFromHdKey(key: CryptoHDKey): string {
  const components = key.getOrigin()?.getComponents() ?? [];
  const last = components[components.length - 1];
  const testnet =
    key.getUseInfo()?.getNetwork() === CryptoCoinInfoNetwork.testnet;
  const node = new HDKey({
    versions: {
      private: 0x0488ade4,
      public: testnet ? XPUB_VERSION.testnet : XPUB_VERSION.mainnet,
    },
    depth: components.length || (key.getOrigin()?.getDepth() ?? 0),
    index: last ? last.getIndex() + (last.isHardened() ? 0x80000000 : 0) : 0,
    parentFingerprint: key.getParentFingerprint()
      ? key.getParentFingerprint().readUInt32BE(0)
      : 0,
    chainCode: new Uint8Array(key.getChainCode()),
    publicKey: new Uint8Array(key.getKey()),
  });
  return node.publicExtendedKey;
}

/** `[huella/48h/0h/0h/2h]` a partir del keypath decodificado. */
function originOf(key: CryptoHDKey): string {
  const kp = key.getOrigin();
  if (!kp) return "";
  const fp = kp.getSourceFingerprint()?.toString("hex") ?? "";
  const path = kp
    .getComponents()
    .map(c => `${c.getIndex()}${c.isHardened() ? "h" : ""}`)
    .join("/");
  const joined = [fp, path].filter(Boolean).join("/");
  return joined ? `[${joined}]` : "";
}

/**
 * Decodifica un `ur:crypto-output` (una o varias partes) y devuelve el
 * descriptor en nuestra forma canónica, con checksum BIP-380. Valida el
 * resultado parseándolo.
 */
export function urToDescriptor(input: string | string[]): string {
  const parts = Array.isArray(input)
    ? input.map(p => p.trim().toLowerCase())
    : splitUrParts(input);
  if (!parts.length) throw new Error("No se encontró ningún UR (ur:…).");

  const decoder = new URRegistryDecoder();
  for (const part of parts) {
    let accepted = false;
    try {
      accepted = decoder.receivePart(part);
    } catch {
      accepted = false;
    }
    if (!accepted)
      throw new Error(
        `Parte UR no válida (¿se coló un carácter al copiarla?): "${part.slice(0, 24)}…".`
      );
    if (decoder.isComplete()) break;
  }
  if (!decoder.isComplete()) {
    throw new Error(
      `UR incompleto: faltan partes por escanear (${Math.round(decoder.estimatedPercentComplete() * 100)}%).`
    );
  }
  if (!decoder.isSuccess()) {
    throw new Error(
      `No se pudo decodificar el UR: ${decoder.resultError() || "error desconocido"}.`
    );
  }
  const ur = decoder.resultUR();
  if (ur.type !== "crypto-output") {
    throw new Error(
      `Este QR es un "ur:${ur.type}", no el descriptor de una bóveda (ur:crypto-output).`
    );
  }
  const output = CryptoOutput.fromCBOR(ur.cbor);
  const expressions = output
    .getScriptExpressions()
    .map(e => e.getExpression());
  if (expressions[0] !== "wsh") {
    throw new Error(
      `Solo se admiten bóvedas P2WSH: este descriptor es "${expressions.join("(")}".`
    );
  }
  const sorted = expressions[1] === "sortedmulti";
  if (!sorted && expressions[1] !== "multi") {
    throw new Error(
      `Solo se admite multisig (multi/sortedmulti): este descriptor es "${expressions.join("(")}".`
    );
  }
  const multi = output.getMultiKey();
  const keys = multi.getKeys().map(k => {
    if (k.isECKey())
      return (k as CryptoECKey).getData().toString("hex").toLowerCase();
    const hd = k as CryptoHDKey;
    return `${originOf(hd)}${xpubFromHdKey(hd)}/<0;1>/*`;
  });
  const body = `wsh(${sorted ? "sortedmulti" : "multi"}(${multi.getThreshold()},${keys.join(",")}))`;
  const descriptor = `${body}#${descriptorChecksum(body)}`;
  parseDescriptor(descriptor); // valida
  return descriptor;
}
