# 2 · Bitcoin multifirma (m de n)

El móvil es UNA de las llaves de una bóveda multifirma Bitcoin (P2WSH,
`wsh(sortedmulti(…))`, ruta `48'/0'/0'/2'`). Por ejemplo, 2 de 3: el móvil, un
Ledger y un OneKey; hacen falta dos para mover el dinero y puedes perder una
sin perder nada.

> **Mejor si cada llave es de un fabricante distinto.** Un aparato con el
> software trucado podría esconder su frase dentro de las firmas sin que se
> note. Con llaves de marcas distintas ese fallo se lleva una sola, y si la
> bóveda pide dos firmas o más, una sola no basta.
>
> Una bóveda que pide **1 firma** no protege más que una cuenta normal, y una
> que pide **todas** se bloquea para siempre si pierdes una llave.

## Crear la bóveda

| Ordenador (Mucho Wallet › Multifirma, «Crea tu bóveda») | Móvil (MuchoSigner) |
|---|---|
| | Abre tu llave y pulsa **Enseñar mi clave para crear la bóveda**. |
| Añade una llave de tipo «Dispositivo (Tapsigner / Coldcard / Passport…)» y pulsa **Leer su QR con la cámara**. Comprueba que la huella de 8 caracteres es la del móvil. | |
| Añade las demás llaves (Ledger u OneKey por USB, otras por QR o pegando su clave pública), elige cuántas firmas hacen falta y crea la bóveda. | |
| Guarda su copia de seguridad (**Descargar BSMS**) y enseña el QR de la bóveda. | |
| | En «2 · Tu bóveda», **Leer el QR de la bóveda**. Comprueba que la primera dirección es la misma que en el ordenador. |

El móvil recuerda la bóveda (es pública): la próxima vez solo tendrás que abrir
tu llave.

## Enviar

| Ordenador | Móvil |
|---|---|
| Prepara el envío y enséñalo en QR animado. | |
| | En «3 · Firmar un envío», **Leer el envío**. |
| | Revisa a dónde va, cuánto, lo que «vuelve a tu bóveda» y la comisión. **Firmar este envío** y enseña el resultado en QR. |
| Lee el envío firmado, junta las demás firmas que falten y emítelo. | |

Primero una prueba con poco dinero.

## Si pierdes el móvil

No pasa nada si la bóveda pide menos firmas que llaves tienes: con las otras
llaves y la copia de la bóveda se sigue gastando, y con tu frase puedes
rehacer esta llave en otro móvil (o en cualquier aparato que hable BIP-39).
