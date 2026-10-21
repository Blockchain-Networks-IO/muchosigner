# 0 · Antes de empezar: el móvil y el fichero

MuchoSigner es UN fichero, `muchosigner.html`, que convierte un móvil viejo en
una llave. El móvil vive sin conexión: todo entra y sale por la cámara y por
códigos QR.

## Lo que hace y lo que no

- **No se conecta a nada.** La página prohíbe cualquier conexión de red (su
  `Content-Security-Policy` lleva `connect-src 'none'`) y su código no usa
  ninguna. Si el móvil tiene conexión, lo avisa en rojo.
- **Tu frase no se guarda.** Vive en memoria hasta que pulsas «Cerrar la llave
  (borra la frase de este móvil)» o cierras la pestaña. En cada sesión la
  vuelves a escribir (bastan las 4 primeras letras de cada palabra) o la lees
  de tu SeedQR con la cámara. Un móvil viejo no tiene chip seguro: así la llave
  no está en él.
- **Solo firma lo tuyo.** Cada envío se comprueba contra la cuenta, la bóveda
  o la multifirma que registraste: una entrada que no es tuya rechaza el envío
  entero, y el cambio que vuelve a ti se comprueba de verdad.
- **No es una hardware wallet.** No tiene chip seguro ni pantalla de confianza:
  su fuerza es no tener conexión. Para guardar mucho, úsalo como UNA de las
  llaves de una multifirma, con las otras de fabricantes distintos.

## Preparar el móvil

1. Restablécelo de fábrica.
2. Quítale la SIM, la wifi y el Bluetooth, y ponlo en modo avión.
3. El navegador: en los Xiaomi, el **navegador Mi** (probado en un Xiaomi 12
   Pro). **Chrome no deja usar la cámara** a un fichero abierto desde el
   móvil. Otras marcas no están probadas todavía.

## Descargar y comprobar el fichero

1. Descarga `muchosigner.html` de la [última versión](https://github.com/Blockchain-Networks-IO/muchosigner/releases/latest)
   de este repositorio.
2. Comprueba su huella (SHA-256). Tiene que ser la de `SHA256SUMS` de esa
   versión:
   - **Sin terminal:** abre https://wallet.mucho.finance/wallet/comprobar-muchosigner,
     elige el fichero (la huella se calcula en tu navegador, no se sube nada) y
     pega la huella publicada aquí.
   - **Mac:** `shasum -a 256 muchosigner.html`
   - **Windows (PowerShell):** `Get-FileHash muchosigner.html -Algorithm SHA256`
   - **Linux:** `sha256sum muchosigner.html`
3. Pásalo al móvil (por cable, por ejemplo) y ábrelo con el navegador, ya en
   modo avión.

Si la huella no coincide, **no escribas tu frase en ese fichero**.

## Crear tu llave

En «1 · Tu llave»: dados, monedas o el azar del móvil, 12 o 24 palabras.

- **Dados:** al menos 99 tiradas para 24 palabras (50 para 12). Es el método
  de Coldcard y SeedSigner: la misma secuencia da la misma frase allí.
- **Apunta la frase en papel.** La página te pide tres palabras al azar para
  comprobar que la apuntaste bien.
- **SeedQR (opcional):** «Enseñar mi SeedQR para copiarlo a mano» y una
  plantilla en blanco para copiarlo. Con él, abrir la llave es apuntar la
  cámara («Leer mi SeedQR con la cámara»). Guárdalo como guardas la frase:
  quien lo lea tiene tu llave.

La misma frase sirve para los cuatro usos de estas guías.
