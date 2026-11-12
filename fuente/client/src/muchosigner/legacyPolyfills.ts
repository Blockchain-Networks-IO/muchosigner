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
