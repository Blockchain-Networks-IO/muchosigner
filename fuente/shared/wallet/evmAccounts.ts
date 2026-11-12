/**
 * Direcciones EVM CON PROPÓSITO — registro de derivación compartido
 * cliente/servidor.
 *
 * Un mismo monedero (una sola semilla en Turnkey) expone varias direcciones EVM
 * con un papel declarado:
 *
 *   índice 0  → **principal**: la que estrena el usuario, a la que entregan las
 *               rampas KYC y donde acaba su historial. Es la que en las
 *               formaciones se llama «dirección KYC»: identifica a la persona.
 *   índice ≥1 → **limpias**: sin historial, para recibir la vuelta de un flujo de
 *               privacidad (NEAR Intents confidencial, coinjoin, LN…) sin heredar
 *               el vínculo de la principal.
 *
 * ## Por qué este esquema de ruta y no el de Turnkey
 *
 * El helper del SDK (`defaultEthereumAccountAtIndex`) deriva `m/44'/60'/i'/0/0`
 * (índice de CUENTA endurecido, estilo Ledger Live). Aquí usamos
 * `m/44'/60'/0'/0/i` (índice de DIRECCIÓN, estilo MetaMask/Rabby) porque:
 *
 *  - Coincide con la cuenta EVM que este monedero ya deriva desde el principio
 *    (`m/44'/60'/0'/0/0`); los dos esquemas solo coinciden en el índice 0.
 *  - **Portabilidad**: quien exporte su semilla y la importe en MetaMask verá la
 *    dirección limpia como «Cuenta 2», sin configurar nada. Es la promesa que se
 *    le hace al usuario, así que la ruta tiene que cumplirla.
 *
 * Los dos esquemas están documentados en `client/src/lib/web3/ledgerEvm.ts`.
 * **NO** usar `defaultEthereumAccountAtIndex` para índices >0: derivaría otra
 * dirección distinta de la que el cliente busca.
 *
 * ## Reserva de índices (no pisar)
 *
 * Rama EVM `m/44'/60'/0'/0/{n}` — 0 principal, ≥1 limpias (este módulo manda).
 * Rama BTC `m/84'/0'/{i}'/{0|1}/{n}` — la cuenta Bitcoin de la cuenta `i` de
 * ESTA rama (`@shared/wallet/btcAccounts`): cobros rotatorios en la rama 0,
 * cambio en la 1; el lending (`useLendingBtc`) deriva 0..2 de la cuenta 0.
 * Es OTRA rama y no colisiona.
 *
 * ## Qué NO es una dirección limpia
 *
 * No es anonimato criptográfico: es una dirección normal y corriente **sin
 * historial**. Solo está desvinculada frente a un observador ON-CHAIN público, y
 * únicamente mientras nadie la conecte con la principal. Turnkey (firma ambas),
 * nuestro proxy RPC y nuestro backend SÍ las ven juntas. Ver
 * `docs/DIRECCIONES-CON-PROPOSITO.md` §modelo de amenaza.
 */

/** Ruta base de la rama EVM (esquema MetaMask: el índice es la ÚLTIMA posición). */
export const EVM_BASE_PATH = "m/44'/60'/0'/0";

/** Índice de la dirección principal (identificada). */
export const EVM_MAIN_INDEX = 0;

/** Primer índice de dirección limpia (la que se deriva ya en el alta). */
export const EVM_FIRST_CLEAN_INDEX = 1;

/**
 * Tope de direcciones limpias por monedero. No es una restricción de producto
 * sino un freno a la metralla: cada índice nuevo es una cuenta más que consultar
 * en saldos y actividad, y una dirección más que el usuario tiene que entender.
 */
export const EVM_MAX_CLEAN_INDEX = 20;

/** Papel declarado de una dirección EVM del monedero. */
export type EvmPurpose = "principal" | "limpia";

/** Ruta BIP-32 de la dirección EVM de un índice. */
export function evmPath(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Índice de derivación EVM inválido: ${index}`);
  }
  return `${EVM_BASE_PATH}/${index}`;
}

/**
 * Índice de una ruta EVM de NUESTRA rama, o `null` si la ruta es de otra rama
 * (Bitcoin, Solana, el esquema Ledger Live…). Devolver `null` en vez de 0 es
 * deliberado: confundir una ruta ajena con el índice 0 haría pasar por
 * «principal» a una dirección que no lo es.
 *
 * Para las cuentas de un MONEDERO concreto usa `evmIndexOfWalletPath`: en un
 * importado el usuario puede haber elegido la ruta de su otra app.
 */
export function evmIndexOfPath(path: string | undefined | null): number | null {
  if (!path) return null;
  const prefix = `${EVM_BASE_PATH}/`;
  if (!path.startsWith(prefix)) return null;
  const tail = path.slice(prefix.length);
  if (!/^\d+$/.test(tail)) return null;
  return Number(tail);
}

/**
 * Las otras dos formas de poner la cuenta `i` en una ruta EVM (ver
 * `evmDerivation.ts`): Ledger Live y la antigua de MyEtherWallet. Tiene que
 * casar con `evmSchemeOfPath`; lo vigila un test.
 */
const OTHER_EVM_INDEX_RES: readonly RegExp[] = [
  /^m\/44'\/60'\/(\d+)'\/0\/0$/,
  /^m\/44'\/60'\/0'\/(\d+)$/,
];

/**
 * Índice de cuenta de una ruta EVM DE UN MONEDERO (07-10-2026). En un monedero
 * IMPORTADO reconoce además las rutas de Ledger Live y la antigua: el usuario
 * puede haberlas ELEGIDO para que su `0x` sea la de su otra app
 * (`EvmPathFinderDialog`), y al elegir se borra la cuenta anterior del mismo
 * índice, así que sigue habiendo una sola por índice. En el GENERADO, solo la
 * de MetaMask: un monedero antiguo con una ruta rara se sigue tratando como
 * principal por la red de seguridad de siempre (`evmFallback`), en vez de
 * convertirse de repente en la «Cuenta 8» y dejar sitio a una principal vacía.
 */
export function evmIndexOfWalletPath(
  wallet: { imported?: boolean } | null | undefined,
  path: string | undefined | null,
): number | null {
  const own = evmIndexOfPath(path);
  if (own != null || !wallet?.imported || !path) return own;
  for (const re of OTHER_EVM_INDEX_RES) {
    const m = re.exec(path);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Papel que corresponde a un índice de la rama EVM. */
export function purposeOfIndex(index: number): EvmPurpose {
  return index === EVM_MAIN_INDEX ? "principal" : "limpia";
}

/**
 * Siguiente índice limpio libre dado lo que ya existe. Es `max + 1` (nunca
 * rellena huecos): un índice ya derivado pudo entregarse y tener historial
 * aunque el saldo esté a cero, y reutilizarlo sería regalar el vínculo que la
 * función existe para evitar. Devuelve `null` si se alcanzó el tope.
 */
export function nextCleanIndex(existingIndexes: readonly number[]): number | null {
  const clean = existingIndexes.filter((i) => i >= EVM_FIRST_CLEAN_INDEX);
  const next = clean.length === 0 ? EVM_FIRST_CLEAN_INDEX : Math.max(...clean) + 1;
  return next > EVM_MAX_CLEAN_INDEX ? null : next;
}

/**
 * ¿Es una de las cuentas que SIEMPRE están a la vista? La principal (0) y la
 * primera limpia (1) son las que crea el alta —y el «ensure» de los monederos
 * anteriores— para todo el mundo; ocultarlas dejaría a alguien con «Nueva
 * cuenta» como único botón visible, sin ninguna cuenta delante (decisión del
 * dueño, 16-09-2026). Del índice 2 en adelante, el usuario decide.
 */
export function isAlwaysVisibleAccount(index: number): boolean {
  return index === EVM_MAIN_INDEX || index === EVM_FIRST_CLEAN_INDEX;
}

/**
 * Etiqueta corta para la UI cuando no se conoce el nombre que el usuario le
 * puso a la cuenta (fallback de `accountLabelOf`, `shared/wallet/accountNames.ts`).
 * Misma numeración que `defaultAccountName` — «Cuenta 1» es la principal, no
 * «Dirección principal»/«Dirección limpia»: esas palabras ya no las lee el
 * usuario (decisión del dueño, 22-09-2026); «limpia»/«principal» siguen vivas
 * como IDENTIFICADORES internos (`EvmPurpose`, comentarios, este fichero).
 */
export function evmPurposeLabel(index: number): string {
  return `Cuenta ${index + 1}`;
}

/**
 * Explicación de una línea para la UI. Describe HECHOS (tiene historial / no lo
 * tiene), no promesas de anonimato: es el texto que el usuario lee justo antes
 * de decidir a cuál manda, y prometer de más ahí hace daño de verdad.
 */
export function evmPurposeHint(index: number): string {
  return purposeOfIndex(index) === "principal"
    ? "Donde entregan las rampas y vive tu historial. Te identifica: en las formaciones es «tu dirección KYC»."
    : "Sin historial. Para la vuelta de un flujo de privacidad. No la fondees desde la principal o pierde el sentido.";
}
