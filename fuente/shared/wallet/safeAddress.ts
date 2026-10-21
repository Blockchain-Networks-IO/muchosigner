/**
 * Dirección CONTRAFACTUAL de un Safe del monedero, SIN red.
 *
 * El monedero calcula la dirección de cada Safe (direcciones de depósito,
 * envíos a un correo) con `toSafeSmartAccount` de permissionless, que pide al
 * nodo el `proxyCreationCode` de la SafeProxyFactory. Ese código es una
 * constante del contrato desplegado (el mismo en todas las redes, dirección
 * canónica): aquí va fijado, y un cliente de viem de juguete se lo sirve a
 * permissionless. Así la dirección sale por EXACTAMENTE el mismo código que la
 * usa el monedero —no una reimplementación que pudiera divergir en el
 * inicializador— y se puede calcular donde no hay nodo: en el verificador
 * autónomo de una prueba de propiedad (`docs/COFRES.md` §4).
 *
 * La dirección depende de (dueño, versión del Safe, entryPoint, saltNonce) y
 * NO de la red: por eso una sola prueba vale para Arbitrum, Base, Ethereum…
 * `safeAddress.test.ts` fija un vector obtenido contra la cadena real.
 */
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";
import { toAccount } from "viem/accounts";
import { entryPoint07Address } from "viem/account-abstraction";
import { toSafeSmartAccount } from "permissionless/accounts";
import { SAFE_ENTRY_POINT_VERSION, SAFE_VERSION } from "./safeConfig";
import { canonicalOwners } from "./safeMultisig";

/** SafeProxyFactory 1.4.1 (canónica, misma dirección en todas las redes). */
export const SAFE_PROXY_FACTORY_1_4_1 = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" as const;

/**
 * `proxyCreationCode()` de esa factoría, leído en Arbitrum y en Ethereum el
 * 27-09-2026 (idénticos). Es el bytecode de creación de SafeProxy: no cambia.
 */
export const SAFE_PROXY_CREATION_CODE_1_4_1: Hex =
  "0x" +
  "608060405234801561001057600080fd5b506040516101e63803806101e6833981810160405260208110156100335760" +
  "0080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ff" +
  "ffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000" +
  "000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191" +
  "505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff0219169083" +
  "73ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ff" +
  "ffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000" +
  "000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e600081" +
  "14156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a" +
  "82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e2061646472657373207072" +
  "6f7669646564" as Hex;

const PROXY_CREATION_CODE_SELECTOR = toFunctionSelector("proxyCreationCode()");

/**
 * Cliente de juguete: solo sabe contestar `proxyCreationCode()` de la
 * factoría. Cualquier otra llamada FALLA: si permissionless cambiara y
 * necesitara otra lectura, preferimos un error a una dirección inventada.
 */
function offlineClient(opts: { assumeUndeployed?: boolean } = {}) {
  return createPublicClient({
    chain: mainnet,
    transport: custom({
      async request({ method, params }) {
        if (method === "eth_chainId") return "0x1";
        // Solo para sacar los datos de despliegue: permissionless pregunta si
        // ya está desplegado y aquí se contesta «no» (quien despliega lo
        // comprueba antes en la red de verdad).
        if (method === "eth_getCode" && opts.assumeUndeployed) return "0x";
        if (method === "eth_call") {
          const [call] = params as [{ to?: string; data?: string }];
          if (
            call?.to?.toLowerCase() === SAFE_PROXY_FACTORY_1_4_1.toLowerCase() &&
            call.data?.toLowerCase().startsWith(PROXY_CREATION_CODE_SELECTOR)
          )
            return encodeAbiParameters([{ type: "bytes" }], [SAFE_PROXY_CREATION_CODE_1_4_1]);
        }
        throw new Error(`[safeAddress] llamada no prevista sin red: ${method}`);
      },
    }),
  });
}

/** Dueño «de solo dirección»: basta para calcular el Safe; no firma nada. */
function addressOnlyOwner(owner: Address) {
  const refuse = async (): Promise<Hex> => {
    throw new Error("[safeAddress] este dueño no firma: solo sirve para calcular la dirección.");
  };
  return toAccount({ address: owner, signMessage: refuse, signTransaction: refuse, signTypedData: refuse });
}

/**
 * Dirección del Safe (1 dueño, umbral 1) de `owner` con `saltNonce`, igual a la
 * que calcula el monedero. Las direcciones de depósito usan `saltNonce` 0.
 */
export async function counterfactualSafeAddress(owner: Address, saltNonce: bigint = 0n): Promise<Address> {
  const account = await toSafeSmartAccount({
    client: offlineClient(),
    owners: [addressOnlyOwner(owner)],
    version: SAFE_VERSION,
    entryPoint: { address: entryPoint07Address, version: SAFE_ENTRY_POINT_VERSION },
    saltNonce,
  });
  return account.address;
}

/**
 * Dirección de una MULTIFIRMA del monedero (N dueños, quórum `threshold`),
 * igual a la que calcula `multisigSafeAddress` con red: mismos dueños en orden
 * canónico, mismo quórum y mismo `saltNonce`. Sirve al firmador sin conexión
 * (`docs/MUCHOSIGNER.md` §«Multifirma EVM»), que comprueba que la
 * multifirma que le enseñan es de verdad la de esas llaves antes de apuntarla.
 */
export async function counterfactualMultisigAddress(
  owners: readonly Address[],
  threshold: number,
  saltNonce: bigint,
): Promise<Address> {
  const order = canonicalOwners(owners);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > order.length) {
    throw new Error(`Quórum no válido: ${threshold} de ${order.length}.`);
  }
  const account = await toSafeSmartAccount({
    client: offlineClient(),
    owners: order.map(addressOnlyOwner),
    threshold: BigInt(threshold),
    version: SAFE_VERSION,
    entryPoint: { address: entryPoint07Address, version: SAFE_ENTRY_POINT_VERSION },
    saltNonce,
  });
  return account.address;
}

/**
 * Cómo DESPLEGAR ese mismo Safe sin bundler: la llamada a la factoría
 * (`createProxyWithNonce` con el inicializador del monedero) que cualquier
 * cuenta puede enviar pagando su gas. Es lo que hace la herramienta de rescate
 * autónoma (`client/src/rescue/`, `docs/RESCATE-DIRECCIONES-DE-DEPOSITO.md`).
 * Sale del MISMO `toSafeSmartAccount` que la dirección: no hay un segundo
 * inicializador que pueda divergir.
 */
export async function counterfactualSafeDeployment(
  owner: Address,
  saltNonce: bigint = 0n,
): Promise<{ address: Address; factory: Address; factoryData: Hex }> {
  const account = await toSafeSmartAccount({
    client: offlineClient({ assumeUndeployed: true }),
    owners: [addressOnlyOwner(owner)],
    version: SAFE_VERSION,
    entryPoint: { address: entryPoint07Address, version: SAFE_ENTRY_POINT_VERSION },
    saltNonce,
  });
  const { factory, factoryData } = await account.getFactoryArgs();
  if (!factory || !factoryData) throw new Error("[safeAddress] sin datos de despliegue");
  return { address: account.address, factory, factoryData };
}
