# 5 · Ver mis direcciones

Para comprobar, sin conexión, que una frase es la de tu monedero: el móvil
enseña las direcciones que salen de ella y tú las comparas con las que ves en
Mucho Wallet (o en cualquier monedero que siga el estándar BIP-39). Así no
hace falta restaurar la frase en otra aplicación conectada, ni meter dinero
en ningún sitio, para ver que es la buena.

> Es la misma frase que abre tu dinero: hazlo solo en el móvil en modo avión,
> como todo lo demás de MuchoSigner.

## Cómo se hace

1. Abre tu llave con la frase (y la passphrase, si la usas: con otra, salen
   otras direcciones).
2. Baja a «6 · Ver mis direcciones».
3. Elige qué quieres ver:
   - **Ethereum y redes EVM**: una fila por cuenta, y la **ruta** de la app
     con la que creaste la frase. Cada app pone el número de cuenta en un
     sitio distinto, así que la misma frase da otras direcciones:
     - **Mucho Wallet · MetaMask** (también Rabby y Trust): la Cuenta N es
       `m/44'/60'/0'/0/N−1`.
     - **Ledger Live**: la Cuenta N es `m/44'/60'/N−1'/0/0`. La Cuenta 1
       coincide con la de MetaMask; las demás, no.
     - **MyEtherWallet antiguo** (y la app de Ledger para Chrome): la
       Cuenta N es `m/44'/60'/0'/N−1`.

     La dirección es la misma en Ethereum, Arbitrum, Base y el resto de
     redes EVM.
   - **Bitcoin**: el tipo de dirección (nativa `bc1q…`, Taproot `bc1p…`,
     anidada `3…` o Legacy `1…`), el número de cuenta y si quieres las de
     **recepción** (las que das para cobrar) o las de **cambio** (a donde
     vuelve lo que sobra de un envío). El monedero estrena una dirección en
     cada cobro: la tuya puede no ser la primera.
4. «Ver 10 más» enseña las diez siguientes (hasta 1 000).

Si las direcciones coinciden con las de tu monedero, la frase es la buena.

## Lo que no sale aquí

- Las **direcciones de depósito de un solo uso** de Mucho Wallet: no salen de
  una ruta, sino de una firma. Las recupera la herramienta de rescate del
  monedero.
- **Solana**, de momento.
