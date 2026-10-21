/**
 * `Buffer` y `process` globales para el firmador autónomo: el códec del QR de
 * la bóveda (bc-ur-registry → cipher-base) los da por hechos. En la app los
 * pone vite-plugin-node-polyfills; aquí, este fichero (lo inyecta
 * `scripts/build-muchosigner.ts`), con los mismos paquetes.
 */
import { Buffer } from "buffer";
import process from "process";

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: typeof process };
g.Buffer = g.Buffer ?? Buffer;
g.process = g.process ?? process;
