# 3 · Redes EVM: multifirma 1 de 1 (el móvil es la única llave)

Para guardar dólares (USDC…) en Ethereum, Arbitrum o Base con el móvil como
única llave. El móvil no firma envíos sueltos: firma operaciones de una
multifirma (un Safe). Con una sola llave y una sola firma, el Safe es tuyo y
solo tuyo.

> **Quien tenga tu frase mueve todo el dinero, y si la pierdes nadie puede
> recuperarlo.** Es como una cuenta de firma única. Si quieres poder perder
> una llave, usa la guía 4.

La llave EVM del móvil está en la ruta de siempre de MetaMask
(`m/44'/60'/0'/0/0`): con tu frase, cualquier monedero la recupera.

## Crear la multifirma

| Ordenador (Mucho Wallet › Nueva multifirma) | Móvil (MuchoSigner) |
|---|---|
| | En «4 · Multifirma EVM», **Enseñar mi dirección EVM para añadirla a una multifirma**. |
| Añade una llave de fuera con **Cámara**, apuntando al QR del móvil. | |
| Con esa única llave, elige **1 de 1**, lee el aviso y **Crear la multifirma**. | |
| En la multifirma, «Sus llaves» › **Registrarla en el MuchoSigner** (QR animado). | |
| | **Registrar una multifirma**. El móvil recalcula la dirección del Safe a partir de su llave: si no cuadra, no la registra. |

## Mover el dinero

| Ordenador | Móvil |
|---|---|
| Prepara el envío desde la multifirma y elige **Pedir las firmas con un enlace**. En la página de la operación, **Firmar con el MuchoSigner (un móvil sin internet)**. | |
| | **Leer la operación**. Revisa la red, el destino y lo que hace (traducido); una operación sobre la propia multifirma sale en rojo. **Firmar esta operación**. |
| **Leer la firma con la cámara** y, con la firma, **Ejecutar**. Una cuenta tuya del monedero paga el gas en ETH. | |

La firma vale aunque la recojas días después: va por la ruta clásica del Safe
(`SafeTx`), no por una operación con plazo.
