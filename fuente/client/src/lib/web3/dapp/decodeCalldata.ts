/**
 * Decodificador de CALLDATA para la pantalla de consentimiento: convierte el
 * `0x095ea7b3…` de una `eth_sendTransaction` en «Permites que Uniswap Permit2
 * gaste hasta ILIMITADO USDC», con banderas rojas donde toca.
 *
 * Es la lección del Campamento aplicada en el propio monedero: el alumno no
 * tiene que interpretar el hex, lo interpreta el monedero y se lo cuenta. Pero
 * con dos reglas que no se relajan:
 *
 *   1. **Nunca se inventa.** Solo se decodifica lo que casa con una ABI conocida
 *      (ERC-20, Permit2, Universal Router de Uniswap, gestor de posiciones v3,
 *      Aave v3, WETH, `setApprovalForAll`). Lo demás sale como «operación no
 *      reconocida» y el hex crudo sigue disponible (plegado) para quien quiera
 *      mirarlo. Un decodificador que se equivoca es más peligroso que ninguno.
 *   2. **Lo que se ve es lo que se firma.** Esto solo DESCRIBE; no altera la tx.
 *      El ejecutor (`requests.ts`) firma exactamente los bytes que llegaron.
 *
 * PURO y testeado. Los símbolos/decimales de los tokens los aporta quien llama
 * (`TokenMetaMap`, resuelto por `tokenMeta.ts`): sin ellos los importes salen en
 * unidades brutas y marcados como tales, nunca con un símbolo inventado.
 */
import {
  decodeAbiParameters,
  decodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  parseAbi,
  parseAbiParameters,
  slice,
  size,
  type Address,
  type Hex,
} from "viem";
import { getChain, evmChainById, type ChainKey } from "@shared/wallet/chains";
import { knownTokens } from "@/lib/web3/tokens";
import { knownContract, PERMIT2_ADDRESS, UR_ADDRESS_THIS, UR_MSG_SENDER } from "./knownContracts";

// ── Tipos de salida ───────────────────────────────────────────────────────────

export interface DecodedLine {
  label: string;
  value: string;
  mono?: boolean;
}

export interface DecodedFlag {
  level: "warn" | "danger";
  text: string;
}

export interface DecodedCall {
  /** Frase corta de lo que hace («Aprobar gasto de USDC»). */
  title: string;
  /** Nombre del contrato destino si lo conocemos («Uniswap Permit2»). */
  target?: string;
  /** Nombre de la función (ABI) para quien quiera el detalle técnico. */
  fn?: string;
  lines: DecodedLine[];
  flags: DecodedFlag[];
  /** Tokens mencionados, para que la UI resuelva símbolo/decimales. */
  tokens: Address[];
  /** `true` si casó con una ABI conocida; `false` = solo sabemos el selector. */
  recognized: boolean;
  /** Selector (4 bytes) para el respaldo de 4byte/openchain. */
  selector?: Hex;
}

export interface TokenMeta {
  symbol: string;
  decimals: number;
}
/** Dirección (minúsculas) → metadatos. */
export type TokenMetaMap = Record<string, TokenMeta>;

export interface CallInput {
  chainId: number;
  to?: string;
  data?: string;
  value?: bigint;
  /** Cuenta conectada (para saber si el destinatario eres tú). */
  from?: string;
}

// ── Utilidades ────────────────────────────────────────────────────────────────

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
/** Umbral de «ilimitado»: 2^255 o más cubre max uint256 y variantes tipo 2^256-2. */
const UNLIMITED_FROM = 1n << 255n;
const YEAR_S = 365 * 24 * 3600;

export function isUnlimitedAmount(amount: bigint, bits: 160 | 256 = 256): boolean {
  if (bits === 160) return amount >= MAX_UINT160 - 1n;
  return amount >= UNLIMITED_FROM || amount === MAX_UINT256;
}

function lc(a: string): string {
  return a.toLowerCase();
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

/** Metadatos del token: mapa que aporta la UI, y si no, el catálogo del repo. */
function metaOf(chainKey: ChainKey | undefined, token: string, meta: TokenMetaMap): TokenMeta | undefined {
  const m = meta[lc(token)];
  if (m) return m;
  if (!chainKey) return undefined;
  const k = knownTokens(chainKey).find((t) => lc(t.address) === lc(token));
  return k ? { symbol: k.symbol, decimals: k.decimals } : undefined;
}

export function formatTokenAmount(
  amount: bigint,
  token: string,
  chainKey: ChainKey | undefined,
  meta: TokenMetaMap,
  bits: 160 | 256 = 256
): string {
  if (isUnlimitedAmount(amount, bits)) return "ILIMITADO";
  const m = metaOf(chainKey, token, meta);
  if (!m) return `${amount.toString()} (unidades brutas, token ${shortAddr(token)})`;
  return `${trimNumber(formatUnits(amount, m.decimals))} ${m.symbol}`;
}

function nativeSymbol(chainKey: ChainKey | undefined): string {
  return chainKey ? getChain(chainKey).nativeSymbol : "ETH";
}

function formatNative(amount: bigint, chainKey: ChainKey | undefined): string {
  return `${trimNumber(formatUnits(amount, 18))} ${nativeSymbol(chainKey)}`;
}

/** Recorta ceros de cola sin perder precisión significativa. */
export function trimNumber(s: string): string {
  if (!s.includes(".")) return s;
  const t = s.replace(/0+$/, "").replace(/\.$/, "");
  return t === "" ? "0" : t;
}

function tokenLabel(chainKey: ChainKey | undefined, token: string, meta: TokenMetaMap): string {
  const m = metaOf(chainKey, token, meta);
  return m ? `${m.symbol} (${shortAddr(token)})` : shortAddr(token);
}

function partyLabel(chainKey: ChainKey | undefined, addr: string, self?: string): string {
  if (self && lc(addr) === lc(self)) return "tú (tu cuenta conectada)";
  if (lc(addr) === lc(UR_MSG_SENDER)) return "tú (tu cuenta conectada)";
  if (lc(addr) === lc(UR_ADDRESS_THIS)) return "el propio router (paso intermedio)";
  const k = knownContract(chainKey, addr);
  return k ? `${k.name} (${shortAddr(addr)})` : shortAddr(addr);
}

function dateLabel(unixSeconds: bigint | number): string {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return String(unixSeconds);
  if (n >= 2 ** 47) return "nunca";
  return new Date(n * 1000).toLocaleString();
}

function spenderFlag(chainKey: ChainKey | undefined, spender: string): DecodedFlag | undefined {
  if (knownContract(chainKey, spender)) return undefined;
  return {
    level: "warn",
    text: `Gastador no reconocido (${shortAddr(spender)}). Comprueba en la aplicación que esa dirección es del protocolo que estás usando.`,
  };
}

const UNLIMITED_FLAG = (what: string): DecodedFlag => ({
  level: "danger",
  text: `Aprobación ILIMITADA: ese contrato podrá mover TODO tu ${what}, ahora y en el futuro, sin volver a preguntarte. Lo seguro es aprobar solo lo que vas a usar.`,
});

// ── ABIs conocidas ────────────────────────────────────────────────────────────

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
]);

const PERMIT2_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

const UNIVERSAL_ROUTER_ABI = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  "function execute(bytes commands, bytes[] inputs)",
]);

const AAVE_POOL_ABI = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)",
  "function setUserUseReserveAsCollateral(address asset, bool useAsCollateral)",
]);

const WETH_ABI = parseAbi(["function deposit()", "function withdraw(uint256 wad)"]);

const NFT_ABI = parseAbi(["function setApprovalForAll(address operator, bool approved)"]);

const MULTICALL_ABI = parseAbi([
  "function multicall(bytes[] data)",
  "function multicall(uint256 deadline, bytes[] data)",
]);

const V3_POSITIONS_ABI = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params)",
  "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params)",
  "function burn(uint256 tokenId)",
  "function refundETH()",
  "function unwrapWETH9(uint256 amountMinimum, address recipient)",
  "function sweepToken(address token, uint256 amountMinimum, address recipient)",
]);

const V4_POSITIONS_ABI = parseAbi([
  "function modifyLiquidities(bytes unlockData, uint256 deadline)",
]);

type Decoder = (args: {
  data: Hex;
  chainKey: ChainKey | undefined;
  input: CallInput;
  meta: TokenMetaMap;
}) => DecodedCall | undefined;

function tryDecode<T extends readonly unknown[]>(
  abi: T,
  data: Hex
): { functionName: string; args: readonly unknown[] } | undefined {
  try {
    const d = decodeFunctionData({ abi: abi as never, data });
    return { functionName: d.functionName as string, args: (d.args ?? []) as readonly unknown[] };
  } catch {
    return undefined;
  }
}

// ── ERC-20 ────────────────────────────────────────────────────────────────────

const decodeErc20: Decoder = ({ data, chainKey, input, meta }) => {
  const d = tryDecode(ERC20_ABI, data);
  if (!d || !input.to) return undefined;
  const token = input.to;
  const tokens: Address[] = [getAddress(token)];
  switch (d.functionName) {
    case "approve":
    case "increaseAllowance": {
      const [spender, amount] = d.args as [Address, bigint];
      const unlimited = isUnlimitedAmount(amount);
      const flags: DecodedFlag[] = [];
      if (unlimited) flags.push(UNLIMITED_FLAG(tokenLabel(chainKey, token, meta)));
      const sf = spenderFlag(chainKey, spender);
      if (sf) flags.push(sf);
      return {
        title: unlimited ? "Aprobar gasto ILIMITADO" : "Aprobar gasto de un token",
        target: tokenLabel(chainKey, token, meta),
        fn: d.functionName,
        lines: [
          { label: "Token", value: tokenLabel(chainKey, token, meta) },
          { label: "Podrá gastar", value: partyLabel(chainKey, spender, input.from) },
          { label: "Hasta", value: formatTokenAmount(amount, token, chainKey, meta) },
        ],
        flags,
        tokens,
        recognized: true,
      };
    }
    case "transfer": {
      const [to, amount] = d.args as [Address, bigint];
      return {
        title: "Enviar tokens",
        target: tokenLabel(chainKey, token, meta),
        fn: d.functionName,
        lines: [
          { label: "Importe", value: formatTokenAmount(amount, token, chainKey, meta) },
          { label: "Para", value: partyLabel(chainKey, to, input.from), mono: true },
        ],
        flags: [],
        tokens,
        recognized: true,
      };
    }
    case "transferFrom": {
      const [from, to, amount] = d.args as [Address, Address, bigint];
      return {
        title: "Mover tokens de otra cuenta",
        target: tokenLabel(chainKey, token, meta),
        fn: d.functionName,
        lines: [
          { label: "Importe", value: formatTokenAmount(amount, token, chainKey, meta) },
          { label: "Desde", value: partyLabel(chainKey, from, input.from), mono: true },
          { label: "Para", value: partyLabel(chainKey, to, input.from), mono: true },
        ],
        flags: [],
        tokens,
        recognized: true,
      };
    }
  }
  return undefined;
};

// ── Permit2 (approve on-chain) ────────────────────────────────────────────────

const decodePermit2: Decoder = ({ data, chainKey, input, meta }) => {
  if (!input.to || lc(input.to) !== lc(PERMIT2_ADDRESS)) return undefined;
  const d = tryDecode(PERMIT2_ABI, data);
  if (!d) return undefined;
  const [token, spender, amount, expiration] = d.args as [Address, Address, bigint, bigint];
  const unlimited = isUnlimitedAmount(amount, 160);
  const flags: DecodedFlag[] = [];
  if (unlimited) flags.push(UNLIMITED_FLAG(tokenLabel(chainKey, token, meta)));
  const sf = spenderFlag(chainKey, spender);
  if (sf) flags.push(sf);
  if (Number(expiration) > Date.now() / 1000 + YEAR_S) {
    flags.push({ level: "warn", text: "El permiso dura más de un año." });
  }
  return {
    title: "Permiso de gasto (Permit2)",
    target: "Uniswap Permit2",
    fn: "approve",
    lines: [
      { label: "Token", value: tokenLabel(chainKey, token, meta) },
      { label: "Podrá gastar", value: partyLabel(chainKey, spender, input.from) },
      { label: "Hasta", value: formatTokenAmount(amount, token, chainKey, meta, 160) },
      { label: "Caduca", value: dateLabel(expiration) },
    ],
    flags,
    tokens: [getAddress(token)],
    recognized: true,
  };
};

// ── Uniswap Universal Router ──────────────────────────────────────────────────

const UR_COMMANDS: Record<number, string> = {
  0x00: "V3_SWAP_EXACT_IN",
  0x01: "V3_SWAP_EXACT_OUT",
  0x02: "PERMIT2_TRANSFER_FROM",
  0x03: "PERMIT2_PERMIT_BATCH",
  0x04: "SWEEP",
  0x05: "TRANSFER",
  0x06: "PAY_PORTION",
  0x08: "V2_SWAP_EXACT_IN",
  0x09: "V2_SWAP_EXACT_OUT",
  0x0a: "PERMIT2_PERMIT",
  0x0b: "WRAP_ETH",
  0x0c: "UNWRAP_WETH",
  0x0d: "PERMIT2_TRANSFER_FROM_BATCH",
  0x0e: "BALANCE_CHECK_ERC20",
  0x10: "V4_SWAP",
  0x11: "V3_POSITION_MANAGER_PERMIT",
  0x12: "V3_POSITION_MANAGER_CALL",
  0x13: "V4_INITIALIZE_POOL",
  0x14: "V4_POSITION_MANAGER_CALL",
  0x21: "EXECUTE_SUB_PLAN",
};

/** Ruta v3 codificada: token(20) fee(3) token(20) [fee token…]. */
export function v3PathTokens(path: Hex): { first: Address; last: Address } | undefined {
  const n = size(path);
  if (n < 43) return undefined;
  return {
    first: getAddress(slice(path, 0, 20)),
    last: getAddress(slice(path, n - 20, n)),
  };
}

const decodeUniversalRouter: Decoder = ({ data, chainKey, input, meta }) => {
  const d = tryDecode(UNIVERSAL_ROUTER_ABI, data);
  if (!d) return undefined;
  const [commandsHex, inputs, deadline] = d.args as [Hex, Hex[], bigint | undefined];
  const commands: number[] = [];
  for (let i = 0; i < size(commandsHex); i++) {
    commands.push(Number(slice(commandsHex, i, i + 1)) & 0x1f);
  }
  const lines: DecodedLine[] = [];
  const tokens = new Set<Address>();
  const flags: DecodedFlag[] = [];
  const steps: string[] = [];
  let swapTitle: string | undefined;

  commands.forEach((cmd, i) => {
    const inp = inputs[i];
    const name = UR_COMMANDS[cmd] ?? `comando 0x${cmd.toString(16)}`;
    try {
      switch (cmd) {
        case 0x00:
        case 0x01: {
          const [recipient, a, b, path] = decodeAbiParameters(
            parseAbiParameters("address, uint256, uint256, bytes, bool"),
            inp
          ) as unknown as [Address, bigint, bigint, Hex, boolean];
          const p = v3PathTokens(path);
          if (!p) break;
          const exactIn = cmd === 0x00;
          const tokenIn = exactIn ? p.first : p.last;
          const tokenOut = exactIn ? p.last : p.first;
          tokens.add(tokenIn);
          tokens.add(tokenOut);
          swapTitle ??= "Intercambiar (Uniswap v3)";
          steps.push(
            exactIn
              ? `Cambias ${formatTokenAmount(a, tokenIn, chainKey, meta)} por al menos ${formatTokenAmount(b, tokenOut, chainKey, meta)}`
              : `Recibes ${formatTokenAmount(a, tokenOut, chainKey, meta)} pagando como máximo ${formatTokenAmount(b, tokenIn, chainKey, meta)}`
          );
          if (lc(recipient) !== lc(UR_MSG_SENDER) && lc(recipient) !== lc(UR_ADDRESS_THIS)) {
            steps.push(`  → destinatario: ${partyLabel(chainKey, recipient, input.from)}`);
          }
          break;
        }
        case 0x08:
        case 0x09: {
          const [recipient, a, b, path] = decodeAbiParameters(
            parseAbiParameters("address, uint256, uint256, address[], bool"),
            inp
          ) as unknown as [Address, bigint, bigint, Address[], boolean];
          if (path.length < 2) break;
          const tokenIn = path[0];
          const tokenOut = path[path.length - 1];
          tokens.add(tokenIn);
          tokens.add(tokenOut);
          swapTitle ??= "Intercambiar (Uniswap v2)";
          steps.push(
            cmd === 0x08
              ? `Cambias ${formatTokenAmount(a, tokenIn, chainKey, meta)} por al menos ${formatTokenAmount(b, tokenOut, chainKey, meta)}`
              : `Recibes ${formatTokenAmount(a, tokenOut, chainKey, meta)} pagando como máximo ${formatTokenAmount(b, tokenIn, chainKey, meta)}`
          );
          if (lc(recipient) !== lc(UR_MSG_SENDER) && lc(recipient) !== lc(UR_ADDRESS_THIS)) {
            steps.push(`  → destinatario: ${partyLabel(chainKey, recipient, input.from)}`);
          }
          break;
        }
        case 0x0b: {
          const [, amount] = decodeAbiParameters(parseAbiParameters("address, uint256"), inp) as unknown as [Address, bigint];
          steps.push(`Envuelves ${formatNative(amount, chainKey)} (a W${nativeSymbol(chainKey)})`);
          break;
        }
        case 0x0c: {
          const [recipient, amountMin] = decodeAbiParameters(parseAbiParameters("address, uint256"), inp) as unknown as [Address, bigint];
          steps.push(
            `Desenvuelves al menos ${formatNative(amountMin, chainKey)} para ${partyLabel(chainKey, recipient, input.from)}`
          );
          break;
        }
        case 0x0a:
          steps.push("Registra un permiso Permit2 que ya firmaste");
          break;
        case 0x04: {
          const [token, recipient] = decodeAbiParameters(parseAbiParameters("address, address, uint256"), inp) as unknown as [Address, Address, bigint];
          tokens.add(token);
          steps.push(`Barre el resto de ${tokenLabel(chainKey, token, meta)} a ${partyLabel(chainKey, recipient, input.from)}`);
          break;
        }
        case 0x06: {
          const [token, recipient, bips] = decodeAbiParameters(parseAbiParameters("address, address, uint256"), inp) as unknown as [Address, Address, bigint];
          tokens.add(token);
          steps.push(
            `Comisión del ${trimNumber((Number(bips) / 100).toFixed(2))} % en ${tokenLabel(chainKey, token, meta)} para ${partyLabel(chainKey, recipient, input.from)}`
          );
          break;
        }
        case 0x10:
          swapTitle ??= "Intercambiar (Uniswap v4)";
          steps.push("Intercambio en Uniswap v4 (el detalle lo define la aplicación)");
          break;
        case 0x12:
        case 0x14:
          swapTitle ??= "Gestionar liquidez (Uniswap)";
          steps.push(name === "V3_POSITION_MANAGER_CALL" ? "Operación sobre una posición de liquidez v3" : "Operación sobre una posición de liquidez v4");
          break;
        default:
          steps.push(name);
      }
    } catch {
      steps.push(`${name} (no se pudo leer)`);
    }
  });

  if (input.value && input.value > 0n) {
    lines.push({ label: "Pagas", value: formatNative(input.value, chainKey) });
  }
  steps.forEach((s, i) => lines.push({ label: i === 0 ? "Qué hace" : "", value: s }));
  if (deadline != null) lines.push({ label: "Válido hasta", value: dateLabel(deadline) });

  return {
    title: swapTitle ?? "Operación en Uniswap",
    target: "Uniswap (Universal Router)",
    fn: "execute",
    lines,
    flags,
    tokens: [...tokens],
    recognized: true,
  };
};

// ── Aave v3 ───────────────────────────────────────────────────────────────────

const decodeAave: Decoder = ({ data, chainKey, input, meta }) => {
  const d = tryDecode(AAVE_POOL_ABI, data);
  if (!d) return undefined;
  const target = knownContract(chainKey, input.to)?.name ?? "Pool de préstamos (¿Aave?)";
  const known = Boolean(knownContract(chainKey, input.to));
  const flags: DecodedFlag[] = known
    ? []
    : [{ level: "warn", text: `El contrato ${shortAddr(input.to ?? "")} no es el Pool de Aave v3 que conocemos en esta red.` }];
  const rate = (m: bigint) => (m === 2n ? "variable" : m === 1n ? "estable" : `modo ${m}`);
  switch (d.functionName) {
    case "supply": {
      const [asset, amount, onBehalfOf] = d.args as [Address, bigint, Address, number];
      return {
        title: "Depositar en Aave",
        target,
        fn: d.functionName,
        lines: [
          { label: "Depositas", value: formatTokenAmount(amount, asset, chainKey, meta) },
          { label: "A nombre de", value: partyLabel(chainKey, onBehalfOf, input.from) },
        ],
        flags,
        tokens: [getAddress(asset)],
        recognized: true,
      };
    }
    case "withdraw": {
      const [asset, amount, to] = d.args as [Address, bigint, Address];
      return {
        title: "Retirar de Aave",
        target,
        fn: d.functionName,
        lines: [
          { label: "Retiras", value: isUnlimitedAmount(amount) ? "TODO el saldo depositado" : formatTokenAmount(amount, asset, chainKey, meta) },
          { label: "Para", value: partyLabel(chainKey, to, input.from) },
        ],
        flags,
        tokens: [getAddress(asset)],
        recognized: true,
      };
    }
    case "borrow": {
      const [asset, amount, mode, , onBehalfOf] = d.args as [Address, bigint, bigint, number, Address];
      return {
        title: "Pedir prestado en Aave",
        target,
        fn: d.functionName,
        lines: [
          { label: "Pides", value: formatTokenAmount(amount, asset, chainKey, meta) },
          { label: "Tipo de interés", value: rate(mode) },
          { label: "A nombre de", value: partyLabel(chainKey, onBehalfOf, input.from) },
        ],
        flags,
        tokens: [getAddress(asset)],
        recognized: true,
      };
    }
    case "repay": {
      const [asset, amount, mode, onBehalfOf] = d.args as [Address, bigint, bigint, Address];
      return {
        title: "Devolver préstamo en Aave",
        target,
        fn: d.functionName,
        lines: [
          { label: "Devuelves", value: isUnlimitedAmount(amount) ? "TODA la deuda" : formatTokenAmount(amount, asset, chainKey, meta) },
          { label: "Tipo de interés", value: rate(mode) },
          { label: "Deuda de", value: partyLabel(chainKey, onBehalfOf, input.from) },
        ],
        flags,
        tokens: [getAddress(asset)],
        recognized: true,
      };
    }
    case "setUserUseReserveAsCollateral": {
      const [asset, use] = d.args as [Address, boolean];
      return {
        title: use ? "Usar como colateral" : "Dejar de usar como colateral",
        target,
        fn: d.functionName,
        lines: [{ label: "Activo", value: tokenLabel(chainKey, asset, meta) }],
        flags: use
          ? flags
          : [...flags, { level: "warn", text: "Quitar un colateral puede acercar tu préstamo a la liquidación." }],
        tokens: [getAddress(asset)],
        recognized: true,
      };
    }
  }
  return undefined;
};

// ── WETH ──────────────────────────────────────────────────────────────────────

const decodeWeth: Decoder = ({ data, chainKey, input }) => {
  const k = knownContract(chainKey, input.to);
  if (k?.kind !== "wrapped-native") return undefined;
  const d = tryDecode(WETH_ABI, data);
  if (!d) return undefined;
  if (d.functionName === "deposit") {
    return {
      title: `Envolver ${nativeSymbol(chainKey)} en ${k.name}`,
      target: k.name,
      fn: "deposit",
      lines: [{ label: "Envuelves", value: formatNative(input.value ?? 0n, chainKey) }],
      flags: [],
      tokens: [],
      recognized: true,
    };
  }
  const [wad] = d.args as [bigint];
  return {
    title: `Desenvolver ${k.name} a ${nativeSymbol(chainKey)}`,
    target: k.name,
    fn: "withdraw",
    lines: [{ label: "Desenvuelves", value: formatNative(wad, chainKey) }],
    flags: [],
    tokens: [],
    recognized: true,
  };
};

// ── NFT ───────────────────────────────────────────────────────────────────────

const decodeNft: Decoder = ({ data, chainKey, input }) => {
  const d = tryDecode(NFT_ABI, data);
  if (!d) return undefined;
  const [operator, approved] = d.args as [Address, boolean];
  return {
    title: approved ? "Aprobar TODOS tus NFT de esta colección" : "Revocar aprobación de NFT",
    target: knownContract(chainKey, input.to)?.name ?? `Colección ${shortAddr(input.to ?? "")}`,
    fn: "setApprovalForAll",
    lines: [{ label: "Operador", value: partyLabel(chainKey, operator, input.from), mono: true }],
    flags: approved
      ? [
          {
            level: "danger",
            text: "Ese operador podrá mover CUALQUIER NFT que tengas o llegues a tener en esta colección. Es la firma típica de los robos de NFT: asegúrate de que es el mercado que estás usando.",
          },
        ]
      : [],
    tokens: [],
    recognized: true,
  };
};

// ── Uniswap v3 gestor de posiciones + multicall ───────────────────────────────

const decodeV3Positions: Decoder = ({ data, chainKey, input, meta }) => {
  const d = tryDecode(V3_POSITIONS_ABI, data);
  if (!d) return undefined;
  const target = "Uniswap v3 (posiciones)";
  switch (d.functionName) {
    case "mint": {
      const p = d.args[0] as {
        token0: Address;
        token1: Address;
        fee: number;
        amount0Desired: bigint;
        amount1Desired: bigint;
        recipient: Address;
        deadline: bigint;
      };
      return {
        title: "Crear posición de liquidez",
        target,
        fn: "mint",
        lines: [
          { label: "Aportas", value: formatTokenAmount(p.amount0Desired, p.token0, chainKey, meta) },
          { label: "y", value: formatTokenAmount(p.amount1Desired, p.token1, chainKey, meta) },
          { label: "Comisión del pool", value: `${trimNumber((p.fee / 10_000).toFixed(4))} %` },
          { label: "Dueño de la posición", value: partyLabel(chainKey, p.recipient, input.from) },
        ],
        flags: [],
        tokens: [getAddress(p.token0), getAddress(p.token1)],
        recognized: true,
      };
    }
    case "increaseLiquidity": {
      const p = d.args[0] as { tokenId: bigint; amount0Desired: bigint; amount1Desired: bigint };
      return {
        title: "Añadir liquidez a tu posición",
        target,
        fn: "increaseLiquidity",
        lines: [
          { label: "Posición", value: `#${p.tokenId}` },
          { label: "Aportas (token 0)", value: `${p.amount0Desired} (unidades brutas)` },
          { label: "Aportas (token 1)", value: `${p.amount1Desired} (unidades brutas)` },
        ],
        flags: [],
        tokens: [],
        recognized: true,
      };
    }
    case "decreaseLiquidity": {
      const p = d.args[0] as { tokenId: bigint; liquidity: bigint };
      return {
        title: "Retirar liquidez de tu posición",
        target,
        fn: "decreaseLiquidity",
        lines: [{ label: "Posición", value: `#${p.tokenId}` }],
        flags: [],
        tokens: [],
        recognized: true,
      };
    }
    case "collect": {
      const p = d.args[0] as { tokenId: bigint; recipient: Address };
      return {
        title: "Cobrar comisiones de tu posición",
        target,
        fn: "collect",
        lines: [
          { label: "Posición", value: `#${p.tokenId}` },
          { label: "Para", value: partyLabel(chainKey, p.recipient, input.from) },
        ],
        flags: [],
        tokens: [],
        recognized: true,
      };
    }
    case "burn": {
      const [tokenId] = d.args as [bigint];
      return {
        title: "Cerrar posición (quemar el NFT)",
        target,
        fn: "burn",
        lines: [{ label: "Posición", value: `#${tokenId}` }],
        flags: [],
        tokens: [],
        recognized: true,
      };
    }
    case "refundETH":
    case "unwrapWETH9":
    case "sweepToken":
      return {
        title: "Recuperar sobrante",
        target,
        fn: d.functionName,
        lines: [],
        flags: [],
        tokens: [],
        recognized: true,
      };
  }
  return undefined;
};

const decodeMulticall: Decoder = (ctx) => {
  const d = tryDecode(MULTICALL_ABI, ctx.data);
  if (!d) return undefined;
  const calls = (d.functionName === "multicall" && d.args.length === 2 ? d.args[1] : d.args[0]) as Hex[];
  const lines: DecodedLine[] = [];
  const tokens = new Set<Address>();
  const flags: DecodedFlag[] = [];
  let title: string | undefined;
  calls.forEach((c, i) => {
    const inner = decodeCalldata({ ...ctx.input, data: c, value: i === 0 ? ctx.input.value : 0n }, ctx.meta, {
      allowMulticall: false,
    });
    if (inner.recognized) {
      title ??= inner.title;
      lines.push({ label: `Paso ${i + 1}`, value: inner.title });
      for (const l of inner.lines) lines.push({ label: `  ${l.label}`, value: l.value, mono: l.mono });
      for (const t of inner.tokens) tokens.add(t);
      flags.push(...inner.flags);
    } else {
      lines.push({ label: `Paso ${i + 1}`, value: `operación no reconocida (${inner.selector ?? "?"})`, mono: true });
      flags.push({ level: "warn", text: `El paso ${i + 1} no se ha podido interpretar.` });
    }
  });
  if (ctx.input.value && ctx.input.value > 0n) {
    lines.unshift({ label: "Pagas", value: formatNative(ctx.input.value, ctx.chainKey) });
  }
  return {
    title: title ? `${title} (${calls.length} pasos)` : `${calls.length} operaciones agrupadas`,
    target: knownContract(ctx.chainKey, ctx.input.to)?.name,
    fn: "multicall",
    lines,
    flags,
    tokens: [...tokens],
    recognized: true,
  };
};

const decodeV4Positions: Decoder = ({ data, chainKey, input }) => {
  const d = tryDecode(V4_POSITIONS_ABI, data);
  if (!d) return undefined;
  const [, deadline] = d.args as [Hex, bigint];
  const lines: DecodedLine[] = [];
  if (input.value && input.value > 0n) lines.push({ label: "Pagas", value: formatNative(input.value, chainKey) });
  lines.push({ label: "Válido hasta", value: dateLabel(deadline) });
  return {
    title: "Gestionar liquidez (Uniswap v4)",
    target: "Uniswap v4 (posiciones)",
    fn: "modifyLiquidities",
    lines,
    flags: [
      { level: "warn", text: "Uniswap v4 empaqueta la operación de forma que no se puede desglosar aquí: confirma en la aplicación qué estás haciendo." },
    ],
    tokens: [],
    recognized: true,
  };
};

// ── Entrada ───────────────────────────────────────────────────────────────────

const DECODERS: Decoder[] = [
  decodePermit2,
  decodeUniversalRouter,
  decodeWeth,
  decodeAave,
  decodeV3Positions,
  decodeV4Positions,
  decodeNft,
  decodeErc20, // el último: `approve(address,uint256)` comparte selector con ERC-721
];

/**
 * Decodifica la llamada. SIEMPRE devuelve algo: si no casa con nada conocido,
 * `recognized: false` con el selector, para que la UI pida el nombre a 4byte y
 * enseñe el aviso de «no reconocido».
 */
export function decodeCalldata(
  input: CallInput,
  meta: TokenMetaMap = {},
  opts: { allowMulticall?: boolean } = {}
): DecodedCall {
  const chainKey = evmChainById(input.chainId)?.key;
  const data = ((input.data ?? "0x") as Hex).toLowerCase() as Hex;
  const value = input.value ?? 0n;

  // Envío nativo simple (sin datos).
  if (data === "0x" || size(data) === 0) {
    return {
      title: input.to ? `Enviar ${nativeSymbol(chainKey)}` : "Crear contrato",
      lines: [
        { label: "Importe", value: formatNative(value, chainKey) },
        ...(input.to ? [{ label: "Para", value: partyLabel(chainKey, input.to, input.from), mono: true }] : []),
      ],
      flags: [],
      tokens: [],
      recognized: true,
    };
  }

  if (size(data) < 4) {
    return {
      title: "Datos malformados",
      lines: [],
      flags: [{ level: "danger", text: "La transacción lleva datos que no son una llamada válida." }],
      tokens: [],
      recognized: false,
    };
  }

  const selector = slice(data, 0, 4) as Hex;

  if (opts.allowMulticall !== false) {
    const mc = decodeMulticall({ data, chainKey, input, meta });
    if (mc) return { ...mc, selector };
  }
  for (const dec of DECODERS) {
    const out = dec({ data, chainKey, input, meta });
    if (out) return { ...out, selector };
  }

  const flags: DecodedFlag[] = [
    {
      level: "warn",
      text: "Operación no reconocida: el monedero no sabe qué hace esta llamada. Apruébala solo si confías en la aplicación y sabes qué estás haciendo.",
    },
  ];
  const lines: DecodedLine[] = [];
  if (value > 0n) lines.push({ label: "Pagas", value: formatNative(value, chainKey) });
  if (input.to && isAddress(input.to)) {
    lines.push({ label: "Contrato", value: partyLabel(chainKey, input.to, input.from), mono: true });
  }
  return {
    title: "Operación no reconocida",
    target: knownContract(chainKey, input.to)?.name,
    lines,
    flags,
    tokens: [],
    recognized: false,
    selector,
  };
}
