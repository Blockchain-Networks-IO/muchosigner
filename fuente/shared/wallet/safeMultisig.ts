/**
 * Multifirma EVM: un Safe con N llaves y un quórum configurable (por defecto
 * 2 de 3: aparato, (mucho) wallet y una llave de respaldo; `docs/MULTIFIRMA-EVM.md`). Reglas PURAS, compartidas por la página de prueba
 * y lo que venga después: qué dueños valen, en qué orden, qué se firma en la
 * ejecución clásica (`execTransaction`) y cómo se juntan las firmas.
 *
 * Lo que firma la ruta 4337 (el `SafeOp` del módulo) lo compone `permissionless`;
 * aquí solo va lo que NO depende de él.
 */
import {
  concatHex,
  encodeFunctionData,
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  getAddress,
  isAddress,
  sliceHex,
  size,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from "viem";

/** El quórum de siempre (y el de las multifirmas guardadas sin umbral). */
export const SAFE_MULTISIG_THRESHOLD = 2;
export const SAFE_MULTISIG_OWNERS = 3;
/**
 * Cuántas llaves puede tener una multifirma del monedero. Desde UNA (21-10-2026,
 * decisión del dueño): Safe admite un solo dueño con umbral 1, y es la forma de
 * guardar dólares con el MuchoSigner (un móvil viejo sin conexión) como única
 * llave, porque el firmador solo firma `SafeTx` de una multifirma registrada.
 */
export const MULTISIG_MIN_OWNERS = 1;
export const MULTISIG_MAX_OWNERS = 10;

/**
 * Ruta de la cuenta de (mucho) wallet DEDICADA a la multifirma: una rama propia
 * (`/7/`), fuera de la de las cuentas (`/0/`) y de la de trading (`/1/`), así
 * que no sale en la home ni se mezcla con ningún saldo. Una llave que solo es
 * dueña de un Safe no tiene por qué firmar nada más.
 */
export const SAFE_MULTISIG_TURNKEY_PATH = "m/44'/60'/0'/7/0";

/**
 * Los dueños en su forma canónica: dirección con checksum y ORDENADOS. El orden
 * entra en la inicialización del Safe y, con ella, en su dirección: si dos
 * pantallas los pasaran en orden distinto, calcularían dos Safes distintos.
 */
export function canonicalOwners(addresses: readonly string[]): Address[] {
  if (addresses.length < 1 || addresses.length > MULTISIG_MAX_OWNERS) {
    throw new Error(`Una multifirma tiene entre 1 y ${MULTISIG_MAX_OWNERS} dueños; hay ${addresses.length}.`);
  }
  const out = addresses.map((a) => {
    if (!isAddress(a, { strict: false })) throw new Error(`Dirección de dueño no válida: ${a}`);
    return getAddress(a);
  });
  if (new Set(out.map((a) => a.toLowerCase())).size !== out.length) {
    throw new Error("Los dueños tienen que ser llaves distintas.");
  }
  return out.sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1));
}

/** Una llamada que sale del Safe. Solo `call` (operation 0): ver `safeTxTypedData`. */
export interface SafeCall {
  to: Address;
  value: bigint;
  data: Hex;
}

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/**
 * El `SafeTx` EIP-712 de la ejecución clásica. Siempre `operation: 0`: un
 * `delegatecall` ejecuta código ajeno CON el almacenamiento del Safe y es
 * exactamente lo que vació a Bybit (febrero de 2025); aquí no se puede pedir.
 * Sin reembolso de gas (lo paga quien ejecuta).
 */
export function safeTxTypedData(p: {
  chainId: number;
  safe: Address;
  call: SafeCall;
  nonce: bigint;
}) {
  return {
    domain: { chainId: p.chainId, verifyingContract: getAddress(p.safe) },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message: {
      to: getAddress(p.call.to),
      value: p.call.value,
      data: p.call.data,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: ZERO,
      refundReceiver: ZERO,
      nonce: p.nonce,
    },
  } as const satisfies TypedDataDefinition;
}

/** Una firma ECDSA de 65 bytes con `v` en 27/28 (lo que espera el Safe). */
export function normalizeEcdsaSignature(sig: Hex): Hex {
  if (size(sig) !== 65) throw new Error("La firma tiene que tener 65 bytes.");
  const v = Number.parseInt(sliceHex(sig, 64, 65).slice(2), 16);
  if (v === 27 || v === 28) return sig;
  if (v === 0 || v === 1) return concatHex([sliceHex(sig, 0, 64), v === 0 ? "0x1b" : "0x1c"]);
  throw new Error(`Valor v inesperado en la firma: ${v}.`);
}

export type OwnerSignature =
  | { signer: Address; signature: Hex }
  /**
   * Firma «pre-validada» de Safe: el dueño ES quien manda `execTransaction`,
   * así que su propia transacción cuenta como su firma (`v = 1`, `r` = su
   * dirección). Con un Ledger, eso cambia un mensaje EIP-712 que firma a
   * ciegas por una transacción normal hacia el Safe.
   */
  | { signer: Address; approvedBySender: true };

/** `r` = dueño, `s` = 0, `v` = 1: el formato de Safe para «aprueba quien envía». */
export function senderApprovalSignature(owner: Address): Hex {
  return `0x${getAddress(owner).slice(2).toLowerCase().padStart(64, "0")}${"0".repeat(64)}01`;
}

/**
 * Junta las firmas como las lee el Safe: ordenadas por dirección de firmante,
 * de menor a mayor (`checkNSignatures` exige el orden y rechaza repetidos).
 */
export function packSafeSignatures(sigs: readonly OwnerSignature[], threshold = SAFE_MULTISIG_THRESHOLD): Hex {
  const unique = new Map<string, OwnerSignature>();
  for (const s of sigs) unique.set(s.signer.toLowerCase(), s);
  if (unique.size < threshold) {
    throw new Error(`Hacen falta ${threshold} firmas de dueños distintos; hay ${unique.size}.`);
  }
  const ordered = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, s]) => s);
  if (ordered.filter((s) => "approvedBySender" in s).length > 1) {
    throw new Error("Solo quien envía la transacción puede aprobar sin firma aparte.");
  }
  return concatHex(
    ordered.map((s) => ("approvedBySender" in s ? senderApprovalSignature(s.signer) : normalizeEcdsaSignature(s.signature))),
  );
}

export const SAFE_EXEC_ABI = [
  {
    name: "execTransaction",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  { name: "nonce", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getThreshold", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getOwners", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
] as const;

/** El calldata de `execTransaction` para ese `SafeTx` con sus firmas ya juntas. */
export function encodeExecTransaction(call: SafeCall, signatures: Hex): Hex {
  return encodeFunctionData({
    abi: SAFE_EXEC_ABI,
    functionName: "execTransaction",
    args: [getAddress(call.to), call.value, call.data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures],
  });
}

/**
 * ¿El Safe desplegado es el que creemos? Dueños y umbral leídos de la cadena
 * contra los esperados: antes de firmar nada con él.
 */
export function onchainSafeMismatch(
  expected: readonly Address[],
  onchainOwners: readonly string[],
  onchainThreshold: bigint,
  expectedThreshold: number = SAFE_MULTISIG_THRESHOLD,
): string | null {
  if (onchainThreshold !== BigInt(expectedThreshold)) {
    return `El Safe pide ${onchainThreshold} firmas, no ${expectedThreshold}.`;
  }
  const a = [...expected].map((x) => x.toLowerCase()).sort();
  const b = [...onchainOwners].map((x) => x.toLowerCase()).sort();
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    return "Los dueños del Safe en la cadena no son los de esta prueba.";
  }
  return null;
}

/**
 * Los DOS hashes que enseña un Ledger cuando firma un EIP-712 a ciegas: el del
 * dominio y el del mensaje. El hash final (`hashTypedData`) no sale en su
 * pantalla, así que enseñar solo ese no sirve para comparar. El final es
 * keccak256(0x1901 ‖ dominio ‖ mensaje).
 */
export function eip712Parts(typed: TypedDataDefinition): { domainHash: Hex; messageHash: Hex } {
  // viem tipa estas dos funciones por el esquema concreto; aquí el esquema es
  // cualquiera (SafeOp o SafeTx), así que van sin tipar.
  const domain = (typed.domain ?? {}) as Record<string, unknown>;
  const types = {
    EIP712Domain: getTypesForEIP712Domain({ domain }),
    ...(typed.types as Record<string, unknown>),
  } as never;
  return {
    domainHash: (hashDomain as (a: unknown) => Hex)({ domain, types }),
    messageHash: (hashStruct as (a: unknown) => Hex)({ data: typed.message, primaryType: typed.primaryType, types }),
  };
}

// ── La multifirma como CUENTA del monedero ──────────────────────────────────
//
// Lo que se guarda de cada multifirma del usuario (colección
// `wallet_safe_multisigs`) para que salga en la barra de cuentas en cualquier
// navegador. Nada secreto: las tres direcciones dueñas, el `saltNonce` (sin él
// no se sabría qué Safe es) y de dónde sale cada llave. Las direcciones son
// públicas en cadena en cuanto el Safe se despliega (`getOwners`).

/**
 * Redes donde OPERA la multifirma (enviar, firmar, WalletConnect, buzón): el
 * mismo Safe tiene la misma dirección en todas, porque sale de la fábrica de
 * Safe 1.4.1 y sus llaves, desplegadas igual en cada una. Ethereum entró el
 * 19-10-2026 (para las posiciones de f(x)); su gas es caro y se avisa al enviar.
 * Una red nueva necesita los contratos de Safe 1.4.1 + el módulo 4337 en sus
 * direcciones de siempre y que el servicio de gas (Pimlico) la cubra.
 */
export const MULTISIG_CHAINS = ["arbitrum", "base", "ethereum"] as const;
export type MultisigChain = (typeof MULTISIG_CHAINS)[number];

const MULTISIG_CHAIN_NAMES: Record<MultisigChain, string> = {
  arbitrum: "Arbitrum",
  base: "Base",
  ethereum: "Ethereum",
};

/** Nombre de una red de la multifirma. */
export function multisigChainName(chain: MultisigChain): string {
  return MULTISIG_CHAIN_NAMES[chain];
}

/** «Arbitrum, Base y Ethereum»: para los textos, que no se quedan viejos al añadir una red. */
export function multisigChainsLabel(): string {
  const names = MULTISIG_CHAINS.map(multisigChainName);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Redes donde el gas es caro: se avisa antes de firmar. */
export const MULTISIG_EXPENSIVE_GAS_CHAINS: readonly MultisigChain[] = ["ethereum"];

/** Tope de multifirmas por usuario (cada una es una entrada de la barra). */
export const MULTISIG_MAX_PER_USER = 10;
export const MULTISIG_NAME_MAX = 32;

/**
 * El papel de una llave en las multifirmas creadas con el asistente de 2 de 3.
 * Las nuevas no lo llevan: cada llave se describe por su ORIGEN y su NOMBRE.
 */
export type MultisigRole = "device" | "mucho" | "backup";

export type MultisigKeyOrigin =
  /** Una cuenta EVM de un Ledger u OneKey (el store de hardware de ESE navegador). */
  | { kind: "device" }
  /** Cuenta dedicada de la (mucho) wallet del usuario (rama `/7/`). */
  | { kind: "mucho"; path: string }
  /**
   * Una llave de respaldo: sub-org de Turnkey cuyo único acceso son sus
   * passkeys (en una llave física o en un gestor de contraseñas; puede tener
   * varias, `backupKey.ts`). El nombre del `kind` es el de siempre: va guardado.
   */
  | { kind: "security-key"; subOrgId: string }
  /**
   * La dirección de OTRA persona (o de un monedero que no está aquí): firma
   * FUERA, desde el enlace del buzón de firmas (§14). No firma en la pantalla
   * de Enviar (`signableHere`), pero sí cuenta para el quórum.
   */
  | { kind: "external" };

export interface MultisigOwnerDef {
  /** Solo en las multifirmas 2 de 3 de antes. */
  role?: MultisigRole;
  address: Address;
  origin: MultisigKeyOrigin;
  /** Cómo la llama el usuario («Ledger del salón», «Pareja»). */
  label?: string;
}

export interface MultisigDef {
  id: string;
  name: string;
  safe: Address;
  saltNonce: string;
  owners: MultisigOwnerDef[];
  /** Firmas necesarias. Ausente = 2 (las creadas antes del quórum configurable). */
  threshold?: number;
  createdAt: string;
}

export const MULTISIG_LABEL_MAX = 32;

/** Firmas que pide la multifirma. */
export function thresholdOf(def: Pick<MultisigDef, "threshold">): number {
  return def.threshold ?? SAFE_MULTISIG_THRESHOLD;
}

/** «2 de 3». */
export function quorumLabel(def: Pick<MultisigDef, "threshold" | "owners">): string {
  return `${thresholdOf(def)} de ${def.owners.length}`;
}

/** Ruta de la cuenta dedicada de la multifirma número `n` (0, 1, …). */
export function multisigTurnkeyPath(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error("Índice de multifirma no válido.");
  return `m/44'/60'/0'/7/${n}`;
}

/** Siguiente índice libre de la rama `/7/` a la vista de las multifirmas ya creadas. */
export function nextMultisigIndex(defs: readonly Pick<MultisigDef, "owners">[]): number {
  let max = -1;
  for (const d of defs) {
    for (const o of d.owners) {
      if (o.origin.kind !== "mucho") continue;
      const m = /^m\/44'\/60'\/0'\/7\/(\d+)$/.exec(o.origin.path);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

export const MULTISIG_SCOPE_PREFIX = "msig:";
export const multisigScopeId = (id: string) => `${MULTISIG_SCOPE_PREFIX}${id}`;
export function parseMultisigScopeId(stored: string | null | undefined): string | null {
  return stored && stored.startsWith(MULTISIG_SCOPE_PREFIX) ? stored.slice(MULTISIG_SCOPE_PREFIX.length) || null : null;
}

/** Nombre de cada llave de las multifirmas 2 de 3 de antes. */
export const MULTISIG_ROLE_LABEL: Record<MultisigRole, string> = {
  device: "Tu hardware wallet",
  mucho: "Tu (mucho) wallet",
  backup: "Tu llave de respaldo",
};

/** Nombre por defecto de una llave según de dónde sale. */
export const MULTISIG_ORIGIN_LABEL: Record<MultisigKeyOrigin["kind"], string> = {
  device: "Hardware wallet",
  mucho: "Tu (mucho) wallet",
  "security-key": "Llave de respaldo",
  external: "Otra persona",
};

/** El nombre de una llave, igual en todas las pantallas. */
export function ownerLabel(o: MultisigOwnerDef): string {
  return o.label?.trim() || (o.role ? MULTISIG_ROLE_LABEL[o.role] : MULTISIG_ORIGIN_LABEL[o.origin.kind]);
}

/** ¿Firma esta llave en la pantalla de Enviar? (las de fuera, por enlace). */
export function signableHere(o: Pick<MultisigOwnerDef, "origin">): boolean {
  return o.origin.kind !== "external";
}

/**
 * Qué llaves firman por defecto: las del día a día primero (la (mucho) wallet,
 * luego los aparatos) y las llaves de respaldo al final, hasta llegar al
 * quórum. `canSign` dice si en ESTE navegador puede firmar (un aparato que no
 * está añadido aquí, no).
 */
export function defaultSigners(
  owners: readonly MultisigOwnerDef[],
  threshold: number,
  canSign: (o: MultisigOwnerDef) => boolean = () => true,
): Address[] {
  const rank = (o: MultisigOwnerDef) =>
    o.origin.kind === "mucho" ? 0 : o.origin.kind === "device" ? (o.role === "backup" ? 2 : 1) : o.origin.kind === "security-key" ? 3 : 9;
  return owners
    .filter((o) => signableHere(o) && canSign(o))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, threshold)
    .map((o) => o.address);
}

/** El quórum que se recomienda para N llaves: la mayoría. */
export function recommendedThreshold(n: number): number {
  return Math.floor(n / 2) + 1;
}

export interface QuorumWarning {
  level: "danger" | "warning";
  text: string;
}

/**
 * Lo que hay que decir de un quórum ANTES de crear la multifirma. Dos extremos
 * que se pagan caros: con 1 firma basta una llave robada; con todas, perder una
 * es perder el dinero.
 */
export function quorumWarnings(threshold: number, owners: readonly Pick<MultisigOwnerDef, "origin">[]): QuorumWarning[] {
  const n = owners.length;
  const out: QuorumWarning[] = [];
  if (n === 1) {
    // Con una sola llave los dos extremos de abajo saltarían a la vez y se
    // contradirían; lo que hay que decir es uno solo.
    out.push({
      level: "danger",
      text: "Con UNA sola llave, quien tenga su frase mueve todo el dinero, y si la pierdes nadie —tampoco nosotros— puede recuperarlo. Es como una cuenta de firma única: guarda esa frase con el mismo cuidado.",
    });
    if (!signableHere(owners[0]!)) {
      out.push({
        level: "warning",
        text: "Esa llave no firma desde este monedero: cada operación la firmará ella, desde un enlace (o por QR si es tu firmador sin conexión), y una cuenta tuya pagará el gas para ejecutarla.",
      });
    }
    return out;
  }
  if (threshold === 1) {
    out.push({
      level: "danger",
      text: "Con 1 firma, CUALQUIERA de las llaves mueve todo el dinero ella sola: no protege más que una cuenta normal, y suma una puerta por cada llave.",
    });
  }
  if (threshold === n) {
    out.push({
      level: "danger",
      text: `Hacen falta las ${n} llaves: si pierdes UNA, el dinero se queda bloqueado para siempre. Nadie —tampoco nosotros— puede recuperarlo.`,
    });
  }
  const here = owners.filter(signableHere).length;
  if (here < threshold) {
    out.push({
      level: "warning",
      text: `Desde este monedero solo firman ${here} de las llaves y hacen falta ${threshold}: para mover el dinero, cada operación la tendrá que firmar una llave de fuera — otra persona desde un enlace que le mandes, o tu firmador sin conexión por QR.`,
    });
  }
  const external = n - here;
  if (external > 0 && here === threshold) {
    out.push({
      level: "warning",
      text: "Si pierdes una de tus llaves, necesitarás que la otra persona firme desde un enlace que le mandes.",
    });
  }
  return out;
}

/**
 * ¿Es válida una multifirma antes de guardarla? Entre 1 y 10 llaves
 * distintas, un quórum entre 1 y el número de llaves (las de otra persona
 * cuentan: firman por el buzón, §14), como mucho una cuenta de la (mucho) wallet (en la rama `/7/`) y
 * nombres razonables. Devuelve el motivo o null.
 */
export function multisigDefProblem(def: Omit<MultisigDef, "id" | "createdAt">): string | null {
  const name = def.name.trim();
  if (!name || name.length > MULTISIG_NAME_MAX) return "El nombre no es válido.";
  if (!isAddress(def.safe, { strict: false })) return "La dirección del Safe no es válida.";
  if (!/^\d{1,40}$/.test(def.saltNonce)) return "El salt no es válido.";
  const n = def.owners.length;
  if (n < MULTISIG_MIN_OWNERS || n > MULTISIG_MAX_OWNERS) {
    return `Una multifirma lleva entre ${MULTISIG_MIN_OWNERS} y ${MULTISIG_MAX_OWNERS} llaves.`;
  }
  const t = thresholdOf(def);
  if (!Number.isInteger(t) || t < 1 || t > n) return "El quórum tiene que estar entre 1 y el número de llaves.";
  try {
    canonicalOwners(def.owners.map((o) => o.address));
  } catch (e) {
    return e instanceof Error ? e.message : "Dueños no válidos.";
  }
  if (def.owners.filter((o) => o.origin.kind === "mucho").length > 1) {
    return "Solo puede haber una llave de la (mucho) wallet.";
  }
  for (const o of def.owners) {
    if (o.label !== undefined && (o.label.trim().length === 0 || o.label.length > MULTISIG_LABEL_MAX)) {
      return "El nombre de una llave no es válido.";
    }
    if (o.origin.kind === "mucho" && !/^m\/44'\/60'\/0'\/7\/\d+$/.test(o.origin.path)) {
      return "La llave de la (mucho) wallet tiene que ser su cuenta dedicada.";
    }
    if (o.origin.kind === "security-key" && !/^[0-9a-f-]{8,64}$/i.test(o.origin.subOrgId)) {
      return "La llave de respaldo no es válida.";
    }
    // Las de antes conservan su papel; un papel tiene que casar con su origen.
    if (o.role === "mucho" && o.origin.kind !== "mucho") return "La llave de la (mucho) wallet no es válida.";
    if (o.role && o.role !== "mucho" && o.origin.kind === "mucho") return "Esa llave no puede ser de la (mucho) wallet.";
  }
  return null;
}

// ── Firmar MENSAJES con la multifirma (EIP-1271, WalletConnect) ───────────────

/**
 * Lo que firman los dueños para que el Safe dé por buena una firma de
 * `digest` (un `personal_sign` ya convertido en su hash EIP-191, o el hash
 * EIP-712 de un `eth_signTypedData`). Es el `SafeMessage` del
 * `CompatibilityFallbackHandler` de Safe: `isValidSignature(digest, firmas)`
 * rehace `keccak256(0x1901 ‖ dominio del Safe ‖ keccak256(abi.encode(
 * SAFE_MSG_TYPEHASH, keccak256(abi.encode(digest)))))` y comprueba las firmas
 * de los dueños sobre ESO, empaquetadas como las de un `SafeTx`.
 */
export const SAFE_MESSAGE_TYPES = {
  SafeMessage: [{ name: "message", type: "bytes" }],
} as const;

export function safeMessageTypedData(p: { chainId: number; safe: Address; digest: Hex }) {
  return {
    domain: { chainId: p.chainId, verifyingContract: p.safe },
    types: SAFE_MESSAGE_TYPES,
    primaryType: "SafeMessage" as const,
    // `abi.encode(bytes32)` de un hash son sus mismos 32 bytes.
    message: { message: p.digest },
  };
}

/** Lo que devuelve `isValidSignature(bytes32,bytes)` cuando la firma vale (EIP-1271). */
export const EIP1271_MAGIC = "0x1626ba7e" as const;
