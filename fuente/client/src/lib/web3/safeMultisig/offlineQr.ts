/**
 * La multifirma EVM ⇄ el firmador sin conexión (`muchosigner.html`,
 * `docs/MUCHOSIGNER.md` §«Multifirma EVM»). Todo va por QR, en las
 * dos direcciones:
 *
 *  - **Registrar** (monedero → móvil): la multifirma con sus llaves, su quórum
 *    y su `saltNonce`. Es público; el móvil RECALCULA la dirección del Safe con
 *    esos datos (`counterfactualMultisigAddress`) y solo la apunta si sale la
 *    misma y su llave es una de las dueñas.
 *  - **Firmar** (monedero → móvil): la operación del buzón (§14 de
 *    `MULTIFIRMA-EVM.md`): red, Safe, turno y la llamada. NO viaja el hash: el
 *    móvil lo calcula con la misma función que el servidor (`proposalHash`), así
 *    que lo que enseña es lo que firma.
 *  - **Vuelta** (móvil → monedero): la firma, 65 bytes en hex, en un QR fijo.
 *
 * Las dos primeras van como `ur:bytes` de BC-UR2 (troceado y animado, como el
 * PSBT de la bóveda Bitcoin): una llamada puede pesar decenas de kB. Dentro, un
 * JSON con `t` que dice qué es; se valida campo a campo al leerlo, porque viene
 * de una pantalla y en el móvil decide qué se firma.
 */
import { Buffer } from "buffer";
import { Bytes, URRegistryDecoder } from "@keystonehq/bc-ur-registry";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { MULTISIG_MAX_OWNERS, MULTISIG_NAME_MAX } from "@shared/wallet/safeMultisig";
import { PROPOSAL_DATA_MAX, type SafeProposal } from "@shared/wallet/safeMailbox";
import { PSBT_UR_FRAGMENT_BYTES } from "../btc/psbtUr";

/** La multifirma, para apuntarla en el móvil. */
export interface OfflineSafeReg {
  t: "mucho-safe";
  v: 1;
  name: string;
  safe: Address;
  owners: Address[];
  threshold: number;
  saltNonce: string;
}

/** Una operación del buzón, para firmarla en el móvil. */
export interface OfflineSafeTx {
  t: "mucho-safetx";
  v: 1;
  chainId: number;
  safe: Address;
  nonce: string;
  call: { to: Address; value: string; data: Hex };
}

export type OfflinePayload = OfflineSafeReg | OfflineSafeTx;

export function offlineSafeReg(def: {
  name: string;
  safe: string;
  owners: readonly { address: string }[];
  threshold: number;
  saltNonce: string;
}): OfflineSafeReg {
  return {
    t: "mucho-safe",
    v: 1,
    name: def.name.slice(0, MULTISIG_NAME_MAX),
    safe: getAddress(def.safe),
    owners: def.owners.map((o) => getAddress(o.address)),
    threshold: def.threshold,
    saltNonce: def.saltNonce,
  };
}

export function offlineSafeTx(p: Pick<SafeProposal, "chainId" | "safe" | "nonce" | "call">): OfflineSafeTx {
  return {
    t: "mucho-safetx",
    v: 1,
    chainId: p.chainId,
    safe: getAddress(p.safe),
    nonce: p.nonce,
    call: { to: getAddress(p.call.to), value: p.call.value, data: p.call.data },
  };
}

const BAD = "Ese QR no es de la multifirma (ni su registro ni una operación).";

/** Valida lo leído. Lanza con un motivo claro; nunca deja pasar un campo raro. */
export function parseOfflinePayload(json: string): OfflinePayload {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error(BAD);
  }
  if (!o || typeof o !== "object" || o.v !== 1) throw new Error(BAD);
  const addr = (a: unknown, what: string): Address => {
    if (typeof a !== "string" || !isAddress(a, { strict: false })) throw new Error(`${what} no es una dirección válida.`);
    return getAddress(a);
  };
  const decimal = (x: unknown, what: string): string => {
    if (typeof x !== "string" || !/^\d{1,78}$/.test(x)) throw new Error(`${what} no es válido.`);
    return x;
  };
  if (o.t === "mucho-safe") {
    if (!Array.isArray(o.owners) || o.owners.length < 1 || o.owners.length > MULTISIG_MAX_OWNERS) {
      throw new Error("La multifirma no trae sus llaves.");
    }
    const owners = o.owners.map((a, i) => addr(a, `La llave ${i + 1}`));
    const threshold = o.threshold;
    if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
      throw new Error("El quórum de la multifirma no es válido.");
    }
    const name = typeof o.name === "string" ? o.name.slice(0, MULTISIG_NAME_MAX) : "";
    return {
      t: "mucho-safe",
      v: 1,
      name,
      safe: addr(o.safe, "La multifirma"),
      owners,
      threshold,
      saltNonce: decimal(o.saltNonce, "El salt de la multifirma"),
    };
  }
  if (o.t === "mucho-safetx") {
    const chainId = o.chainId;
    if (typeof chainId !== "number" || !Number.isInteger(chainId) || chainId < 1) throw new Error("La red de la operación no es válida.");
    const call = o.call as Record<string, unknown> | undefined;
    if (!call || typeof call !== "object") throw new Error("La operación no trae la llamada.");
    const data = call.data;
    if (typeof data !== "string" || !isHex(data) || data.length % 2 !== 0 || data.length > PROPOSAL_DATA_MAX) {
      throw new Error("Los datos de la llamada no son válidos.");
    }
    return {
      t: "mucho-safetx",
      v: 1,
      chainId,
      safe: addr(o.safe, "La multifirma"),
      nonce: decimal(o.nonce, "El turno"),
      call: { to: addr(call.to, "El destino"), value: decimal(call.value, "El importe"), data: data.toLowerCase() as Hex },
    };
  }
  throw new Error(BAD);
}

/** Codificador animado (un fotograma por llamada a `nextPart`), en mayúsculas. */
export function offlineQrAnimation(payload: OfflinePayload, fragmentBytes = PSBT_UR_FRAGMENT_BYTES) {
  const encoder = new Bytes(Buffer.from(JSON.stringify(payload), "utf8")).toUREncoder(fragmentBytes);
  return { fragments: encoder.fragmentsLength, nextPart: () => encoder.nextPart().toUpperCase() };
}

export type OfflineCollectorState =
  | { status: "empty" }
  | { status: "partial"; progress: number }
  | { status: "done"; payload: OfflinePayload }
  | { status: "error"; message: string };

/** Junta las partes que lee la cámara, como `PsbtQrCollector`. */
export class OfflineQrCollector {
  private ur: URRegistryDecoder | null = null;
  private state: OfflineCollectorState = { status: "empty" };

  receive(raw: string): OfflineCollectorState {
    if (this.state.status === "done") return this.state;
    const text = raw.trim().toLowerCase();
    if (!/^ur:bytes\//.test(text)) return (this.state = { status: "error", message: BAD });
    if (!this.ur) this.ur = new URRegistryDecoder();
    try {
      this.ur.receivePart(text);
    } catch {
      // Lectura borrosa: se espera al siguiente fotograma.
      return this.state.status === "partial" ? this.state : (this.state = { status: "partial", progress: 0 });
    }
    if (!this.ur.isComplete()) {
      return (this.state = { status: "partial", progress: this.ur.estimatedPercentComplete() });
    }
    if (!this.ur.isSuccess()) {
      this.ur = null;
      return (this.state = { status: "error", message: "No se pudo leer el QR. Vuelve a escanearlo." });
    }
    try {
      const bytes = Bytes.fromCBOR(this.ur.resultUR().cbor).getData();
      return (this.state = { status: "done", payload: parseOfflinePayload(Buffer.from(bytes).toString("utf8")) });
    } catch (e) {
      this.ur = null;
      return (this.state = { status: "error", message: e instanceof Error ? e.message : BAD });
    }
  }
}

/** La firma que devuelve el móvil (65 bytes en hex), o null si el texto no lo es. */
export function parseOfflineSignature(text: string): Hex | null {
  const t = text.trim().toLowerCase();
  return /^0x[0-9a-f]{130}$/.test(t) ? (t as Hex) : null;
}
