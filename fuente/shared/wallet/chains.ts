/**
 * Registro de cadenas del wallet — FUENTE ÚNICA DE VERDAD para metadatos de red
 * (envío, swap/bridge, exploradores, RPC, derivación Turnkey, saldos Moralis).
 *
 * Objetivo de diseño (pedido explícito): **añadir una red nueva = añadir/editar
 * UNA entrada aquí**, sin rediseñar el resto. La UI y la lógica de envío/swap se
 * construyen sobre `enabledChains()` y los helpers de este módulo, nunca sobre
 * listas hardcodeadas. El servidor también deriva de aquí los proveedores EVM:
 * la lista de saldos de Moralis (`moralisParam`) y la tabla del proxy RPC
 * (`moralisRpcSlug`), de modo que ya no hay listas paralelas que sincronizar.
 *
 * Modelo de activación (dos ejes independientes):
 *   - `enabled`: la red existe en la app (el servidor barre saldos, el proxy RPC
 *     la sirve, aparece en los flujos). Todas las EVM + Bitcoin + Solana lo están.
 *   - `optIn`: oculta por defecto; el usuario la "añade" en Ajustes. Para las redes
 *     NO-EVM (Solana, y futuras Sui/XRP/TRON) `optIn` significa además que su cuenta
 *     Turnkey NO se deriva en el alta de la organización: se deriva BAJO DEMANDA al
 *     activarla (`createWalletAccounts`), por eso no hay cuentas no usadas.
 *
 * Las cadenas EVM comparten UNA sola dirección (coinType 60), así que añadir una
 * EVM nueva (casos HyperEVM y BNB Chain) es gratis y NO necesita `optIn`: va
 * visible como el resto. Por contra, cada familia no-EVM (utxo/svm…) necesita
 * su propia cuenta.
 *
 * Las claves coinciden con `WalletChain` de `server/wallet/balanceTypes.ts`.
 */

/** Familia de cadena → determina cómo se construye/firma una transacción. */
export type ChainKind = "evm" | "svm" | "utxo";

export type ChainKey =
  | "ethereum"
  | "arbitrum"
  | "base"
  | "optimism"
  | "polygon"
  | "bnb"
  | "hyperevm"
  | "robinhood"
  | "solana"
  | "bitcoin";

export interface ChainConfig {
  key: ChainKey;
  kind: ChainKind;
  name: string;
  /** Habilitada en la app (la consulta el servidor y el proxy RPC). Activar = `true`. */
  enabled: boolean;
  /**
   * Disponible pero OCULTA por defecto en la UI: el usuario la "añade" en Ajustes
   * (la detección de saldo puede revelarla igualmente). No afecta a si el servidor
   * la consulta — eso lo decide `enabled`.
   */
  optIn?: boolean;
  /** chainId numérico (solo EVM). */
  evmChainId?: number;
  nativeSymbol: string;
  nativeDecimals: number;
  /** Base del explorador, SIN barra final. */
  explorer?: string;
  /**
   * Icono/logo de la red para los selectores. Las EVM pueden caer al logo de
   * Li.Fi si esto falta; las no-EVM (Bitcoin/Solana) lo necesitan aquí.
   */
  icon?: string;
  /** Nombre de la env var del RPC (VITE_* en cliente). */
  rpcEnvKey?: string;
  /** RPC público por defecto (fallback). */
  defaultRpcUrl?: string;
  /** coinType BIP-44 (60 EVM, 0 BTC, 501 Solana) — derivación Turnkey. */
  coinType: number;
  /** Identificador de la cadena en Li.Fi (id numérico EVM o clave). */
  lifiKey?: string | number;
  /** ¿Ruta swap/bridge soportada por Li.Fi para esta cadena? */
  lifi: boolean;
  /** ¿Cubierta por NEAR Intents (1Click)? (incl. BTC nativo). */
  nearIntents: boolean;
  /**
   * Dirección del contrato **Multicall3** en esta cadena. Solo EVM.
   *
   * Sin esto, viem NO puede agrupar lecturas: `batch: { multicall: true }` mira
   * `chain.contracts.multicall3` y, si falta, cada `readContract` sale como una
   * petición HTTP suelta. Ahí estaba el grueso de nuestros 429 (una lectura del
   * pool de préstamos = 7 peticiones; con multicall = 1). Ver
   * `client/src/lib/web3/evm/send.ts`.
   *
   * `0xcA11…ca11` es la dirección canónica de Multicall3, idéntica en todas las
   * cadenas de este catálogo. Se declara por cadena a propósito: una red donde
   * no esté desplegado simplemente se queda sin agrupar (y sigue funcionando),
   * en vez de romper todas las lecturas.
   */
  multicall3?: string;
  /**
   * Parámetro `chain` que entiende la Wallet API de Moralis (saldos EVM). Acepta
   * un alias ("eth", "arbitrum"…) o el hex del chainId ("0x3e7"). Solo EVM.
   * AUSENTE = Moralis no cubre la red y su saldo se lee por RPC
   * (`rpcOnlyEvmChains()`), limitado a la moneda nativa + `knownTokens`.
   */
  moralisParam?: string;
  /**
   * Segmento de ruta del nodo RPC de Moralis para el proxy `/api/rpc`
   * (`site1.moralis-nodes.com/{slug}/{key}`). Solo EVM; opcional (sin clave, el
   * proxy cae al `defaultRpcUrl`).
   */
  moralisRpcSlug?: string;
  /**
   * Nombre de la red en dRPC (`https://lb.drpc.live/<esto>/<clave>`),
   * el proveedor PRINCIPAL del RPC desde septiembre de 2026. Con `DRPC_API_KEY`
   * en el entorno, el proxy construye la URL solo; `<CADENA>_RPC_BACKUP_URL`
   * sigue mandando si está puesta (URL completa de cualquier proveedor). Solo
   * EVM. Añadir una red EVM a dRPC = poner aquí su nombre, sin env nueva.
   */
  drpcNetwork?: string;
}

/**
 * Dirección canónica de Multicall3 — la MISMA en todas las cadenas EVM de este
 * catálogo (se despliega con un deployer determinista). No es un secreto ni
 * cambia: si algún día se añade una red donde no esté, esa entrada se deja sin
 * `multicall3` y viem no agrupará ahí.
 */
export const MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * Catálogo de cadenas. Las EVM de uso general (BNB Chain y HyperEVM incluidas)
 * + Bitcoin habilitadas y visibles; Robinhood Chain y Solana habilitadas pero
 * `optIn` (ocultas hasta que el usuario las activa en Ajustes; en Solana, ese
 * es además el momento en el que se deriva su cuenta Turnkey). Ver nota arriba.
 */
export const CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: "ethereum",
    kind: "evm",
    name: "Ethereum",
    enabled: true,
    evmChainId: 1,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    explorer: "https://etherscan.io",
    rpcEnvKey: "VITE_ETHEREUM_RPC_URL",
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com",
    coinType: 60,
    lifiKey: 1,
    lifi: true,
    nearIntents: true,
    multicall3: MULTICALL3_ADDRESS,
    moralisParam: "eth",
    moralisRpcSlug: "eth",
    drpcNetwork: "ethereum",
  },
  arbitrum: {
    key: "arbitrum",
    kind: "evm",
    name: "Arbitrum",
    enabled: true,
    evmChainId: 42161,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    explorer: "https://arbiscan.io",
    rpcEnvKey: "VITE_ARBITRUM_RPC_URL",
    defaultRpcUrl: "https://arbitrum-one-rpc.publicnode.com",
    coinType: 60,
    lifiKey: 42161,
    lifi: true,
    nearIntents: true,
    multicall3: MULTICALL3_ADDRESS,
    moralisParam: "arbitrum",
    moralisRpcSlug: "arbitrum",
    drpcNetwork: "arbitrum",
  },
  base: {
    key: "base",
    kind: "evm",
    name: "Base",
    enabled: true,
    evmChainId: 8453,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    explorer: "https://basescan.org",
    rpcEnvKey: "VITE_BASE_RPC_URL",
    defaultRpcUrl: "https://base-rpc.publicnode.com",
    coinType: 60,
    lifiKey: 8453,
    lifi: true,
    nearIntents: true,
    multicall3: MULTICALL3_ADDRESS,
    moralisParam: "base",
    moralisRpcSlug: "base",
    drpcNetwork: "base",
  },
  optimism: {
    key: "optimism",
    kind: "evm",
    name: "Optimism",
    enabled: true,
    evmChainId: 10,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    explorer: "https://optimistic.etherscan.io",
    rpcEnvKey: "VITE_OPTIMISM_RPC_URL",
    defaultRpcUrl: "https://optimism-rpc.publicnode.com",
    coinType: 60,
    lifiKey: 10,
    lifi: true,
    nearIntents: true,
    multicall3: MULTICALL3_ADDRESS,
    moralisParam: "optimism",
    moralisRpcSlug: "optimism",
    drpcNetwork: "optimism",
  },
  polygon: {
    key: "polygon",
    kind: "evm",
    name: "Polygon",
    enabled: true,
    evmChainId: 137,
    nativeSymbol: "POL",
    nativeDecimals: 18,
    explorer: "https://polygonscan.com",
    rpcEnvKey: "VITE_POLYGON_RPC_URL",
    defaultRpcUrl: "https://polygon-bor-rpc.publicnode.com",
    coinType: 60,
    lifiKey: 137,
    lifi: true,
    nearIntents: true,
    multicall3: MULTICALL3_ADDRESS,
    moralisParam: "polygon",
    moralisRpcSlug: "polygon",
    drpcNetwork: "polygon",
  },
  bnb: {
    key: "bnb",
    kind: "evm",
    name: "BNB Chain",
    enabled: true,
    // Una EVM más (coinType 60, misma dirección): VISIBLE por defecto, sin
    // `optIn`. Petición de usuarios (19-09-2026): tenían fondos ahí y el
    // monedero ni la nombraba.
    evmChainId: 56,
    nativeSymbol: "BNB",
    nativeDecimals: 18,
    explorer: "https://bscscan.com",
    rpcEnvKey: "VITE_BNB_RPC_URL",
    defaultRpcUrl: "https://bsc-rpc.publicnode.com",
    coinType: 60,
    lifiKey: 56,
    lifi: true,
    nearIntents: true,
    // Multicall3 canónico: contrastado en la definición de `bsc` de viem
    // (`contracts.multicall3`, bloque 15 921 452).
    multicall3: MULTICALL3_ADDRESS,
    // La Data API de Moralis SÍ cubre BNB Chain (alias documentado `bsc`), así
    // que sus tokens salen del indexador —todos, no solo los del catálogo— y
    // NO entra en `rpcOnlyEvmChains()`. Con `BALANCES_PROVIDER=drpc` o
    // `turnkey` también está cubierta (chainId 56 en las dos).
    moralisParam: "bsc",
    moralisRpcSlug: "bsc",
    drpcNetwork: "bsc",
  },
  hyperevm: {
    key: "hyperevm",
    kind: "evm",
    name: "HyperEVM",
    enabled: true,
    // Es una cadena EVM más: comparte la dirección EVM (coinType 60), así que va
    // visible junto al resto (sin separación / sin `optIn`).
    evmChainId: 999,
    nativeSymbol: "HYPE",
    nativeDecimals: 18,
    explorer: "https://hyperevmscan.io",
    rpcEnvKey: "VITE_HYPEREVM_RPC_URL",
    defaultRpcUrl: "https://rpc.hyperliquid.xyz/evm",
    coinType: 60,
    multicall3: MULTICALL3_ADDRESS,
    // SIN `moralisParam` A PROPÓSITO: **la Data API de Moralis no cubre
    // HyperEVM** (su lista de redes soportadas incluye HyperEVM en *Streams*,
    // que es otro producto). Mandarle el hex del chainId, `0x3e7`, devolvía
    // `400 {"message":"chain must be a valid enum value"}` en CADA refresco de
    // saldo, y con eso el total salía marcado como incompleto para siempre.
    //
    // Consecuencia: su saldo NO sale de Moralis. Se lee POR RPC (nativo con
    // `eth_getBalance` + los tokens de `shared/wallet/knownTokens` con
    // `balanceOf`) en `server/wallet/rpcBalances.ts`, que barre
    // `rpcOnlyEvmChains()`: en esta red solo se ve lo que está en ese catálogo.
    // Cuando Moralis la añada a la Data API, basta con devolver aquí
    // `moralisParam: "0x3e7"` y pasa sola al barrido de Moralis.
    //
    // No pongas aquí un alias que no hayas visto en la documentación de la Data
    // API: se probó `0xHYPER`, sacado de un resultado de búsqueda, y era peor
    // que el valor documentado.
    // Slug del nodo RPC de Moralis para HyperEVM (confirmar en el panel; es
    // OPCIONAL: sin MORALIS_RPC_HYPEREVM el proxy usa el RPC público de arriba).
    moralisRpcSlug: "hyperevm",
    // En dRPC HyperEVM (chainId 999) se llama «Hyperliquid»: HyperCore no
    // tiene JSON-RPC, así que su nodo «Hyperliquid» ES la EVM.
    drpcNetwork: "hyperliquid",
    // Swap/bridge: Li.Fi soporta HyperEVM como cadena EVM (chainId 999), así que
    // hay ruta directa EVM↔HyperEVM (la ejecuta `swap/lifiExec` por el proxy RPC
    // de 999). NEAR Intents queda como respaldo y se resuelve por el catálogo en
    // vivo (ver `client/.../swap/nearCatalog.ts`).
    lifiKey: 999,
    lifi: true,
    nearIntents: true,
  },
  robinhood: {
    key: "robinhood",
    kind: "evm",
    name: "Robinhood Chain",
    enabled: true,
    // OCULTA por defecto: hoy solo la usa la instancia de Lighter en Robinhood
    // Chain (colateral USDG). Quien la necesite la añade en Ajustes.
    optIn: true,
    evmChainId: 4663,
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    explorer: "https://robinhoodchain.blockscout.com",
    rpcEnvKey: "VITE_ROBINHOOD_RPC_URL",
    defaultRpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    // Confirmado en el panel de dRPC (14-09-2026): lb.drpc.live/robinhood/<clave>.
    drpcNetwork: "robinhood",
    coinType: 60,
    lifiKey: 4663,
    lifi: true,
    // 1Click la cubre desde el 18-09-2026 (changelog de NEAR Intents), con el
    // código de red `hood` en su catálogo: ver `CHAIN_TO_NEAR_NET` en
    // `client/.../swap/nearCatalog.ts`. Eso abre las rutas que Li.Fi no tiene
    // hacia/desde esta red (su único puente movía el nativo) y el saldo
    // confidencial en sus activos.
    nearIntents: true,
    // Sin `multicall3`: es una cadena Arbitrum Orbit y no se ha podido
    // verificar que Multicall3 esté desplegado en la dirección canónica (el
    // RPC no es alcanzable desde el entorno de desarrollo). Sin agrupar sigue
    // funcionando; con una dirección equivocada fallarían TODAS las lecturas.
    // Sin `moralisParam`/`moralisRpcSlug`: Moralis no la cubre; el proxy RPC
    // va al 2.º proveedor (`ROBINHOOD_RPC_BACKUP_URL`, p. ej. dRPC) o al
    // público, y el saldo (ETH + USDG) se lee por ese mismo RPC
    // (`rpcOnlyEvmChains()` → `server/wallet/rpcBalances.ts`).
  },
  bitcoin: {
    key: "bitcoin",
    kind: "utxo",
    name: "Bitcoin",
    enabled: true,
    nativeSymbol: "BTC",
    nativeDecimals: 8,
    explorer: "https://mempool.space",
    icon: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
    coinType: 0,
    // Li.Fi soporta BTC nativo vía THORChain, pero la ruta preferida del wallet
    // para BTC privado es NEAR Intents (ver spec §4.3).
    lifi: true,
    nearIntents: true,
  },
  solana: {
    key: "solana",
    kind: "svm",
    name: "Solana",
    enabled: true,
    // No-EVM: NO se deriva en el alta. `optIn` ⇒ el usuario la activa en Ajustes y
    // ahí se deriva su cuenta Turnkey (ed25519, m/44'/501'/0'/0') bajo demanda.
    optIn: true,
    nativeSymbol: "SOL",
    nativeDecimals: 9,
    explorer: "https://solscan.io",
    icon: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
    rpcEnvKey: "VITE_SOLANA_RPC_URL",
    defaultRpcUrl: "https://api.mainnet-beta.solana.com",
    coinType: 501,
    lifiKey: "SOL",
    lifi: true,
    nearIntents: true,
  },
};

/** Todas las cadenas (habilitadas y no). */
export function allChains(): ChainConfig[] {
  return Object.values(CHAINS);
}

/** Solo las cadenas activas para la UI/flows. */
export function enabledChains(): ChainConfig[] {
  return allChains().filter((c) => c.enabled);
}

export function getChain(key: ChainKey): ChainConfig {
  return CHAINS[key];
}

export function isChainEnabled(key: ChainKey): boolean {
  return CHAINS[key]?.enabled === true;
}

export function chainsByKind(kind: ChainKind): ChainConfig[] {
  return enabledChains().filter((c) => c.kind === kind);
}

/** Resuelve una cadena EVM por su chainId numérico (solo habilitadas). */
export function evmChainById(chainId: number): ChainConfig | undefined {
  return enabledChains().find(
    (c) => c.kind === "evm" && c.evmChainId === chainId
  );
}

/** Cadenas que pueden ser origen/destino de swap+bridge por Li.Fi. */
export function lifiChains(): ChainConfig[] {
  return enabledChains().filter((c) => c.lifi);
}

/**
 * Cadenas EVM habilitadas con parámetro de Moralis (saldos). El servidor lo usa
 * para barrer saldos sin mantener una lista paralela (ver `moralisClient`).
 */
export function moralisEvmChains(): ChainConfig[] {
  return enabledChains().filter(
    (c) => c.kind === "evm" && Boolean(c.moralisParam)
  );
}

/**
 * Cadenas EVM habilitadas que Moralis NO cubre (sin `moralisParam`): su saldo se
 * lee por RPC (`server/wallet/rpcBalances.ts`). Complemento exacto de
 * `moralisEvmChains()` dentro de las EVM: una red está en una lista o en la
 * otra, nunca en las dos ni en ninguna, así que ningún saldo se queda sin leer
 * ni se lee dos veces.
 */
export function rpcOnlyEvmChains(): ChainConfig[] {
  return enabledChains().filter(
    (c) => c.kind === "evm" && !c.moralisParam
  );
}

/** Redes habilitadas pero OCULTAS por defecto (el usuario las "añade"). */
export function optInChains(): ChainConfig[] {
  return enabledChains().filter((c) => c.optIn === true);
}

/**
 * Visibilidad por DEFECTO en la UI del wallet (antes de aplicar las preferencias
 * del usuario): visible = habilitada y no `optIn`. Las prefs del usuario
 * (localStorage, `useWalletSettings`) se superponen a esto.
 */
export function defaultChainVisibility(): Record<ChainKey, boolean> {
  const out = {} as Record<ChainKey, boolean>;
  for (const c of allChains()) out[c.key] = c.enabled && c.optIn !== true;
  return out;
}

export function explorerTxUrl(key: ChainKey, hash: string): string | undefined {
  const c = CHAINS[key];
  if (!c?.explorer) return undefined;
  // mempool.space usa /tx/<hash>; los exploradores EVM también.
  return `${c.explorer}/tx/${hash}`;
}

export function explorerAddressUrl(
  key: ChainKey,
  address: string
): string | undefined {
  const c = CHAINS[key];
  if (!c?.explorer) return undefined;
  return `${c.explorer}/address/${address}`;
}
