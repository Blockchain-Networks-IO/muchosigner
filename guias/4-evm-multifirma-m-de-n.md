# 4 · Redes EVM: multifirma m de n (el móvil es una de las llaves)

Un Safe en Ethereum, Arbitrum o Base con varias llaves, una de ellas el móvil.
Por ejemplo, 2 de 3: la llave de tu Mucho Wallet, un Ledger y el móvil.

> Una multifirma que pide **1 firma** deja que CUALQUIER llave mueva todo ella
> sola. Una que pide **todas** se bloquea para siempre si pierdes una. Lo sano
> suele ser pedir más de una y menos que todas.

## Crear la multifirma

| Ordenador (Mucho Wallet › Nueva multifirma) | Móvil (MuchoSigner) |
|---|---|
| | En «4 · Multifirma EVM», **Enseñar mi dirección EVM para añadirla a una multifirma**. |
| Añade la llave del móvil como llave de fuera con **Cámara**, y el resto de llaves. | |
| Elige cuántas firmas hacen falta y **Crear la multifirma**. | |
| En la multifirma, «Sus llaves» › **Registrarla en el MuchoSigner** (QR animado). | |
| | **Registrar una multifirma**. El móvil recalcula la dirección del Safe con todas sus llaves y su quórum, y comprueba que su llave está entre ellas. |

## Mover el dinero

1. Prepara la operación en el ordenador. Si las llaves que firman no están
   todas en ese ordenador, elige **Pedir las firmas con un enlace**.
2. Cada llave firma por su lado. La del móvil: en la página de la operación,
   **Firmar con el MuchoSigner (un móvil sin internet)** → en el móvil,
   **Leer la operación**, revisar y **Firmar esta operación** → en el
   ordenador, **Leer la firma con la cámara**.
3. Al llegar a las firmas que hacen falta, **Ejecutar**. Una cuenta del
   monedero paga el gas en ETH.

## Si pierdes el móvil

Si la multifirma pide menos firmas que llaves tiene, sigues moviendo el dinero
con las demás. Con tu frase rehaces la llave del móvil en otro aparato.
