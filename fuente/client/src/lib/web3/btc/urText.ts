/**
 * Reconocer texto UR (BC-UR2) sin arrastrar el códec: son dos expresiones
 * regulares y las usa la pantalla de multifirma para decidir si lo pegado es un
 * UR *antes* de cargar bajo demanda `descriptorUr.ts` (que sí trae el CBOR y
 * las bytewords, ~200 KB).
 */

/** ¿Este texto parece un (o varios) UR? */
export function looksLikeUr(text: string): boolean {
  return /^\s*ur:[a-z0-9-]+\//i.test(text.trim());
}

/** Trocea un pegote de texto en las partes UR que contenga, en minúsculas. */
export function splitUrParts(text: string): string[] {
  return (text.match(/ur:[a-z0-9-]+\/[a-z0-9/-]+/gi) ?? []).map(p =>
    p.trim().toLowerCase()
  );
}
