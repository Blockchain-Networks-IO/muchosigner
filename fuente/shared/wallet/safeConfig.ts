/**
 * Parámetros del Safe (smart account ERC-4337) que usa el monedero.
 *
 * Están aquí, compartidos entre cliente y servidor, porque la dirección de un
 * Safe contrafactual depende de (owner, versión, entryPoint, saltNonce): si el
 * cliente y el servidor los escribieran cada uno por su lado y divergieran, el
 * remitente pagaría a una dirección y el destinatario buscaría en otra. Cambiar
 * cualquiera de estos valores cambia TODAS las direcciones que aún no se hayan
 * desplegado — no se tocan una vez haya fondos en producción.
 */
export const SAFE_VERSION = "1.4.1" as const;
export const SAFE_ENTRY_POINT_VERSION = "0.7" as const;
