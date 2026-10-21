/**
 * Buzón de firmas pendientes de una multifirma EVM (`docs/MULTIFIRMA-EVM.md`
 * §14). Reglas PURAS, compartidas por el servidor (que guarda y comprueba) y
 * el navegador (que firma y ejecuta): el hash que firma cada llave se calcula
 * en los dos lados con la MISMA función, así que el servidor nunca se fía de
 * un hash que le mande nadie.
 *
 * Por qué existe: con `sendMultisig4337` las llaves que firman tienen que estar
 * todas en el MISMO navegador y a la vez. Con llaves de otra persona, o un
 * aparato que vive en otra casa, eso no se puede. Aquí la operación se apunta
 * una vez, cada llave firma cuando puede (desde un enlace) y, al llegar al
 * quórum, cualquiera la ejecuta pagando el gas.
 *
 * Va por la ruta CLÁSICA (`SafeTx` + `execTransaction`) y no por 4337: un
 * `SafeOp` lleva el gas y el paymaster dentro, con plazos de minutos, y una
 * firma recogida en tres días ya no valdría.
 */
import { getAddress, hashTypedData, isAddress, isHex, type Address, type Hex } from "viem";
import { safeTxTypedData, type OwnerSignature, type SafeCall } from "./safeMultisig";

/** Lo que dura una operación pendiente: pasado el plazo, ya no se firma ni se ejecuta. */
export const PROPOSAL_TTL_DAYS = 30;
export const PROPOSAL_DESCRIPTION_MAX = 140;
/** Tope del calldata (hex): sobra para un envío, un `approve` o una llamada de Aave. */
export const PROPOSAL_DATA_MAX = 40_000;

export type ProposalStatus =
  /** Faltan firmas. */
  | "collecting"
  /** Tiene el quórum: se puede ejecutar. */
  | "ready"
  /** Ejecutada en cadena. */
  | "executed"
  /** La multifirma ya usó ese turno con OTRA operación: esta ya no vale. */
  | "superseded"
  | "expired"
  | "cancelled";

export interface ProposalSignature {
  signer: Address;
  signature: Hex;
  at: string;
}

export interface SafeProposal {
  id: string;
  safe: Address;
  chain: string;
  chainId: number;
  /** Turno del Safe al que va (`nonce`), en decimal. */
  nonce: string;
  /** Para desplegar el Safe si aún no existe en esa red. */
  saltNonce: string;
  threshold: number;
  owners: { address: Address; label: string }[];
  call: { to: Address; value: string; data: Hex };
  description: string;
  createdAt: string;
  expiresAt: string;
  signatures: ProposalSignature[];
  cancelled?: boolean;
  executedTx?: Hex;
}

export function proposalCall(p: Pick<SafeProposal, "call">): SafeCall {
  return { to: getAddress(p.call.to), value: BigInt(p.call.value), data: p.call.data };
}

/** El `SafeTx` que firma cada llave. */
export function proposalTypedData(p: Pick<SafeProposal, "chainId" | "safe" | "call" | "nonce">) {
  return safeTxTypedData({ chainId: p.chainId, safe: p.safe, call: proposalCall(p), nonce: BigInt(p.nonce) });
}

/** El `safeTxHash`: lo que firma cada llave y lo que enseña un aparato en firma ciega. */
export function proposalHash(p: Pick<SafeProposal, "chainId" | "safe" | "call" | "nonce">): Hex {
  return hashTypedData(proposalTypedData(p));
}

/** ¿Es una llamada que se puede apuntar? Motivo, o `null`. */
export function proposalCallProblem(call: { to: string; value: string; data: string }): string | null {
  if (!isAddress(call.to)) return "El destino no es una dirección válida.";
  if (!/^\d{1,78}$/.test(call.value)) return "El importe no es válido.";
  if (!isHex(call.data) || call.data.length % 2 !== 0) return "Los datos de la llamada no son válidos.";
  if (call.data.length > PROPOSAL_DATA_MAX) return "La llamada es demasiado grande.";
  return null;
}

export function isOwnerOf(p: Pick<SafeProposal, "owners">, address: string): boolean {
  return p.owners.some((o) => o.address.toLowerCase() === address.toLowerCase());
}

/** Una firma por dueño: la última que llegó de cada uno manda. */
export function distinctSigners(sigs: readonly ProposalSignature[]): ProposalSignature[] {
  const by = new Map<string, ProposalSignature>();
  for (const s of sigs) by.set(s.signer.toLowerCase(), s);
  return [...by.values()];
}

/**
 * En qué punto está. `chainNonce` es el turno actual del Safe en cadena
 * (`null` si no se pudo leer o no está desplegado: entonces su turno es 0).
 */
export function proposalStatus(
  p: Pick<SafeProposal, "nonce" | "threshold" | "signatures" | "cancelled" | "executedTx" | "expiresAt">,
  chainNonce: bigint | null,
  now: Date = new Date(),
): ProposalStatus {
  if (p.executedTx) return "executed";
  if (p.cancelled) return "cancelled";
  const current = chainNonce ?? 0n;
  if (current > BigInt(p.nonce)) return "superseded";
  if (now.getTime() > Date.parse(p.expiresAt)) return "expired";
  return distinctSigners(p.signatures).length >= p.threshold ? "ready" : "collecting";
}

/** Las firmas tal como las empaqueta `packSafeSignatures`: las `threshold` primeras de dueños distintos. */
export function signaturesForExec(p: Pick<SafeProposal, "signatures" | "threshold">): OwnerSignature[] {
  const list = distinctSigners(p.signatures);
  if (list.length < p.threshold) {
    throw new Error(`Faltan firmas: hay ${list.length} de ${p.threshold}.`);
  }
  return list.slice(0, p.threshold).map((s) => ({ signer: getAddress(s.signer), signature: s.signature }));
}

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  collecting: "Esperando firmas",
  ready: "Lista para ejecutar",
  executed: "Ejecutada",
  superseded: "Ya no vale",
  expired: "Caducada",
  cancelled: "Cancelada",
};

/** Ruta de la página de firma de una operación (sin el dominio). */
export const proposalPath = (id: string) => `/wallet/multifirma/firmar/${id}`;

/**
 * El `SafeTx` como lo pide `eth_signTypedData_v4` a una extensión del
 * navegador: JSON con `EIP712Domain` declarado y los `uint` como texto (un
 * `bigint` no se serializa).
 */
export function injectedTypedDataJson(p: Pick<SafeProposal, "chainId" | "safe" | "call" | "nonce">): string {
  const typed = proposalTypedData(p);
  return JSON.stringify(
    {
      domain: typed.domain,
      types: {
        EIP712Domain: [
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...typed.types,
      },
      primaryType: typed.primaryType,
      message: typed.message,
    },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  );
}
