# MuchoSigner: un móvil viejo como llave

Un único fichero, `muchosigner.html`, que convierte un móvil viejo **sin
conexión** en una llave para firmar. Todo entra y sale por la cámara y por
códigos QR: el móvil no se conecta a nada y tu frase no se guarda.

Versión del 2026-10-21 (código 8ebb649fa402).
SHA-256 de `muchosigner.html`:

```
475bdc99ca226679023ea4c08d76f47a20bb8da45e1902c03c13978c7d020f08
```

## Para qué sirve

| | Uso | El móvil es… |
|---|---|---|
| 1 | [Bitcoin de firma única](guias/1-bitcoin-firma-unica.md) | la única llave de una cuenta `bc1q…` |
| 2 | [Bitcoin multifirma, m de n](guias/2-bitcoin-multifirma.md) | una de las llaves de una bóveda |
| 3 | [Redes EVM, multifirma 1 de 1](guias/3-evm-multifirma-1-de-1.md) | la única llave de un Safe |
| 4 | [Redes EVM, multifirma m de n](guias/4-evm-multifirma-m-de-n.md) | una de las llaves de un Safe |

Empieza por [Antes de empezar: el móvil y el fichero](guias/0-antes-de-empezar.md).
La misma frase sirve para los cuatro usos. El ordenador que prepara los envíos
y recoge las firmas es Mucho Wallet.

## Descargar y comprobar

1. Descarga `muchosigner.html` de la [última versión](https://github.com/Blockchain-Networks-IO/muchosigner/releases/latest).
2. Comprueba que su huella es la de arriba (o la de `SHA256SUMS` de esa versión):
   - **Sin terminal:** https://wallet.mucho.finance/wallet/comprobar-muchosigner
     (la huella se calcula en tu navegador; el fichero no se sube).
   - **Mac:** `shasum -a 256 muchosigner.html`
   - **Windows (PowerShell):** `Get-FileHash muchosigner.html -Algorithm SHA256`
   - **Linux:** `sha256sum muchosigner.html`
3. Pásalo al móvil y ábrelo con el modo avión puesto.

Si la huella no coincide, **no escribas tu frase en ese fichero**.

## Qué garantiza y qué no

- **Sin red.** La página lleva `Content-Security-Policy` con
  `connect-src 'none'` y su código no usa ninguna conexión.
- **La frase no se guarda.** Se escribe (o se lee del SeedQR) en cada sesión.
- **Solo firma lo tuyo.** Comprueba cada envío contra la cuenta, la bóveda o
  la multifirma registrada, y comprueba el cambio que vuelve a ti.
- **Firmas Bitcoin con RFC 6979** (nonce determinista), sin «anti-exfil»: lo
  que protege de un firmante trucado es usarlo como UNA llave de una
  multifirma con las otras de fabricantes distintos.
- **No es una hardware wallet**: no tiene chip seguro. Su fuerza es no tener
  conexión.

## Qué hay en este repositorio

- `muchosigner.html`: el firmador, con todo su código dentro.
- `fuente/`: nuestro código que entra en él, sin minificar, para leer qué
  hace. Son los mismos módulos que usa Mucho Wallet.
- `DEPENDENCIAS.txt`: los paquetes de npm que entran, con su versión exacta.
- `guias/`: el paso a paso de cada uso.

Las dependencias que más llaman la atención, y para qué están:

- `@scure/*` y `@noble/*`: frases, llaves, firmas y transacciones Bitcoin.
- `@keystonehq/bc-ur-registry` y `@ngraveio/bc-ur`: los QR animados, en el
  formato que usan Sparrow, Keystone o SeedSigner.
- `jsqr`: leer los QR con la cámara.
- `react` y `qrcode.react`: pintar la página y los QR.
- `viem` y `permissionless`: recalcular SIN red la dirección de una
  multifirma (Safe) con el mismo código que usa Mucho Wallet.

Algunas de esas librerías traen código para hablar con un nodo. MuchoSigner no
lo usa y, aunque lo intentara, la página lo prohíbe con `connect-src 'none'`.

## Licencia

MIT (ver `LICENSE`).

Este repositorio se actualiza solo desde Mucho Wallet cada vez que cambia el
firmador.
