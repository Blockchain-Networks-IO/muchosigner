/**
 * Rutas de derivación EVM de otras apps, para un monedero IMPORTADO
 * (decisión del dueño, 07-10-2026; mismo patrón que `solanaDerivation.ts`).
 *
 * Una frase no da UNA dirección EVM: cada app eligió dónde poner el número de
 * cuenta. El monedero deriva el esquema MetaMask (`m/44'/60'/0'/0/{i}`,
 * `evmPath`), pero una frase usada en Ledger Live o en un MyEtherWallet antiguo
 * da OTRA dirección con la misma frase. Bug real: un socio importó su frase de
 * OKX, el bitcoin apareció (la frase era la buena) y su `0x` era distinta de la
 * de OKX, con todo su saldo EVM «desaparecido».
 *
 * Los tres esquemas habituales y dónde ponen la cuenta `i`:
 *   - MetaMask · Rabby · Trust: `m/44'/60'/0'/0/{i}`  (el del monedero)
 *   - Ledger Live:              `m/44'/60'/{i}'/0/0`
 *   - Antiguo (MEW, Ledger Chrome): `m/44'/60'/0'/{i}`
 * En la cuenta 0 MetaMask y Ledger Live coinciden; la antigua no.
 *
 * Una dirección elegida SUSTITUYE a la cuenta EVM de su índice (como en
 * Solana): se crea la elegida y se borra la anterior, para que nunca haya dos
 * cuentas EVM en el mismo índice —todo el monedero asume una por índice—. El
 * «ensure» del arranque compara las EVM por ÍNDICE (`missingAccountParams`),
 * así que no vuelve a crear la de MetaMask encima. Borrar una cuenta de un
 * monedero importado no pierde nada: la semilla sigue ahí y se vuelve a
 * derivar si se elige de nuevo esa ruta.
 */
import { evmPath } from "./evmAccounts";

export type EvmPathScheme = "metamask" | "ledgerLive" | "legacy";

export const EVM_SCHEMES: readonly EvmPathScheme[] = ["metamask", "ledgerLive", "legacy"];

/** Nombre del esquema tal como lo reconoce el usuario (por la app). */
export const EVM_SCHEME_LABELS: Record<EvmPathScheme, string> = {
  metamask: "MetaMask · Rabby · Trust Wallet",
  ledgerLive: "Ledger Live",
  legacy: "MyEtherWallet antiguo · Ledger (app de Chrome)",
};

/** Ruta de la cuenta `i` en un esquema. */
export function evmSchemePath(scheme: EvmPathScheme, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Índice de cuenta EVM inválido: ${index}`);
  }
  if (scheme === "ledgerLive") return `m/44'/60'/${index}'/0/0`;
  if (scheme === "legacy") return `m/44'/60'/0'/${index}`;
  return evmPath(index);
}

const SCHEME_RES: Array<[EvmPathScheme, RegExp]> = [
  ["metamask", /^m\/44'\/60'\/0'\/0\/(\d+)$/],
  ["ledgerLive", /^m\/44'\/60'\/(\d+)'\/0\/0$/],
  ["legacy", /^m\/44'\/60'\/0'\/(\d+)$/],
];

/**
 * Esquema e índice de cuenta de una ruta EVM, o `null` si no es de ninguno
 * (Bitcoin, Solana, las cuentas de trading `m/44'/60'/0'/1/{i}`…). La ruta
 * `m/44'/60'/0'/0/0` es de MetaMask y de Ledger Live a la vez: se da como
 * MetaMask, que es la del monedero.
 */
export function evmSchemeOfPath(
  path: string | null | undefined,
): { scheme: EvmPathScheme; index: number } | null {
  const p = String(path ?? "");
  for (const [scheme, re] of SCHEME_RES) {
    const m = re.exec(p);
    if (m) return { scheme, index: Number(m[1]) };
  }
  return null;
}

/** ¿Es la ruta que el monedero deriva por su cuenta para ese índice? */
export function isDefaultEvmPath(path: string | null | undefined, index: number): boolean {
  return String(path ?? "") === evmPath(index);
}

export interface EvmPathCandidate {
  scheme: EvmPathScheme;
  /** Cuenta del monedero en la que cae (0 = Cuenta 1). */
  accountIndex: number;
  path: string;
}

/** Cuántas cuentas de cada app se ofrecen en el buscador manual. */
export const EVM_FINDER_ACCOUNTS = 3;

/**
 * Rutas que se prueban, en el orden en que se enseñan: MetaMask (la del
 * monedero), Ledger Live y la antigua, sin repetir ruta (la cuenta 0 de
 * MetaMask y de Ledger Live es la misma).
 */
export function evmCandidatePaths(accounts = EVM_FINDER_ACCOUNTS): EvmPathCandidate[] {
  const out: EvmPathCandidate[] = [];
  const seen = new Set<string>();
  for (const scheme of EVM_SCHEMES) {
    for (let i = 0; i < accounts; i++) {
      const path = evmSchemePath(scheme, i);
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ scheme, accountIndex: i, path });
    }
  }
  return out;
}

export interface EvmAccountRef {
  walletAccountId?: string;
  addressFormat?: string | null;
  path?: string | null;
  address?: string;
}

const ETH_FORMAT = "ADDRESS_FORMAT_ETHEREUM";

/**
 * Qué hay que hacer para que `chosen` sea LA cuenta EVM de su índice: crearla
 * si no existe y borrar las demás EVM de ese MISMO índice (en cualquier
 * esquema). Las de otros índices y las cuentas de trading no se tocan. PURA.
 */
export function planEvmPathSwap(
  accounts: readonly EvmAccountRef[],
  chosen: Pick<EvmPathCandidate, "accountIndex" | "path">,
): { create: boolean; deleteIds: string[] } {
  const sameIndex = accounts.filter(
    (a) =>
      String(a.addressFormat ?? "") === ETH_FORMAT &&
      evmSchemeOfPath(a.path)?.index === chosen.accountIndex,
  );
  const create = !sameIndex.some((a) => a.path === chosen.path);
  const deleteIds = sameIndex
    .filter((a) => a.path !== chosen.path)
    .map((a) => a.walletAccountId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return { create, deleteIds };
}

// ── Búsqueda al importar ──────────────────────────────────────────────────────

/**
 * Margen de cuentas SIN saldo por esquema antes de dejar de buscar. Más corto
 * que en Bitcoin a propósito: allí basta una lectura por lotes de direcciones,
 * aquí cada dirección es una lectura de saldo multired (miles de CU en el
 * indexador), y una cuenta EVM no rota direcciones como un cobro Bitcoin.
 */
export const EVM_DISCOVERY_GAP = 3;
/**
 * Red de seguridad: tope de cuentas por esquema. Estaba en 20 y una frase con
 * más de 30 cuentas EVM usadas (caso real, 20-10-2026) se quedaba a medias sin
 * decirlo: el margen de arriba es lo que corta la búsqueda de verdad.
 */
export const EVM_DISCOVERY_MAX_ACCOUNTS = 100;
/**
 * Lecturas de saldo a la vez. Iban de una en una (con 350 ms entre cada una) y
 * cada una es multired: con varias cuentas usadas eran minutos con un círculo
 * girando. En una búsqueda que se hace UNA vez, leer en fila no protege nada:
 * son direcciones de la misma frase consultadas en el mismo minuto igualmente.
 */
export const EVM_DISCOVERY_CONCURRENCY = 4;

/** Lectura de saldo de una dirección; `ok: false` = no se pudo leer (NO es 0). */
export interface EvmBalanceRead {
  ok: boolean;
  usd: number;
  /** Tokens con saldo (aunque no tengan precio). */
  tokens: number;
}

export interface DiscoveredEvm extends EvmPathCandidate {
  address: string;
  balance: EvmBalanceRead;
}

/** Cómo va la búsqueda EVM, para enseñarlo mientras dura. */
export interface EvmDiscoveryProgress {
  /** Direcciones cuyo saldo ya se ha preguntado. */
  read: number;
  /** De ellas, con algo dentro. */
  funded: number;
  /** Suma en dólares de lo encontrado. */
  usd: number;
}

/** ¿Tiene algo? Con saldo en dólares o con tokens sin precio. */
export function evmHasFunds(b: EvmBalanceRead): boolean {
  return b.ok && (b.usd > 0 || b.tokens > 0);
}

/** Limitador de concurrencia mínimo: como mucho `n` tareas a la vez. */
function limiter(n: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * Recorre los tres esquemas A LA VEZ: en cada uno mira las cuentas en orden y
 * sigue mientras haya alguna con saldo en las últimas `gap`. Lo no leído se
 * cuenta y no amplía la búsqueda. `derive` recibe rutas y devuelve sus
 * direcciones en el mismo orden; `balance` lee una dirección. Como mucho
 * `concurrency` lecturas de saldo en vuelo, repartidas entre los esquemas; la
 * misma ruta en dos esquemas (cuenta 0 de MetaMask y Ledger Live) se deriva y
 * se lee UNA vez. Las filas salen en orden de esquema y cuenta, no de llegada.
 */
export async function discoverSeedEvm(params: {
  derive: (paths: string[]) => Promise<string[]>;
  balance: (address: string) => Promise<EvmBalanceRead>;
  gap?: number;
  concurrency?: number;
  maxAccounts?: number;
  onProgress?: (p: EvmDiscoveryProgress) => void;
  signal?: { aborted: boolean };
}): Promise<{ rows: DiscoveredEvm[]; unread: number; complete: boolean }> {
  const gap = params.gap ?? EVM_DISCOVERY_GAP;
  const maxAccounts = params.maxAccounts ?? EVM_DISCOVERY_MAX_ACCOUNTS;
  const limit = limiter(Math.max(1, params.concurrency ?? EVM_DISCOVERY_CONCURRENCY));
  const addressOf = new Map<string, Promise<string>>();
  const rowOf = new Map<string, Promise<DiscoveredEvm>>();
  const rows: DiscoveredEvm[] = [];
  let unread = 0;
  const progress: EvmDiscoveryProgress = { read: 0, funded: 0, usd: 0 };

  const readRow = (c: EvmPathCandidate): Promise<DiscoveredEvm> => {
    const known = rowOf.get(c.path);
    if (known) return known;
    const p = (async () => {
      const address = await addressOf.get(c.path)!;
      const row: DiscoveredEvm = { ...c, address, balance: { ok: false, usd: 0, tokens: 0 } };
      if (params.signal?.aborted) return row;
      row.balance = await limit(async () => {
        if (params.signal?.aborted) return row.balance;
        try {
          return await params.balance(address);
        } catch (e) {
          console.warn("[EvmDiscovery] saldo no leído:", (e as Error).message);
          return { ok: false, usd: 0, tokens: 0 };
        }
      });
      if (params.signal?.aborted && !row.balance.ok) return row;
      if (!row.balance.ok) unread++;
      rows.push(row);
      progress.read++;
      if (evmHasFunds(row.balance)) {
        progress.funded++;
        progress.usd += row.balance.usd;
      }
      params.onProgress?.({ ...progress });
      return row;
    })();
    rowOf.set(c.path, p);
    return p;
  };

  const scanScheme = async (scheme: EvmPathScheme) => {
    let lastFunded = -1;
    let next = 0;
    while (next <= Math.min(lastFunded + gap, maxAccounts - 1)) {
      if (params.signal?.aborted) return;
      const upTo = Math.min(lastFunded + gap, maxAccounts - 1);
      const batch: EvmPathCandidate[] = [];
      for (let i = next; i <= upTo; i++) {
        batch.push({ scheme, accountIndex: i, path: evmSchemePath(scheme, i) });
      }
      next = upTo + 1;
      // Se apunta ANTES de esperar: otro esquema que pida la misma ruta en el
      // mismo instante reutiliza esta derivación en vez de repetirla.
      const fresh = batch.filter((c) => !addressOf.has(c.path));
      if (fresh.length > 0) {
        const derived = params.derive(fresh.map((c) => c.path)).then((addrs) => {
          if (addrs.length !== fresh.length) {
            throw new Error("No se pudieron calcular todas las direcciones EVM de la frase.");
          }
          return addrs;
        });
        fresh.forEach((c, k) => addressOf.set(c.path, derived.then((a) => a[k])));
      }
      const read = await Promise.all(batch.map(readRow));
      batch.forEach((c, k) => {
        if (evmHasFunds(read[k].balance)) lastFunded = Math.max(lastFunded, c.accountIndex);
      });
    }
  };

  await Promise.all(EVM_SCHEMES.map(scanScheme));
  const order = (r: DiscoveredEvm) => EVM_SCHEMES.indexOf(r.scheme) * 1e6 + r.accountIndex;
  rows.sort((a, b) => order(a) - order(b));
  return { rows, unread, complete: unread === 0 && !params.signal?.aborted };
}

export type EvmImportAction =
  /** Crear la cuenta de ese índice (no existía) con esta ruta. */
  | { kind: "create"; candidate: DiscoveredEvm }
  /** Sustituir la cuenta del índice (vacía) por esta, que tiene saldo. */
  | { kind: "swap"; candidate: DiscoveredEvm };

/**
 * Qué se hace SOLO al importar, sin preguntar, y qué se deja para que elija el
 * usuario. Solo lo inequívoco: en un índice cuya cuenta actual está VACÍA (o no
 * existe) y en el que UNA sola ruta tiene saldo. Si la cuenta actual tiene
 * saldo, no se toca; si dos rutas compiten, es un conflicto y decide el
 * usuario en el buscador (nunca se borra a ciegas una cuenta con dinero). PURA.
 */
export function planEvmImport(
  found: readonly DiscoveredEvm[],
  existing: readonly EvmAccountRef[],
): { actions: EvmImportAction[]; conflicts: number[] } {
  const current = new Map<number, string>();
  for (const a of existing) {
    if (String(a.addressFormat ?? "") !== ETH_FORMAT) continue;
    const s = evmSchemeOfPath(a.path);
    if (s && a.address) current.set(s.index, a.address.toLowerCase());
  }
  const funded = new Map<number, DiscoveredEvm[]>();
  for (const f of found) {
    if (!evmHasFunds(f.balance)) continue;
    const list = funded.get(f.accountIndex) ?? [];
    if (!list.some((x) => x.path === f.path)) list.push(f);
    funded.set(f.accountIndex, list);
  }
  const actions: EvmImportAction[] = [];
  const conflicts: number[] = [];
  for (const [index, list] of [...funded.entries()].sort((a, b) => a[0] - b[0])) {
    const cur = current.get(index);
    const curRead = found.find((f) => f.address.toLowerCase() === cur);
    // La cuenta actual tiene saldo (o no se pudo leer): se queda como está.
    if (cur && (!curRead || !curRead.balance.ok || evmHasFunds(curRead.balance))) {
      if (list.some((f) => f.address.toLowerCase() !== cur)) conflicts.push(index);
      continue;
    }
    const others = list.filter((f) => f.address.toLowerCase() !== cur);
    if (others.length !== 1) {
      if (others.length > 1) conflicts.push(index);
      continue;
    }
    actions.push({ kind: cur ? "swap" : "create", candidate: others[0] });
  }
  return { actions, conflicts };
}
