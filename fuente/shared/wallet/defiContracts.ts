/**
 * Contratos de los protocolos cuyas POSICIONES lee el monedero directamente en
 * cadena (sin agregador de pago): Uniswap v3, Uniswap v4, Aave v3 y f(x)
 * Protocol. Compartido cliente/servidor: el servidor lo usa para descubrir los
 * NFTs de v4 y los pools y posiciones de f(x).
 *
 * Lista corta y a mano, SOLO direcciones canónicas publicadas por el propio
 * protocolo. Una dirección equivocada aquí es peor que ninguna (le diríamos al
 * usuario que tiene una posición donde no la tiene, o al revés). Todo lo demás
 * que hace falta se DERIVA en cadena desde estas: la factory de Uniswap v3 sale
 * de `positionManager.factory()`, el oráculo de Aave de
 * `pool.ADDRESSES_PROVIDER().getPriceOracle()`.
 *
 * Fuente de las de Uniswap: `CHAIN_TO_ADDRESSES_MAP` de `@uniswap/sdk-core`
 * 7.19.2 (paquete oficial), contrastado el 10-09-2026; las de Robinhood Chain
 * (`ROBINHOOD_ADDRESSES`, chainId 4663) del mismo paquete, el 16-09-2026 — sin
 * ellas una posición NVDA/USDG abierta ahí no se leía: `defiChains()` ni
 * miraba esa red; las de BNB Chain (`BNB_ADDRESSES`, chainId 56), el
 * 19-09-2026 al dar de alta la red. Las de Aave, los proxies del Pool de cada
 * mercado v3 (el de BNB contrastado contra la API de Aave).
 *
 * `knownContracts.ts` (nombres para lo que una dApp pide firmar) reutiliza los
 * pools de Aave de aquí: una sola fuente.
 */
import type { ChainKey } from "./chains";

type Address = `0x${string}`;

/** Pool de Aave v3 por cadena (address del proxy del Pool). */
export const AAVE_V3_POOL: Partial<Record<ChainKey, Address>> = {
  ethereum: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  polygon: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  // Mercado «AaveV3BNB», contrastado contra la API de Aave (19-09-2026).
  bnb: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
};

/**
 * NonfungiblePositionManager de Uniswap v3 por cadena (el NFT de cada
 * posición). Misma dirección en las redes del despliegue original; Base tiene
 * la suya.
 */
export const UNISWAP_V3_POSITION_MANAGER: Partial<Record<ChainKey, Address>> = {
  ethereum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  arbitrum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  optimism: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  polygon: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  base: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  // Robinhood Chain (Arbitrum Orbit): despliegue propio, `nonfungiblePositionManagerAddress`.
  robinhood: "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  // BNB Chain: despliegue propio (`BNB_ADDRESSES` de `@uniswap/sdk-core` 7.19.2).
  bnb: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613",
};

/**
 * Uniswap v3 `SwapRouter02` (`IV3SwapRouter`: `exactInputSingle` SIN
 * deadline). Solo lo usa la liquidez concentrada (`docs/LP-CONCENTRADA.md`)
 * para cambiar al ratio del rango en el MISMO pool. Antes de usarlo, el
 * cliente comprueba en cadena que su `factory()` es la del PositionManager:
 * una dirección equivocada aquí no llega a firmar nada.
 */
export const UNISWAP_V3_SWAP_ROUTER02: Partial<Record<ChainKey, Address>> = {
  arbitrum: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  base: "0x2626664c2603336E57B271c5C0b26F421741e481",
};

/**
 * FORKS de Uniswap v3 con el MISMO `NonfungiblePositionManager` (mismo
 * `positions()`, `factory()`, `getPool(a, b, fee)` y `slot0`): se leen con el
 * lector de v3 tal cual, pero con su nombre, sin enlace a app.uniswap.org y
 * APARTE de `UNISWAP_V3_POSITION_MANAGER` (que usan también la liquidez
 * concentrada y los nombres de contratos de las dApps: un fork ahí se
 * ofrecería como «Uniswap»).
 *
 * Project X (HyperEVM): dirección del NFT manager de rotki
 * (`rotkehlchen/chain/hyperliquid/modules/project_x/constants.py`, que lo
 * decodifica con el ABI de `positions()` de Uniswap v3), 13-10-2026. El
 * lector comprueba lo que puede en cadena: si la factory no da un pool para
 * la posición, falla NOMBRÁNDOLO, nunca inventa un valor.
 */
export interface UniswapV3Fork {
  /** Id estable (cobertura frente a Octav, errores). */
  id: string;
  /** Nombre que ve el usuario. */
  protocol: string;
  positionManager: Address;
}

export const UNISWAP_V3_FORKS: Partial<Record<ChainKey, readonly UniswapV3Fork[]>> = {
  hyperevm: [{ id: "project-x", protocol: "Project X", positionManager: "0xeaD19AE861c29bBb2101E834922B2FEee69B9091" }],
};

/**
 * Fluid (Instadapp): los RESOLVERS de lectura y la fábrica de vaults (el
 * ERC-721 de las posiciones). Misma dirección en todas sus redes (CREATE2).
 * Fuente: `deployments/deployments.md` de `Instadapp/fluid-contracts-public`
 * (mainnet, arbitrum, base, polygon, plasma y bnb; Plasma no está en nuestro
 * catálogo), 13-10-2026. El lector solo usa los resolvers: lo que piden los
 * vaults lo resuelven ellos. Ver `@shared/wallet/fluid`.
 */
export interface FluidDeployment {
  lendingResolver: Address;
  vaultResolver: Address;
  vaultFactory: Address;
  /**
   * El contrato `Liquidity`: es QUIEN COBRA los tokens de un depósito o una
   * devolución en un vault (el vault llama a `Liquidity.operate` y este hace
   * `transferFrom` del usuario), así que el `approve` va a él, no al vault.
   * Mismo en todas las redes (fluid-contracts-public, `deployments.md`).
   */
  liquidity: Address;
}

const FLUID_DEPLOYMENT: FluidDeployment = {
  lendingResolver: "0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569",
  vaultResolver: "0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC",
  vaultFactory: "0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d",
  liquidity: "0x52Aa899454998Be5b000Ad077a46Bbe360F4e497",
};

export const FLUID: Partial<Record<ChainKey, FluidDeployment>> = {
  ethereum: FLUID_DEPLOYMENT,
  arbitrum: FLUID_DEPLOYMENT,
  base: FLUID_DEPLOYMENT,
  polygon: FLUID_DEPLOYMENT,
  bnb: FLUID_DEPLOYMENT,
};

/**
 * Morpho Blue (el singleton de mercados aislados). En Ethereum y Base es la
 * MISMA dirección «vanity» 0xBBBB…; en Arbitrum, otra. Fuente: docs.morpho.org
 * («Addresses»), 20-10-2026; el pre-vuelo del migrador (MuchoBadge, workflow
 * «Migrador de Morpho») comprueba su `DOMAIN_SEPARATOR` en las tres redes. Las
 * posiciones las descubre el servidor (`server/wallet/morphoIndex.ts`) y el
 * cliente las relee en cadena (`lib/web3/defi/morpho.ts`).
 */
export const MORPHO_BLUE: Partial<Record<ChainKey, Address>> = {
  ethereum: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  base: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  arbitrum: "0x6c247b1F6182318877311737BaC0844bAa518F5e",
};

/** Uniswap v4: PositionManager (NFT), StateView (lectura) y PoolManager. */
export interface UniswapV4Deployment {
  positionManager: Address;
  stateView: Address;
  poolManager: Address;
}

export const UNISWAP_V4: Partial<Record<ChainKey, UniswapV4Deployment>> = {
  ethereum: {
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  },
  arbitrum: {
    poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
    positionManager: "0xd88f38f930b7952f2db2432cb002e7abbf3dd869",
    stateView: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
  },
  base: {
    poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b",
    positionManager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
    stateView: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
  },
  optimism: {
    poolManager: "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3",
    positionManager: "0x3c3ea4b57a46241e54610e5f022e5c45859a1017",
    stateView: "0xc18a3169788f4f75a170290584eca6395c75ecdb",
  },
  polygon: {
    poolManager: "0x67366782805870060151383f4bbff9dab53e5cd6",
    positionManager: "0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9",
    stateView: "0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a",
  },
  // `BNB_ADDRESSES` de `@uniswap/sdk-core` 7.19.2 (v4PoolManager /
  // v4PositionManager / v4StateView).
  bnb: {
    poolManager: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
    positionManager: "0x7a4a5c919ae2541aed11041a1aeee68f1287f95b",
    stateView: "0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4",
  },
  // Sin indexador de Moralis: los NFTs de v4 aquí solo se descubren con
  // `INDEX_PROVIDER=drpc` (eth_getLogs en el propio RPC, `drpcIndex.ts`).
  robinhood: {
    poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
    positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
    stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  },
};

/**
 * **f(x) Protocol** (AladdinDAO) — solo Ethereum mainnet. Dos cosas distintas
 * cuelgan de aquí:
 *
 *  - Las **posiciones apalancadas**: cada pool de colateral es un ERC-721 (su
 *    `PoolStorage` extiende `ERC721Upgradeable`) y cada posición es un NFT de
 *    ese pool. Del propio pool salen `collateralToken()` y `priceOracle()`, así
 *    que lo único escrito a mano es el `poolManager` y la SEMILLA de pools: el
 *    resto se descubre por su evento `RegisterPool` (ver `fxIndex.ts`), y cada
 *    candidato se verifica preguntándole al pool por su `poolManager()`.
 *  - **fxBASE** (`FxUSDBasePool`): un ERC-20 de participaciones que se valora
 *    con su propio `nav()`, más el `gauge` donde se pueden tener en staking
 *    (ahí el indexador de saldos no las ve).
 *
 * Direcciones del despliegue oficial del repo `AladdinDAO/fx-protocol-contracts`
 * (`ignition/deployments/ethereum/deployed_addresses.json`, leído el
 * 20-09-2026). Ninguna se usa sin comprobarla en cadena: el pool tiene que
 * declarar nuestro `poolManager` y el gauge tiene que declarar fxBASE como su
 * token de staking.
 */
export interface FxDeployment {
  poolManager: Address;
  /** La moneda de la deuda: fxUSD (18 decimales). */
  fxUSD: Address;
  /** fxBASE: participaciones del FxUSDBasePool (ERC-20). */
  basePool: Address;
  /** Gauge de fxBASE (participaciones en staking). */
  baseGauge: Address;
  /** Pools conocidos al escribir esto; los demás se descubren en cadena. */
  seedPools: Address[];
}

export const FX_PROTOCOL: Partial<Record<ChainKey, FxDeployment>> = {
  ethereum: {
    poolManager: "0x250893CA4Ba5d05626C785e8da758026928FCD24",
    fxUSD: "0x085780639CC2cACd35E474e71f4d000e2405d8f6",
    basePool: "0x65C9A641afCEB9C0E6034e558A319488FA0FA3be",
    baseGauge: "0xEd92dDe3214c24Ae04F5f96927E3bE8f8DbC3289",
    // Pool de wstETH (`WstETHPool#WstETHPoolProxy`). Los demás mercados (WBTC y
    // los que vengan) NO se escriben aquí: salen del `RegisterPool` del
    // PoolManager, que es la fuente de verdad y no se queda vieja.
    seedPools: ["0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8"],
  },
};

/**
 * Oráculos de Chainlink X/USD en Arbitrum One (8 decimales). NO son una
 * posición DeFi: son el ÚLTIMO respaldo del precio spot del servidor
 * (`server/wallet/spotPrice.ts`) cuando las APIs de precios no responden —
 * se leen por nuestro RPC, sin terceros ni claves—. Van aquí para que el
 * vigilante de upstreams los compruebe con el resto de direcciones ancladas.
 * El de BTC/USD es el mismo que ya usa el préstamo (`lending/useBtcPrice.ts`).
 * Las claves son ids de CoinGecko: el mismo vocabulario que el resto del precio.
 */
export const CHAINLINK_USD_FEEDS: {
  chain: ChainKey;
  chainId: number;
  feeds: Record<string, Address>;
} = {
  chain: "arbitrum",
  chainId: 42161,
  feeds: {
    bitcoin: "0x6ce185860a4963106506C203335A2910413708e9",
    ethereum: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
  },
};

/** Cadenas donde hay algo que leer (al menos un protocolo desplegado). */
export function defiChains(): ChainKey[] {
  const keys = new Set<ChainKey>([
    ...(Object.keys(AAVE_V3_POOL) as ChainKey[]),
    ...(Object.keys(UNISWAP_V3_POSITION_MANAGER) as ChainKey[]),
    ...(Object.keys(UNISWAP_V4) as ChainKey[]),
    ...(Object.keys(FX_PROTOCOL) as ChainKey[]),
    ...(Object.keys(UNISWAP_V3_FORKS) as ChainKey[]),
    ...(Object.keys(FLUID) as ChainKey[]),
    ...(Object.keys(MORPHO_BLUE) as ChainKey[]),
  ]);
  return [...keys];
}

/**
 * Segmento de red que usa app.uniswap.org en las URLs de posición (el
 * `urlParam` de `CHAIN_METADATA` en Uniswap/interface,
 * `packages/chains/src/chainMetadata/chainMetadata.ts`). Robinhood Chain es
 * `robinhood`, contrastado ahí el 13-10-2026. Una red sin entrada se queda sin
 * enlace: uno roto es peor que ninguno.
 */
export const UNISWAP_APP_CHAIN: Partial<Record<ChainKey, string>> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon",
  base: "base",
  bnb: "bnb",
  robinhood: "robinhood",
};
