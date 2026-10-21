# 1 · Bitcoin de firma única

El móvil es la ÚNICA llave de una cuenta Bitcoin normal (BIP-84, direcciones
`bc1q…`), como un SeedSigner. El ordenador la sigue como cuenta de solo
lectura y prepara los envíos; el móvil los firma.

> **Quien tenga tu frase tiene el dinero**, y si la pierdes no hay otra llave.
> Para guardar mucho, mejor la guía 2 (bóveda multifirma).

## Dar de alta la cuenta

| Ordenador (Mucho Wallet) | Móvil (MuchoSigner) |
|---|---|
| | Abre tu llave y, en «5 · Billetera de firma única (Bitcoin)», pulsa **Enseñar mi cuenta para añadirla al monedero**. Sale un QR con tu cuenta pública y su primera dirección. |
| Monederos de hardware › añadir a mano › **Leer con la cámara**, apuntando al QR del móvil. | |
| Comprueba que la primera dirección del ordenador es la misma que enseña el móvil. | |

## Recibir

Usa las direcciones que te da el ordenador para esa cuenta. Antes de recibir
mucho, haz una prueba pequeña de ida y vuelta.

## Enviar

| Ordenador | Móvil |
|---|---|
| En esa cuenta, **Enviar**: prepara el envío y lo enseña como QR animado. | |
| | **Leer el envío** y apunta la cámara hasta que se complete. |
| | Revisa: a dónde va, cuánto, lo que vuelve a tu cuenta y la comisión. Si cuadra, **Firmar este envío**. |
| | Enseña el envío firmado como QR animado. |
| Lee el QR firmado con la cámara y emite la transacción. | |

Si el móvil rechaza el envío, no lo fuerces: es que lleva algo que no es de tu
cuenta, o un cambio que no vuelve a ti.

Qué cubre: solo la cuenta 1 de BIP-84 y solo direcciones `bc1q…` (ni Taproot,
ni anidadas, ni otras cuentas).
