/**
 * build-muchosigner — empaqueta `client/src/muchosigner/standalone.ts` en UN solo
 * fichero HTML sin dependencias externas: MuchoSigner
 * (`client/public/muchosigner.html`), que
 * Vite copia tal cual a `dist/public`. Es el firmador sin conexión: un móvil
 * viejo en modo avión como llave de la bóveda multifirma
 * (`docs/MUCHOSIGNER.md`). Se ejecuta en `pnpm build` (antes de vite)
 * y a mano con `pnpm build:muchosigner`.
 *
 * Usa los MISMOS módulos que el monedero (alias @shared y @): la bóveda se
 * deriva y el envío se lee con el mismo código que en la app.
 *
 * Imprime el SHA-256 del fichero: es lo que se publica para que cada cual
 * compruebe que el que tiene en el móvil es el bueno.
 */
import { build } from "esbuild";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { muchosignerBuildOptions } from "./muchosignerBundle";

const root = resolve(import.meta.dirname ?? ".", "..");

const result = await build(muchosignerBuildOptions(root));
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob: mediastream:; connect-src 'none'">
<title>MuchoSigner · firmador sin conexión</title>
<style>
  :root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#14161a;--muted:#5f6368;--line:#e2e5e9;--ok:#047857;--bad:#b91c1c;--warn:#b45309;--acc:#1d4ed8}
  @media(prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b22;--fg:#e8eaed;--muted:#9aa0a6;--line:#2a2f3a;--ok:#34d399;--bad:#f87171;--warn:#fbbf24;--acc:#60a5fa}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
  main{max-width:560px;margin:0 auto}
  h1{font-size:21px;margin:4px 0}
  h2{font-size:17px;margin:0 0 6px} h3{font-size:15px;margin:16px 0 4px}
  ul.safes{list-style:none;padding:0;margin:6px 0} ul.safes li{padding:6px 0;border-bottom:1px solid var(--line)}
  dl.tx{margin:6px 0} dl.tx dt{color:var(--muted);font-size:13px;margin-top:6px} dl.tx dd{margin:0}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0}
  .muted{color:var(--muted);font-size:14px}
  button{font:inherit;font-weight:600;width:100%;padding:12px;border-radius:10px;border:0;background:var(--acc);color:#fff;margin-top:8px;cursor:pointer}
  button.sec{background:transparent;color:var(--fg);border:1px solid var(--line)}
  .tabs{display:flex;gap:6px}
  .tabs button{flex:1;margin:0;padding:9px 4px;font-size:14px;background:transparent;color:var(--fg);border:1px solid var(--line)}
  .tabs button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
  textarea,input{width:100%;font:15px/1.4 ui-monospace,monospace;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
  textarea{min-height:110px}
  label{display:block;margin-top:8px;font-size:14px}
  .row{display:flex;gap:6px;align-items:center}
  .row input{flex:1}
  .row button{width:auto;margin:0;padding:10px 12px}
  p.ok,p.bad,p.info,p.warn{padding:8px 10px;border-radius:8px;margin:8px 0}
  p.ok{background:color-mix(in srgb,var(--ok) 15%,transparent)} p.bad{background:color-mix(in srgb,var(--bad) 15%,transparent)}
  p.info{background:color-mix(in srgb,var(--muted) 12%,transparent)} p.warn{background:color-mix(in srgb,var(--warn) 16%,transparent)}
  .ok-t{color:var(--ok)} .bad-t{color:var(--bad)}
  ol.words{columns:2;padding-left:0;list-style:none;font:15px/1.9 ui-monospace,monospace;margin:8px 0}
  ol.words span{display:inline-block;width:2.2em;color:var(--muted)}
  code{font:12px/1.4 ui-monospace,monospace;word-break:break-all}
  .fp{font:700 20px ui-monospace,monospace;letter-spacing:.06em}
  .qr{display:inline-block;background:#fff;padding:10px;border-radius:10px}
  .qr svg{width:min(78vw,300px);height:auto;display:block}
  .center{text-align:center}
  video{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#000;margin-top:8px}
  ul.outs{padding-left:18px} ul.outs li{margin:8px 0} li.own{color:var(--ok)}
  #online-warn{border-color:var(--bad)}
  .gridwrap{background:#fff;color:#444;padding:8px;border-radius:8px;overflow:auto;margin-top:8px}
  table.grid{border-collapse:collapse;margin:0 auto;font:9px/1 ui-monospace,monospace;--c:9px;table-layout:fixed}
  table.grid.big{--c:18px}
  table.grid td{width:var(--c);height:var(--c);min-width:var(--c);max-width:var(--c);border:1px solid #e3e3e3;padding:0;box-sizing:border-box}
  table.grid td.on{background:#000;border-color:#000}
  table.grid td.r5{border-right:1px solid #b0b0b0}
  table.grid tr.b5 td{border-bottom:1px solid #b0b0b0}
  table.grid td.on.r5,table.grid tr.b5 td.on{border-color:#000}
  table.grid th{font-weight:400;color:#888;padding:0;text-align:center;width:var(--c);height:var(--c)}
  /* Margen blanco entre las coordenadas y el código: sin él la cámara no lo lee. */
  table.grid th.gap,table.grid td.gap{border:0;background:#fff}
  .tpl-title{font-weight:600;color:#222;margin:12px 0 4px}
  @media print{
    body{background:#fff;padding:0}
    main > *{display:none!important}
    #plantilla-card{display:block!important;border:0;padding:0}
    #plantilla-card > :not(#plantilla), #plantilla-print{display:none!important}
    #plantilla{display:block!important}
    .print-page{break-after:page}
    table.grid{--c:6mm;font-size:8pt}
  }
</style>
</head>
<body>
<main>
<h1>MuchoSigner</h1>
<p class="muted">Convierte este móvil en una llave de tu bóveda multifirma de Bitcoin, de tus multifirmas EVM (Ethereum, Arbitrum, Base) o de una cuenta Bitcoin de firma única. Todo pasa en esta página y por la cámara: no se conecta a nada y tu frase no se guarda.</p>

<div class="card" id="online-warn" hidden>
  <p class="bad">Este móvil tiene conexión. Un firmador no debe conectarse nunca: activa el modo avión, quita la wifi y saca la SIM antes de escribir o crear una frase.</p>
</div>

<section class="card">
  <h2>1 · Tu llave</h2>
  <div id="key-new">
    <div class="tabs">
      <button id="btn-tab-frase" type="button">Mi frase</button>
      <button id="btn-tab-dados" type="button">Dados</button>
      <button id="btn-tab-monedas" type="button">Monedas</button>
      <button id="btn-tab-azar" type="button">Azar del móvil</button>
    </div>
    <div id="tab-frase">
      <label>Tus 12 o 24 palabras, en orden (bastan las 4 primeras letras de cada una)
        <textarea id="words" autocomplete="off" autocapitalize="none" spellcheck="false"></textarea></label>
      <button id="open" type="button">Abrir mi llave</button>
      <button class="sec" id="scan-seedqr" type="button">Leer mi SeedQR con la cámara</button>
      <div id="seedcam"></div>
    </div>
    <div id="wc-row" hidden>
      <p class="muted" style="margin-bottom:4px">¿Cuántas palabras?</p>
      <div class="tabs">
        <button id="wc-12" type="button">12 palabras</button>
        <button id="wc-24" type="button">24 palabras</button>
      </div>
    </div>
    <div id="tab-dados" hidden>
      <p class="muted">Tira un dado de 6 caras (mejor de casino) y escribe cada resultado: <b id="dice-need">99</b> tiradas como mínimo. La frase sale de tus tiradas con el método de Coldcard y SeedSigner (SHA-256 del texto de las tiradas). Así no dependes del azar de este móvil.</p>
      <label>Tiradas (solo números del 1 al 6; los espacios dan igual)
        <textarea id="dice" inputmode="numeric" autocomplete="off"></textarea></label>
      <p id="dice-count" class="muted">0 de 99 tiradas</p>
      <button id="from-dice" type="button">Calcular mis 24 palabras</button>
    </div>
    <div id="tab-monedas" hidden>
      <p class="muted">Lanza una moneda <b id="coins-need">256</b> veces exactas y apunta cada resultado: <b>1 = cara</b>, <b>0 = cruz</b>. Cada lanzamiento es un bit de tu llave, tal cual, sin pasar por ningún cálculo: se puede comprobar a mano.</p>
      <div class="row" style="margin-top:8px">
        <button id="coin-1" type="button" style="margin:0">Cara (1)</button>
        <button id="coin-0" type="button" style="margin:0">Cruz (0)</button>
        <button class="sec" id="coin-del" type="button" style="margin:0;width:auto">Borrar</button>
      </div>
      <label>Lanzamientos
        <textarea id="coins" inputmode="numeric" autocomplete="off"></textarea></label>
      <p id="coins-count" class="muted">0 de 256 lanzamientos</p>
      <button id="from-coins" type="button">Calcular mis 24 palabras</button>
    </div>
    <div id="tab-azar" hidden>
      <p class="muted">Genera la frase con el azar del sistema de este móvil. Con dados o monedas es más seguro: no dependes de que el azar del móvil sea bueno.</p>
      <button id="from-random" type="button">Generar mis 24 palabras</button>
    </div>
    <label>Passphrase (opcional; si la usas, sin ella no hay forma de recuperar tu llave)
      <span class="row"><input id="passphrase" type="password" autocomplete="off" autocapitalize="none" spellcheck="false"><button class="sec" id="pp-toggle" type="button">Ver</button></span></label>
    <div id="keymsg"></div>
    <div id="draft" hidden>
      <p class="warn">Apunta estas <span id="draft-n">24</span> palabras en papel, en orden. Son tu llave: con ellas cualquiera puede firmar por ti y sin ellas no se recupera. No les hagas foto.</p>
      <ol class="words" id="draft-words"></ol>
      <p>Para comprobar que las has apuntado bien, escribe estas palabras:</p>
      <div id="draft-checks"></div>
      <div id="draftmsg"></div>
      <button id="draft-ok" type="button">Las tengo apuntadas: abrir mi llave</button>
      <button class="sec" id="draft-cancel" type="button">Descartar estas palabras</button>
    </div>
  </div>
  <div id="key-open" hidden>
    <p>Huella de tu llave:</p>
    <p class="fp center" id="fp"></p>
    <p class="muted">Apúntala junto a tus palabras. Si un día escribes mal una palabra o la passphrase, la huella sale distinta: así sabes que algo no cuadra. <span id="pp-note" hidden>Esta huella incluye tu passphrase.</span></p>
    <button id="show-key" type="button">Enseñar mi clave para crear la bóveda</button>
    <button class="sec" id="show-seedqr" type="button">Enseñar mi SeedQR para copiarlo a mano</button>
    <div id="seedqr-wrap" hidden>
      <p class="warn">Esto ES tu frase en forma de QR. Cópialo con lápiz en una plantilla de papel (la de SeedSigner o la de abajo, del mismo tamaño), pintando las casillas negras. No le hagas foto: quien tenga el papel o la foto tiene tu llave. La passphrase NO va en el SeedQR.</p>
      <p class="muted" id="seedqr-size"></p>
      <div class="gridwrap" id="seedqr-grid"></div>
      <div class="row">
        <button class="sec" id="seedqr-zoom" type="button" style="margin:0">Ampliar</button>
        <button class="sec" id="seedqr-hide" type="button" style="margin:0">Ocultar</button>
      </div>
      <p class="muted">Para comprobar la copia: cierra la llave y, en «Mi frase», pulsa «Leer mi SeedQR con la cámara» y apunta al papel. Si sale la misma huella, la copia está bien.</p>
    </div>
    <div id="keyqr-wrap" class="center" hidden>
      <p class="muted">En el ordenador, al crear la bóveda, elige «Dispositivo (xpub)» y lee este QR con la cámara. Es tu clave PÚBLICA: no permite gastar nada. Comprueba que en el ordenador sale la huella <b id="fp2"></b>.</p>
      <div id="keyqr"></div>
      <p><code id="keyexpr"></code></p>
    </div>
    <button class="sec" id="close-key" type="button">Cerrar la llave (borra la frase de este móvil)</button>
  </div>
</section>

<section class="card" id="sec-vault" hidden>
  <h2>2 · Tu bóveda</h2>
  <div id="vault-none">
    <p class="muted">Para firmar, el firmador tiene que conocer la bóveda: así comprueba que lo que firma sale de ella y que el cambio vuelve a ella. En el ordenador, en la bóveda, pulsa «Copia de seguridad (QR + texto)» y lee ese QR.</p>
    <label class="row" style="gap:8px"><input type="checkbox" id="remember" checked style="width:auto"> Recordar la bóveda en este móvil (es información pública, no permite gastar)</label>
    <button id="scan-vault" type="button">Leer el QR de la bóveda</button>
  </div>
  <div id="vault-ok" hidden>
    <p id="vault-sum"></p>
    <button class="sec" id="vault-forget" type="button">Olvidar la bóveda en este móvil</button>
  </div>
  <div id="vaultcam"></div>
  <div id="vaultmsg"></div>
</section>

<section class="card" id="sec-sign" hidden>
  <h2>3 · Firmar un envío</h2>
  <p class="muted">En el ordenador, prepara el envío y pulsa «Enseñar el envío en QR». Léelo aquí: verás a dónde va el dinero antes de firmar.</p>
  <button id="scan-psbt" type="button">Leer el envío</button>
  <div id="signcam"></div>
  <div id="signmsg"></div>
  <div id="review" hidden>
    <div id="review-body"></div>
    <button id="sign-ok" type="button">Firmar este envío</button>
    <button class="sec" id="sign-cancel" type="button">No firmar</button>
  </div>
  <div id="signed" class="center" hidden>
    <p class="ok">Firmado. Ahora, en el ordenador, pulsa «Leer el envío firmado» y apunta la cámara a este QR.</p>
    <div id="signedqr"></div>
    <p class="muted" id="signed-n"></p>
    <button class="sec" id="signed-done" type="button">Ya lo ha leído</button>
  </div>
</section>

<section class="card" id="sec-evm" hidden>
  <h2>4 · Multifirma EVM</h2>
  <p class="muted">Tu misma frase da también una llave para las multifirmas de Ethereum, Arbitrum y Base (la cuenta 1 de MetaMask, ruta m/44'/60'/0'/0/0).</p>
  <button class="sec" id="show-evm" type="button">Enseñar mi dirección EVM para añadirla a una multifirma</button>
  <div id="evmqr-wrap" class="center" hidden>
    <p class="muted">En el ordenador, al crear la multifirma, añade una llave «de fuera» y lee este QR. Es una dirección PÚBLICA: no permite gastar nada.</p>
    <div id="evmqr"></div>
    <p><code id="evmaddr"></code></p>
  </div>
  <h3>Tus multifirmas en este móvil</h3>
  <div id="safes-list"></div>
  <p class="muted">Para firmar, el móvil tiene que conocer la multifirma: comprueba que su dirección sale de sus llaves y que la tuya es una de ellas. En el ordenador, en la multifirma, pulsa «Registrarla en el firmador sin conexión».</p>
  <button class="sec" id="scan-safe" type="button">Registrar una multifirma</button>
  <div id="safecam"></div>
  <div id="safemsg"></div>
  <h3>Firmar una operación</h3>
  <p class="muted">En el ordenador, en la operación pendiente, pulsa «Firmar con el firmador sin conexión» y lee aquí el QR.</p>
  <button id="scan-safetx" type="button">Leer la operación</button>
  <div id="safetxcam"></div>
  <div id="safetxmsg"></div>
  <div id="safetx-review" hidden>
    <div id="safetx-body"></div>
    <button id="safetx-ok" type="button">Firmar esta operación</button>
    <button class="sec" id="safetx-cancel" type="button">No firmar</button>
  </div>
  <div id="safetx-signed" class="center" hidden>
    <p class="ok">Firmada. Ahora, en el ordenador, pulsa «Leer la firma con la cámara» y apunta a este QR.</p>
    <div id="safesigqr"></div>
    <p><code id="safesig"></code></p>
    <button class="sec" id="safetx-done" type="button">Ya la ha leído</button>
  </div>
</section>

<section class="card" id="sec-single" hidden>
  <h2>5 · Billetera de firma única (Bitcoin)</h2>
  <p class="muted">Tu misma frase da también una cuenta Bitcoin normal (direcciones bc1q…, ruta m/84'/0'/0'), en la que este móvil es la ÚNICA llave. El monedero la sigue sin poder gastarla; para mover el dinero hace falta firmar aquí. Quien tenga tu frase tiene ese dinero: guárdala como lo más valioso que tienes.</p>
  <button class="sec" id="show-single" type="button">Enseñar mi cuenta para añadirla al monedero</button>
  <div id="singleqr-wrap" class="center" hidden>
    <p class="muted">En el monedero, en «Monederos de hardware» › añadir a mano, pulsa «Leer con la cámara» y apunta a este QR. Es PÚBLICO: deja ver el saldo, no gastarlo. Al añadirla, el monedero dice su huella y su primera dirección: tienen que ser <b id="singlefp"></b> y</p>
    <p><code id="singlefirst"></code></p>
    <div id="singleqr"></div>
    <p><code id="singledesc"></code></p>
  </div>
  <h3>Firmar un envío</h3>
  <p class="muted">En el monedero, en esa cuenta, pulsa «Enviar», prepara el envío y pulsa el icono del QR. Léelo aquí: verás a dónde va el dinero antes de firmar.</p>
  <button id="scan-single" type="button">Leer el envío</button>
  <div id="singlecam"></div>
  <div id="singlemsg"></div>
  <div id="single-review" hidden>
    <div id="single-body"></div>
    <button id="single-ok" type="button">Firmar este envío</button>
    <button class="sec" id="single-cancel" type="button">No firmar</button>
  </div>
  <div id="single-signed" class="center" hidden>
    <p class="ok">Firmado. Ahora, en el monedero, pulsa «Escanear QR firmado» y apunta la cámara a este QR.</p>
    <div id="singlesignedqr"></div>
    <p class="muted" id="singlesigned-n"></p>
    <button class="sec" id="single-done" type="button">Ya lo ha leído</button>
  </div>
</section>

<section class="card" id="plantilla-card">
  <h2>Plantilla en blanco para el SeedQR</h2>
  <p class="muted">Ábrela en un ordenador e imprímela: cuadrículas de 25×25 (12 palabras) y 29×29 (24 palabras) con sus coordenadas. Sirven también las plantillas de SeedSigner.</p>
  <button class="sec" id="plantilla-show" type="button">Ver la plantilla</button>
  <div id="plantilla" hidden>
    <button id="plantilla-print" type="button">Imprimir</button>
    <div class="print-page"><p class="tpl-title">SeedQR · 12 palabras · 25×25</p><div class="gridwrap" id="tpl-25"></div></div>
    <div class="print-page"><p class="tpl-title">SeedQR · 24 palabras · 29×29</p><div class="gridwrap" id="tpl-29"></div></div>
  </div>
</section>

<p class="muted">MuchoSigner, el firmador sin conexión de Mucho Wallet. Bóvedas multifirma P2WSH (ruta 48'/0'/0'/2'), multifirmas EVM (m/44'/60'/0'/0/0) y cuentas Bitcoin de firma única P2WPKH (m/84'/0'/0'). El código va entero dentro de este fichero.</p>
</main>
<script>${js}</script>
</body>
</html>
`;

mkdirSync(resolve(root, "client/public"), { recursive: true });
const hash = createHash("sha256").update(html).digest("hex");
// Junto al fichero, su huella para
// `/wallet/comprobar-muchosigner` (formato SHA256SUMS). Es la huella que
// publica ESTE servidor: detecta una descarga dañada, no un servidor
// manipulado; para eso está la publicada fuera (workflow «MuchoSigner:
// huella» y el repo público). Escribirla no toca el HTML.
writeFileSync(resolve(root, "client/public/muchosigner.html"), html);
writeFileSync(resolve(root, "client/public/muchosigner.html.sha256"), `${hash}  muchosigner.html\n`);
// Para la publicación del repo público (`scripts/publish-muchosigner.ts`): qué
// fuentes y dependencias entran en el paquete.
if (process.env.MUCHOSIGNER_METAFILE) writeFileSync(process.env.MUCHOSIGNER_METAFILE, JSON.stringify(result.metafile));
console.log(`muchosigner.html: ${(html.length / 1024).toFixed(0)} KiB · sha256 ${hash}`);
