/**
 * Tokens conocidos por cadena (para los selectores de envío/swap).
 *
 * El catálogo vive en `@shared/wallet/knownTokens` porque el SERVIDOR también lo
 * lee: es la lista de tokens cuyo saldo se consulta por RPC en las redes que
 * Moralis no cubre (HyperEVM, Robinhood Chain). Este módulo solo lo reexporta
 * para que los importadores del cliente no cambien.
 */
export {
  knownTokens,
  USDG_ROBINHOOD,
  type KnownToken,
  type TokenAddress,
} from "@shared/wallet/knownTokens";
