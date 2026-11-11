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
   - **Ethereum y redes EVM**: una fila por cuenta. La Cuenta N de Mucho
     Wallet es la ruta `m/44'/60'/0'/0/N−1`, la de MetaMask. Es la misma
     dirección en Ethereum, Arbitrum, Base y el resto de redes EVM.
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
- Las cuentas de un monedero importado con la **ruta de otra aplicación**
  (Ledger Live, la ruta antigua de algunos monederos): con la misma frase dan
  otras direcciones.
