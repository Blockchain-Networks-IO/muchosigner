/**
 * Checksum de descriptor (BIP-380), el de 8 caracteres tras el `#` que calculan
 * Bitcoin Core y Sparrow. Puro y sin dependencias: lo usan el coordinador
 * multisig (`btcMultisig.ts`) y la herramienta de rescate AUTÓNOMA de la bóveda
 * con heredero, que no puede arrastrar el resto del monedero.
 */
const DESC_INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const DESC_CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const DESC_GENERATOR = [
  0xf5dee51989n,
  0xa9fdca3312n,
  0x1bab10e32dn,
  0x3706b1677an,
  0x644d626ffdn,
];

function descPolymod(symbols: number[]): bigint {
  let chk = 1n;
  for (const value of symbols) {
    const top = chk >> 35n;
    chk = ((chk & 0x7ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i++)
      if ((top >> BigInt(i)) & 1n) chk ^= DESC_GENERATOR[i];
  }
  return chk;
}

/** Calcula el checksum de 8 chars de un descriptor (sin el `#`), como Core/Sparrow. */
export function descriptorChecksum(desc: string): string {
  const symbols: number[] = [];
  const groups: number[] = [];
  for (const c of desc) {
    const v = DESC_INPUT_CHARSET.indexOf(c);
    if (v < 0) throw new Error(`Carácter no válido en el descriptor: "${c}".`);
    symbols.push(v & 31);
    groups.push(v >> 5);
    if (groups.length === 3) {
      symbols.push(groups[0] * 9 + groups[1] * 3 + groups[2]);
      groups.length = 0;
    }
  }
  if (groups.length === 1) symbols.push(groups[0]);
  else if (groups.length === 2) symbols.push(groups[0] * 3 + groups[1]);
  symbols.push(0, 0, 0, 0, 0, 0, 0, 0);
  const chk = descPolymod(symbols) ^ 1n;
  let out = "";
  for (let i = 0; i < 8; i++)
    out += DESC_CHECKSUM_CHARSET[Number((chk >> BigInt(5 * (7 - i))) & 31n)];
  return out;
}
