/**
 * PSBT ⇄ QR para los aparatos que firman por CÁMARA (Keystone, Passport, Jade,
 * SeedSigner, Sparrow…). Es la otra mitad del envío «firma en tu aparato»
 * (`WatchedBtcSendDialog`): el fichero `.psbt` sigue valiendo, el QR evita el
 * cable o la tarjeta SD.
 *
 * Ida (monedero → aparato): `ur:crypto-psbt` de BC-UR2, el formato que leen
 * todos los de esa lista. Un PSBT no cabe en un QR, así que va TROCEADO y
 * animado: el codificador es una fuente de fuentes (fountain code), así que
 * pasadas las N partes sistemáticas sigue generando partes mezcladas y el
 * aparato completa aunque se haya saltado alguna. El CBOR y las bytewords los
 * pone `@keystonehq/bc-ur-registry` (la misma librería que la bóveda
 * multifirma, `descriptorUr.ts`), no se reimplementan.
 *
 * Vuelta (aparato → monedero): `PsbtQrCollector` va recibiendo lo que lee la
 * cámara y dice cuándo tiene el PSBT entero. Acepta los tres formatos que
 * devuelven los aparatos de verdad: UR (`ur:crypto-psbt` y el nombre nuevo
 * `ur:psbt`), las partes `pMofN` de Specter/SeedSigner antiguo, y un PSBT
 * suelto en base64 o hex cuando cabe en un QR. No valida que sea el envío
 * preparado: eso lo hace `finalizeAirgapPsbt`, que es quien decide si se emite.
 */
import { Buffer } from "buffer";
import { base64, hex } from "@scure/base";
import { CryptoPSBT, URRegistryDecoder } from "@keystonehq/bc-ur-registry";

const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff]; // "psbt\xff"

/**
 * Bytes por fragmento. ~200 da QR de unos 450 caracteres en mayúsculas
 * (modo alfanumérico): densos lo justo para que la cámara de un aparato los
 * lea a un palmo de una pantalla de móvil. Más grandes fallan en Jade/Passport.
 */
export const PSBT_UR_FRAGMENT_BYTES = 200;

/** Ritmo de la animación (ms por parte). El de Sparrow y Keystone. */
export const PSBT_QR_FRAME_MS = 250;

function isPsbtBytes(b: Uint8Array): boolean {
  return PSBT_MAGIC.every((m, i) => b[i] === m);
}

/** Codificador animado: cada `nextPart()` es el texto de un fotograma (en mayúsculas, modo alfanumérico). */
export interface PsbtUrAnimation {
  /** Partes sistemáticas: con estas, en cualquier orden, ya se decodifica. */
  fragments: number;
  nextPart: () => string;
}

export function psbtUrAnimation(
  psbtBase64: string,
  fragmentBytes = PSBT_UR_FRAGMENT_BYTES
): PsbtUrAnimation {
  const bytes = base64.decode(psbtBase64.trim());
  if (!isPsbtBytes(bytes)) throw new Error("No es un PSBT.");
  const encoder = new CryptoPSBT(Buffer.from(bytes)).toUREncoder(fragmentBytes);
  return {
    fragments: encoder.fragmentsLength,
    nextPart: () => encoder.nextPart().toUpperCase(),
  };
}

export type CollectorState =
  | { status: "empty" }
  | { status: "partial"; progress: number; format: "ur" | "specter" }
  | { status: "done"; psbt: Uint8Array }
  | { status: "error"; message: string };

const NOT_A_PSBT =
  "Ese QR no es un PSBT. En tu aparato, después de firmar, enseña el PSBT firmado (no la dirección ni la transacción final).";

/** Base64 o hex de un PSBT entero, o null si no lo es. */
function wholePsbt(text: string): Uint8Array | null {
  const t = text.trim();
  try {
    if (/^[0-9a-f]+$/i.test(t) && t.length % 2 === 0) {
      const b = hex.decode(t.toLowerCase());
      return isPsbtBytes(b) ? b : null;
    }
    const b = base64.decode(t);
    return isPsbtBytes(b) ? b : null;
  } catch {
    return null;
  }
}

/**
 * Junta las partes que va leyendo la cámara. Las repetidas no estorban (la
 * cámara lee el mismo fotograma varias veces); empezar otro formato a mitad
 * reinicia, porque son dos códigos distintos en pantalla.
 */
export class PsbtQrCollector {
  private ur: URRegistryDecoder | null = null;
  private specter: { total: number; parts: Map<number, string> } | null = null;
  private state: CollectorState = { status: "empty" };

  get current(): CollectorState {
    return this.state;
  }

  receive(raw: string): CollectorState {
    if (this.state.status === "done") return this.state;
    const text = raw.trim();
    if (!text) return this.state;

    if (/^ur:/i.test(text)) return (this.state = this.receiveUr(text.toLowerCase()));

    const sp = /^p(\d+)of(\d+)\s+(\S+)$/i.exec(text);
    if (sp) return (this.state = this.receiveSpecter(Number(sp[1]), Number(sp[2]), sp[3]));

    const whole = wholePsbt(text);
    if (whole) return (this.state = { status: "done", psbt: whole });
    return (this.state = { status: "error", message: NOT_A_PSBT });
  }

  private receiveUr(part: string): CollectorState {
    const type = /^ur:([a-z0-9-]+)\//.exec(part)?.[1];
    if (type !== "crypto-psbt" && type !== "psbt") {
      return { status: "error", message: NOT_A_PSBT };
    }
    this.specter = null;
    if (!this.ur) this.ur = new URRegistryDecoder();
    try {
      this.ur.receivePart(part);
    } catch {
      // Una lectura borrosa: se ignora y se espera al siguiente fotograma.
      return this.state.status === "partial" ? this.state : { status: "partial", progress: 0, format: "ur" };
    }
    if (!this.ur.isComplete()) {
      return { status: "partial", progress: this.ur.estimatedPercentComplete(), format: "ur" };
    }
    if (!this.ur.isSuccess()) {
      const message = `No se pudo leer el QR (${this.ur.resultError() || "error desconocido"}). Vuelve a escanearlo.`;
      this.ur = null;
      return { status: "error", message };
    }
    try {
      const psbt = new Uint8Array(CryptoPSBT.fromCBOR(this.ur.resultUR().cbor).getPSBT());
      if (!isPsbtBytes(psbt)) throw new Error("no psbt");
      return { status: "done", psbt };
    } catch {
      this.ur = null;
      return { status: "error", message: NOT_A_PSBT };
    }
  }

  private receiveSpecter(n: number, total: number, chunk: string): CollectorState {
    if (total < 1 || n < 1 || n > total) return { status: "error", message: NOT_A_PSBT };
    this.ur = null;
    if (!this.specter || this.specter.total !== total) {
      this.specter = { total, parts: new Map() };
    }
    this.specter.parts.set(n, chunk);
    if (this.specter.parts.size < total) {
      return { status: "partial", progress: this.specter.parts.size / total, format: "specter" };
    }
    const joined = Array.from({ length: total }, (_, i) => this.specter!.parts.get(i + 1)!).join("");
    const psbt = wholePsbt(joined);
    this.specter = null;
    return psbt ? { status: "done", psbt } : { status: "error", message: NOT_A_PSBT };
  }
}
