/**
 * Lo que le falta a un navegador de móvil VIEJO para arrancar MuchoSigner.
 *
 * MuchoSigner está pensado justo para móviles viejos, y su navegador suele ir
 * años por detrás. Caso real (12-11-2026): un socio abrió el fichero en el
 * navegador Mi de un Xiaomi antiguo y no respondía ningún botón. La librería de
 * curvas (noble) llama a `Object.hasOwn` al CARGAR —Chrome 93, Safari 15.4—, y
 * en un navegador anterior el script entero moría antes de enganchar un solo
 * botón: se veía la página y nada funcionaba.
 *
 * Y en el mismo móvil, con eso arreglado, saltó `Object.fromEntries` (Chrome
 * 73: su navegador era Chrome 71). Desde entonces `navegadorViejo.test.ts`
 * monta el fichero en un Chromium al que se le QUITA todo lo posterior a
 * Chrome 67 y recorre la llave entera: no se vuelve a ir método a método.
 *
 * Aquí van los métodos del lenguaje que usa el paquete y que llegaron tarde, y
 * nada más. La SINTAXIS nueva (`?.`, `??`…) la rebaja esbuild con el `target`
 * de `scripts/muchosignerBundle.ts`. El suelo de verdad es `BigInt` (Chrome 67,
 * Safari 14): sin él no se puede firmar y no se rellena; lo dice la página.
 *
 * Este fichero se inyecta el PRIMERO (antes de `nodeShim.ts`): tiene que estar
 * puesto antes de que se evalúe ningún módulo. Sin red, sin almacenamiento.
 */

function define(target: object, name: string, value: unknown): void {
  if (name in target) return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

// Chrome 73. Caso real: el MISMO socio, con el arreglo de hasOwn puesto, se
// paró aquí (Redmi Note 8 Pro, navegador Mi sobre Chrome 71).
define(Object, "fromEntries", function fromEntries(entries: Iterable<readonly [PropertyKey, unknown]>) {
  const out: Record<PropertyKey, unknown> = {};
  for (const [k, v] of entries) out[k as string] = v;
  return out;
});

// Chrome 69.
function flatten(arr: ArrayLike<unknown>, depth: number, out: unknown[]): unknown[] {
  for (let i = 0; i < arr.length; i++) {
    if (!(i in (arr as object))) continue;
    const v = arr[i];
    if (depth > 0 && Array.isArray(v)) flatten(v, depth - 1, out);
    else out.push(v);
  }
  return out;
}
define(Array.prototype, "flat", function flat(this: ArrayLike<unknown>, depth?: number) {
  return flatten(this, depth === undefined ? 1 : Math.trunc(Number(depth)) || 0, []);
});
define(Array.prototype, "flatMap", function flatMap<T, U>(
  this: ArrayLike<T>, fn: (v: T, i: number, a: ArrayLike<T>) => U | U[], thisArg?: unknown,
) {
  const mapped: unknown[] = [];
  for (let i = 0; i < this.length; i++) if (i in (this as object)) mapped.push(fn.call(thisArg, this[i], i, this));
  return flatten(mapped, 1, []);
});

// Chrome 70.
if (!("description" in Symbol.prototype)) {
  Object.defineProperty(Symbol.prototype, "description", {
    configurable: true,
    get(this: symbol) {
      const m = /^Symbol\(([\s\S]*)\)$/.exec(this.toString());
      return m ? m[1] : undefined;
    },
  });
}

define(Object, "hasOwn", function hasOwn(obj: object, key: PropertyKey): boolean {
  if (obj == null) throw new TypeError("Cannot convert undefined or null to object");
  return Object.prototype.hasOwnProperty.call(Object(obj), key);
});

function relativeIndex(len: number, n: number): number {
  const i = Math.trunc(n) || 0;
  return i < 0 ? len + i : i;
}

define(Array.prototype, "at", function at<T>(this: ArrayLike<T>, n: number): T | undefined {
  const k = relativeIndex(this.length, n);
  return k < 0 || k >= this.length ? undefined : this[k];
});
define(String.prototype, "at", function at(this: string, n: number): string | undefined {
  const s = String(this);
  const k = relativeIndex(s.length, n);
  return k < 0 || k >= s.length ? undefined : s.charAt(k);
});

define(Array.prototype, "findLast", function findLast<T>(
  this: ArrayLike<T>, fn: (v: T, i: number, a: ArrayLike<T>) => unknown, thisArg?: unknown,
): T | undefined {
  for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
  return undefined;
});
define(Array.prototype, "findLastIndex", function findLastIndex<T>(
  this: ArrayLike<T>, fn: (v: T, i: number, a: ArrayLike<T>) => unknown, thisArg?: unknown,
): number {
  for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i;
  return -1;
});

define(String.prototype, "replaceAll", function replaceAll(
  this: string, search: string | RegExp, replacement: string | ((substring: string, ...args: unknown[]) => string),
): string {
  const s = String(this);
  if (search instanceof RegExp) {
    if (!search.global) throw new TypeError("replaceAll must be called with a global RegExp");
    return s.replace(search, replacement as string);
  }
  // Sin expresiones regulares: el texto buscado puede llevar caracteres especiales.
  const parts = s.split(String(search));
  if (typeof replacement !== "function") return parts.join(String(replacement));
  return parts.reduce((acc, part, i) => (i === 0 ? part : acc + replacement(String(search)) + part), "");
});

define(Promise, "allSettled", function allSettled<T>(items: Iterable<T | PromiseLike<T>>) {
  return Promise.all(
    Array.from(items, p =>
      Promise.resolve(p).then(
        value => ({ status: "fulfilled" as const, value }),
        reason => ({ status: "rejected" as const, reason }),
      ),
    ),
  );
});
