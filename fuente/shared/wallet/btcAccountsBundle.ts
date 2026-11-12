/**
 * «Todas mis cuentas Bitcoin» de una vez (petición del dueño, 12-11-2026).
 *
 * Una xpub es UN tipo de dirección y UNA cuenta: el número de cuenta va en un
 * tramo endurecido de la ruta (`m/84'/0'/{cuenta}'`), así que de la xpub de la
 * cuenta 1 no sale la de la cuenta 2, y la nativa no da la Taproot. Quien tiene
 * saldo repartido necesita varias. MuchoSigner (sin red) no puede saber cuáles
 * se usaron, así que las ENSEÑA todas —cuatro tipos por cada cuenta pedida— en
 * un QR que va pasando por partes, y el monedero las lee de una vez, mira en el
 * navegador cuáles tienen historial y guarda solo esas.
 *
 * Formato de cada parte (texto plano, legible a ojo):
 *
 *     mucho-btc-cuentas:2/7
 *     wpkh([huella/84h/0h/3h]xpub…/<0;1>/*)
 *     tr([huella/86h/0h/3h]xpub…/<0;1>/*)
 *
 * Cada parte lleva descriptores ENTEROS: una parte suelta ya vale por sí sola.
 * Solo claves PÚBLICAS: dejan ver el saldo de esas cuentas, no gastarlo.
 *
 * Puro: sin red ni DOM. Lo usan MuchoSigner (`single.ts`) y el monedero
 * (`LedgerCard`).
 */
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";

export const ACCOUNTS_BUNDLE_TAG = "mucho-btc-cuentas";
/** Descriptores por parte: tres caben holgados en un QR que lee un móvil viejo. */
export const BUNDLE_DESCRIPTORS_PER_PART = 3;
/** Cuentas que se pueden pedir de una vez (×4 tipos = 80 claves). */
export const BUNDLE_MAX_ACCOUNTS = 20;
const MAX_PARTS = Math.ceil((BUNDLE_MAX_ACCOUNTS * 4) / BUNDLE_DESCRIPTORS_PER_PART);

const HEADER_RE = new RegExp(`^${ACCOUNTS_BUNDLE_TAG}:(\\d+)/(\\d+)$`);

/** Parte las claves en textos para un QR que va pasando. */
export function bundleParts(descriptors: readonly string[], perPart = BUNDLE_DESCRIPTORS_PER_PART): string[] {
  const clean = descriptors.map((d) => d.trim()).filter(Boolean);
  if (!clean.length) throw new Error("No hay ninguna cuenta que enseñar.");
  const n = Math.ceil(clean.length / perPart);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push([`${ACCOUNTS_BUNDLE_TAG}:${i + 1}/${n}`, ...clean.slice(i * perPart, (i + 1) * perPart)].join("\n"));
  }
  return parts;
}

export interface BundlePart {
  index: number;
  total: number;
  descriptors: string[];
}

/** Una parte, o `null` si el texto no es de este formato. */
export function parseBundlePart(text: string): BundlePart | null {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const m = lines[0]?.match(HEADER_RE);
  if (!m) return null;
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (!(total >= 1 && total <= MAX_PARTS && index >= 1 && index <= total)) return null;
  const descriptors = lines.slice(1);
  if (!descriptors.length || descriptors.length > BUNDLE_DESCRIPTORS_PER_PART * 2) return null;
  return { index, total, descriptors };
}

export type BundleStatus =
  | { status: "ignored" }
  | { status: "partial"; got: number; total: number }
  | { status: "done"; descriptors: string[] };

/** Junta las partes en cualquier orden; las repetidas no cuentan dos veces. */
export class AccountsBundleCollector {
  private total = 0;
  private parts = new Map<number, string[]>();

  receive(text: string): BundleStatus {
    const p = parseBundlePart(text);
    if (!p) return { status: "ignored" };
    if (this.total && p.total !== this.total) {
      // Otro QR distinto: se empieza de nuevo con este.
      this.parts.clear();
    }
    this.total = p.total;
    this.parts.set(p.index, p.descriptors);
    if (this.parts.size < this.total) return { status: "partial", got: this.parts.size, total: this.total };
    const out: string[] = [];
    for (let i = 1; i <= this.total; i++) out.push(...(this.parts.get(i) ?? []));
    return { status: "done", descriptors: [...new Set(out)] };
  }
}

/** ¿Este texto es una parte del QR de «todas mis cuentas»? */
export const looksLikeAccountsBundle = (text: string) => text.trim().startsWith(`${ACCOUNTS_BUNDLE_TAG}:`);

// ─── xpub ⇄ zpub/ypub (SLIP-132) ─────────────────────────────────────────────

const b58c = base58check(sha256);
const VERSION = { xpub: 0x0488b21e, ypub: 0x049d7cb8, zpub: 0x04b24746 } as const;
export type ExtendedKeyPrefix = keyof typeof VERSION;

/**
 * El prefijo con que la piden otras apps (BlueWallet, Electrum…): zpub para la
 * nativa (84), ypub para la anidada (49) y xpub para Legacy (44). Taproot (86)
 * no tiene prefijo estándar: va como xpub y conviene usar el descriptor.
 */
export function slip132PrefixFor(purpose: number): ExtendedKeyPrefix {
  return purpose === 84 ? "zpub" : purpose === 49 ? "ypub" : "xpub";
}

/** La misma clave con otro prefijo (solo cambian los 4 bytes de versión). */
export function withPrefix(extendedKey: string, prefix: ExtendedKeyPrefix): string {
  const raw = b58c.decode(extendedKey.trim());
  if (raw.length !== 78) throw new Error("Clave extendida no válida.");
  const v = (raw[0] << 24) | (raw[1] << 16) | (raw[2] << 8) | raw[3];
  if (!Object.values(VERSION).includes((v >>> 0) as (typeof VERSION)[ExtendedKeyPrefix])) {
    throw new Error("Solo claves PÚBLICAS de mainnet (xpub, ypub, zpub).");
  }
  const out = raw.slice();
  const to = VERSION[prefix];
  out[0] = (to >>> 24) & 0xff;
  out[1] = (to >>> 16) & 0xff;
  out[2] = (to >>> 8) & 0xff;
  out[3] = to & 0xff;
  return b58c.encode(out);
}
