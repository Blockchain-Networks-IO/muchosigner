/**
 * SeedQR: la frase como QR, para que un firmador AMNÉSICO (que no guarda nada)
 * la lea con la cámara en vez de teclear 24 palabras. Es el formato de
 * SeedSigner (https://github.com/SeedSigner/seedsigner/blob/dev/docs/seed_qr/README.md),
 * así que un QR copiado a mano con sus plantillas sirve aquí y al revés:
 *
 *  - **Standard SeedQR** (el que se enseña aquí para copiarlo): cada palabra es
 *    su posición en la lista BIP-39 (0–2047) con 4 cifras, todas seguidas. 12
 *    palabras = 48 cifras → QR de 25×25; 24 palabras = 96 cifras → 29×29.
 *    Corrección de errores L y modo numérico, como SeedSigner.
 *  - **Compact SeedQR** (solo se LEE): los 16 o 32 bytes de la entropía en
 *    binario; 21×21 o 25×25.
 *
 * ⚠️ Un SeedQR ES la frase: quien lo fotografíe tiene tu llave. Se guarda como
 * las palabras, y la cuadrícula solo se enseña en el móvil sin conexión.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** «abandon … about» → «0000 0000 … 0003» sin espacios. */
export function seedQrDigits(mnemonic: string): string {
  const words = mnemonic.trim().split(/\s+/);
  return words
    .map(w => {
      const i = wordlist.indexOf(w);
      if (i < 0) throw new Error(`«${w}» no es una palabra de la lista BIP-39.`);
      return String(i).padStart(4, "0");
    })
    .join("");
}

/**
 * Lo que da la cámara → la frase. Acepta el Standard (48 o 96 cifras) y el
 * Compact (16 o 32 bytes en binario). Devuelve null si no es un SeedQR, y lanza
 * si lo parece pero no cuadra (una casilla mal pintada suele dar eso).
 */
export function mnemonicFromSeedQr(text: string, bytes?: ArrayLike<number>): string | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    if (t.length !== 48 && t.length !== 96) return null;
    const words: string[] = [];
    for (let i = 0; i < t.length; i += 4) {
      const n = Number(t.slice(i, i + 4));
      if (n > 2047) throw new Error("El SeedQR tiene un número fuera de la lista de palabras: revisa las casillas pintadas.");
      words.push(wordlist[n]);
    }
    const phrase = words.join(" ");
    if (!validateMnemonic(phrase, wordlist)) {
      throw new Error("El SeedQR se lee, pero la frase no cuadra (suma de control). Revisa las casillas pintadas.");
    }
    return phrase;
  }
  if (bytes && (bytes.length === 16 || bytes.length === 32)) {
    return entropyToMnemonic(Uint8Array.from(bytes), wordlist);
  }
  return null;
}

/** Compact SeedQR de una frase (lo que se pintaría si se eligiera ese formato). */
export function compactSeedQrBytes(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

/**
 * La cuadrícula de un QR pintado por `QRCodeSVG`, como filas de casillas
 * (true = negra). Su SVG lleva un `path` con un tramo `M x y h n v1 H x z` por
 * cada racha de casillas negras de una fila (dos variantes de separador), y
 * el tamaño en el `viewBox`. Puro, para poder probarlo.
 */
export function matrixFromQrSvg(svg: string): boolean[][] {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!vb) throw new Error("El QR no trae su tamaño.");
  const size = Number(vb[1]);
  const m = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const re = /M(\d+)[ ,](\d+) ?h(\d+)v1H\d+z/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(svg))) {
    const x = Number(hit[1]);
    const y = Number(hit[2]);
    const n = Number(hit[3]);
    for (let i = 0; i < n; i++) if (y < size && x + i < size) m[y][x + i] = true;
  }
  return m;
}

/** Standard SeedQR de la frase como cuadrícula (25×25 o 29×29). */
export function seedQrMatrix(mnemonic: string): boolean[][] {
  const svg = renderToStaticMarkup(
    createElement(QRCodeSVG, {
      value: seedQrDigits(mnemonic),
      level: "L",
      // Sin subir la corrección: así sale del mismo tamaño que en SeedSigner.
      boostLevel: false,
      marginSize: 0,
    })
  );
  const m = matrixFromQrSvg(svg);
  if (m.length !== 25 && m.length !== 29) {
    throw new Error(`El SeedQR ha salido de ${m.length}×${m.length}; se esperaba 25×25 o 29×29.`);
  }
  return m;
}

/** Letras de columna: A…Z y luego AA, AB… (29 columnas: hasta AC). */
export function columnLabel(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : "A" + String.fromCharCode(65 + i - 26);
}
