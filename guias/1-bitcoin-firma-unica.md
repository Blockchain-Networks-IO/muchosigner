# 1 · Bitcoin de firma única

El móvil es la ÚNICA llave de una cuenta Bitcoin normal, como un SeedSigner.
El ordenador la sigue como cuenta de solo lectura y prepara los envíos; el
móvil los firma.

> **Quien tenga tu frase tiene el dinero**, y si la pierdes no hay otra llave.
> Para guardar mucho, mejor la guía 2 (bóveda multifirma).

## Elegir el tipo de dirección y la cuenta

En «5 · Bitcoin de firma única», con la llave abierta:

- **Tipo de dirección**:
  - **Nativa (bc1q…)** — BIP-84, `m/84'/0'/cuenta'`. La de casi todos los
    monederos: si dudas, esta.
  - **Taproot (bc1p…)** — BIP-86, `m/86'/0'/cuenta'`.
  - **Anidada (3…)** — BIP-49, `m/49'/0'/cuenta'`. Para quien te pague desde
    un sitio que no acepta `bc1…`.
  - **Legacy (1…) · solo ver** — BIP-44, `m/44'/0'/cuenta'`. MuchoSigner la
    enseña para que el monedero la vigile (ves su saldo), pero **no la firma**:
    para gastar desde ella hace falta otro monedero que firme Legacy.
- **Número de cuenta**: 1 es la primera (`…/0'`), la que usan casi todos.
  Otra (2, 3…, hasta 100) sirve para separar dinero con la misma frase.
  **Apunta junto a tu frase qué tipo y qué número usas**: para recuperarla en
  otro monedero hace falta saberlo.

Cada combinación es una cuenta distinta, con sus direcciones: dalas de alta
por separado.

## Dar de alta la cuenta

| Ordenador (Mucho Wallet) | Móvil (MuchoSigner) |
|---|---|
| | Elige tipo y cuenta y pulsa **Enseñar mi cuenta para añadirla al monedero**. Sale un QR con tu cuenta pública (`wpkh(…)`, `tr(…)`, `sh(wpkh(…))` o `pkh(…)`, con tu huella y la ruta) y su primera dirección. |
| Monederos de hardware › añadir a mano › **Leer con la cámara**, apuntando al QR del móvil. El tipo lo lee del propio QR. | |
| Comprueba que la huella y la primera dirección del ordenador son las mismas que enseña el móvil. | |

## Recibir

Usa las direcciones que te da el ordenador para esa cuenta. Antes de recibir
mucho, haz una prueba pequeña de ida y vuelta.

## Enviar

| Ordenador | Móvil |
|---|---|
| En esa cuenta, **Enviar**: prepara el envío y lo enseña como QR animado. | |
| | **Leer el envío** (en la sección 5) y apunta la cámara hasta que se complete. No hace falta elegir antes tipo ni cuenta: el móvil los saca del propio envío. |
| | Revisa: a dónde va, cuánto, lo que vuelve a tu cuenta (dice a qué cuenta y si es cambio) y la comisión. Si cuadra, **Firmar este envío**. |
| | Enseña el envío firmado como QR animado. |
| Lee el QR firmado con la cámara y emite la transacción. | |

Si un envío junta monedas de varias cuentas o tipos de tu frase, el móvil lo
firma y lo avisa: en la cadena quedarán unidas como del mismo dueño.

Si el móvil rechaza el envío, no lo fuerces: es que lleva algo que no es de tu
frase (otra frase, otra passphrase, tu bóveda, una cuenta Legacy) o un cambio
que no vuelve a ti.
