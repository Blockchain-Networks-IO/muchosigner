/**
 * Meter la frase PALABRA A PALABRA en MuchoSigner (`docs/MUCHOSIGNER.md`
 * §«Meter la frase»): una casilla por palabra, sugerencias de la lista BIP-39
 * y autocompletado en cuanto lo escrito solo encaja con una palabra. Puro y
 * sin DOM: la pantalla (`standalone.ts`) solo pinta y llama aquí.
 *
 * Lo que entra aquí es la frase: nada se guarda; el estado vive en memoria y la
 * pantalla lo vacía al cerrar la llave. La comprobación final (suma de
 * control) la hace el MISMO `parseMnemonic` que la entrada de una vez.
 */
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { parseMnemonic, type WordCount } from "./core";

/** Cuántas sugerencias se enseñan como mucho (botones tocables). */
export const SUGGESTION_MAX = 6;

/** Lo tecleado, como se compara: minúsculas y solo letras. */
export const normalizeTyped = (typed: string) => typed.toLowerCase().replace(/[^a-z]/g, "");

/** Palabras de la lista que empiezan por lo escrito (vacío → ninguna). */
export function suggestions(typed: string, max = SUGGESTION_MAX): string[] {
  const p = normalizeTyped(typed);
  if (!p) return [];
  const out: string[] = [];
  for (const w of wordlist) {
    if (w.startsWith(p)) {
      out.push(w);
      if (out.length >= max) break;
    }
  }
  return out;
}

export type TypedVerdict =
  /** Nada escrito. */
  | { status: "empty" }
  /** Solo encaja con UNA palabra: se completa sola. */
  | { status: "unique"; word: string }
  /** Es una palabra entera, pero otras empiezan igual («act» → «action»…): se acepta con Enter o tocándola. */
  | { status: "exact"; word: string; options: string[] }
  /** Varias posibles: hay que seguir escribiendo o tocar una. */
  | { status: "ambiguous"; options: string[] }
  /** Ninguna palabra de la lista empieza así. */
  | { status: "unknown" };

/** Qué hacer con lo que hay escrito en la casilla. */
export function evaluateTyped(typed: string): TypedVerdict {
  const p = normalizeTyped(typed);
  if (!p) return { status: "empty" };
  const all = wordlist.filter(w => w.startsWith(p));
  if (all.length === 0) return { status: "unknown" };
  if (all.length === 1) return { status: "unique", word: all[0] };
  const options = all.slice(0, SUGGESTION_MAX);
  if (all.includes(p)) return { status: "exact", word: p, options };
  return { status: "ambiguous", options };
}

/**
 * Lo que se acepta al pulsar Enter (o escribir un espacio): la palabra entera
 * o la única que encaja. Nunca una «parecida»: una palabra que no es de la
 * lista no se acepta.
 */
export function acceptTyped(typed: string): string | null {
  const v = evaluateTyped(typed);
  return v.status === "unique" || v.status === "exact" ? v.word : null;
}

/** El texto de por qué no se acepta lo escrito. */
export function typedProblem(typed: string): string | null {
  const v = evaluateTyped(typed);
  if (v.status === "unknown") return `«${normalizeTyped(typed)}» no es el principio de ninguna palabra de la lista BIP-39. Revisa lo que tienes apuntado.`;
  if (v.status === "ambiguous") return "Sigue escribiendo o toca la palabra correcta.";
  return null;
}

// ─── La frase entera ─────────────────────────────────────────────────────────

export interface PhraseEntry {
  count: WordCount;
  /** Una casilla por palabra; `null` = sin poner. */
  words: Array<string | null>;
  /** La casilla que se está escribiendo (== count cuando no queda ninguna). */
  cursor: number;
}

export const newEntry = (count: WordCount): PhraseEntry => ({ count, words: Array(count).fill(null), cursor: 0 });

/** Primera casilla vacía desde `from` (dando la vuelta); `count` si están todas. */
function nextEmpty(words: Array<string | null>, from: number): number {
  for (let k = 0; k < words.length; k++) {
    const i = (from + k) % words.length;
    if (!words[i]) return i;
  }
  return words.length;
}

/** Cambia a 12 o 24: conserva las que quepan. */
export function setCount(e: PhraseEntry, count: WordCount): PhraseEntry {
  const words = Array.from({ length: count }, (_, i) => e.words[i] ?? null);
  return { count, words, cursor: nextEmpty(words, 0) };
}

/** Pone una palabra en la casilla actual y pasa a la siguiente vacía. */
export function acceptWord(e: PhraseEntry, word: string): PhraseEntry {
  if (!wordlist.includes(word)) throw new Error(`«${word}» no es de la lista BIP-39.`);
  if (e.cursor >= e.count) return e;
  const words = [...e.words];
  words[e.cursor] = word;
  return { ...e, words, cursor: nextEmpty(words, e.cursor + 1) };
}

/** Elige una casilla para corregirla. */
export function editAt(e: PhraseEntry, i: number): PhraseEntry {
  if (i < 0 || i >= e.count) return e;
  return { ...e, cursor: i };
}

/** Vacía una casilla y se queda en ella. */
export function removeAt(e: PhraseEntry, i: number): PhraseEntry {
  if (i < 0 || i >= e.count) return e;
  const words = [...e.words];
  words[i] = null;
  return { ...e, words, cursor: i };
}

export const filledCount = (e: PhraseEntry) => e.words.filter(Boolean).length;
export const isComplete = (e: PhraseEntry) => filledCount(e) === e.count;

/**
 * Con todas las casillas puestas, la frase comprobada (suma de control) por el
 * MISMO `parseMnemonic` de siempre; lanza con su mismo texto si no cuadra.
 */
export function phraseOf(e: PhraseEntry): string {
  if (!isComplete(e)) throw new Error(`Faltan palabras: llevas ${filledCount(e)} de ${e.count}.`);
  return parseMnemonic(e.words.join(" "));
}

// ─── Lo que se sigue tecleando tras completar sola ───────────────────────────

/**
 * Al completarse sola a las 4 letras, quien escribe la palabra entera sigue
 * tecleando su final («aban» → «abandon», y llegan «d», «o», «n»). Esas letras
 * —y un espacio detrás— son de la palabra ya puesta, no el principio de la
 * siguiente: se tragan. `carry` es lo que queda de la palabra completada;
 * devuelve lo que sigue esperándose y lo que de verdad es de la casilla nueva.
 */
export function absorbCarry(carry: string, typed: string): { carry: string; rest: string } {
  const raw = typed.toLowerCase();
  if (!carry) return { carry: "", rest: raw };
  let i = 0;
  while (i < raw.length && i < carry.length && raw[i] === carry[i]) i++;
  if (i === raw.length) return { carry: carry.slice(i), rest: "" };
  // Un espacio (o salto) tras lo completado cierra la palabra y no cuenta.
  if (/\s/.test(raw[i])) return { carry: "", rest: raw.slice(i + 1).trimStart() };
  return { carry: "", rest: raw.slice(i) };
}
