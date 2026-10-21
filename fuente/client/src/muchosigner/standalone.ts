/**
 * muchosigner.html — un móvil viejo en modo avión como llave de la bóveda
 * multifirma, de una multifirma EVM o de cuentas Bitcoin de firma única
 * (nativa, Taproot, anidada; Legacy solo para vigilarla)
 * (`docs/MUCHOSIGNER.md`). Un único fichero, generado en
 * `pnpm build` por `scripts/build-muchosigner.ts`, con el MISMO código de la
 * bóveda que usa el monedero (`lib/web3/btcMultisig.ts`) y las mismas piezas de
 * QR (`psbtUr.ts`, `descriptorUr.ts`).
 *
 * Todo pasa en esta pestaña y con la cámara: entra el QR de la bóveda y el del
 * envío, sale el QR de la clave pública y el del envío firmado. No hay ni una
 * petición de red. La frase NO se guarda: vive en memoria hasta que se cierra
 * la llave o la pestaña. Lo único que se puede recordar es el descriptor de la
 * bóveda (público). Sin React salvo para pintar el QR: tiene que poder abrirse
 * dentro de diez años.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QRCodeSVG } from "qrcode.react";
import jsQR from "jsqr";
import { deriveAddress } from "@/lib/web3/btcMultisig";
import { PSBT_QR_FRAME_MS, PsbtQrCollector, psbtUrAnimation } from "@/lib/web3/btc/psbtUr";
import { urToDescriptor } from "@/lib/web3/btc/descriptorUr";
import { base64 } from "@scure/base";
import {
  COIN_FLIPS,
  DICE_ROLLS,
  checkPositions,
  checkVault,
  deriveSigner,
  formatBtc,
  mnemonicFromCoins,
  mnemonicFromDice,
  mnemonicFromRandom,
  normalizeCoins,
  normalizeDice,
  parseMnemonic,
  reviewPsbt,
  signPsbt,
  type PsbtReview,
  type Signer,
  type VaultCheck,
  type WordCount,
} from "./core";
import { columnLabel, mnemonicFromSeedQr, seedQrMatrix } from "./seedQr";
import { OfflineQrCollector, type OfflinePayload, type OfflineSafeTx } from "@/lib/web3/safeMultisig/offlineQr";
import {
  checkSafeReg,
  deriveEvmKey,
  parseStoredSafes,
  reviewSafeTx,
  signSafeTx,
  upsertSafe,
  type EvmKey,
  type RegisteredSafe,
  type SafeTxReview,
} from "./evm";
import {
  LEGACY_SIGN_REASON,
  SINGLE_MAX_ACCOUNT_INDEX,
  SINGLE_TYPES,
  accountLabel,
  deriveSingleSig,
  reviewSinglePsbt,
  signSinglePsbt,
  singleAccount,
  typeOf,
  type SingleOwn,
  type SinglePsbtReview,
  type SinglePurpose,
  type SingleSig,
} from "./single";
import {
  absorbCarry,
  acceptTyped,
  acceptWord,
  editAt,
  evaluateTyped,
  isComplete,
  newEntry,
  phraseOf,
  removeAt,
  setCount,
  suggestions,
  typedProblem,
  type PhraseEntry,
} from "./phraseEntry";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const show = (id: string, on = true) => ($(id).hidden = !on);

function say(id: string, text: string, kind: "ok" | "bad" | "info" = "info") {
  $(id).innerHTML = text ? `<p class="${kind}">${esc(text)}</p>` : "";
}

const VAULT_KEY = "muchosigner:vault";
/** Multifirmas EVM registradas: públicas (dirección, llaves, quórum, salt). */
const SAFES_KEY = "muchosigner:safes";
const state: {
  signer?: Signer;
  /** La llave EVM de la misma frase (multifirmas de Ethereum, Arbitrum, Base). */
  evm?: EvmKey;
  pendingTx?: { tx: OfflineSafeTx; review: SafeTxReview };
  /** La cuenta de firma única (BIP-84) de la misma frase. */
  single?: SingleSig;
  /** Tipo y cuenta elegidos en «Bitcoin de firma única» (lo que se enseña). */
  singlePurpose: SinglePurpose;
  singleAccountIndex: number;
  pendingSingle?: { psbt: Uint8Array; review: SinglePsbtReview };
  /** La frase que se está metiendo palabra a palabra (memoria; se vacía al abrir o cerrar). */
  entry: PhraseEntry;
  /** Lo que queda de la última palabra que se completó sola (ver `absorbCarry`). */
  carry: string;
  /** La frase de la llave abierta, para pintar su SeedQR. Muere con ella. */
  mnemonic?: string;
  /** Cuántas palabras se crean con dados, monedas o el azar del móvil. */
  words: WordCount;
  vault?: VaultCheck;
  descriptor?: string;
  pending?: { psbt: Uint8Array; review: PsbtReview };
  draft?: string; // frase recién creada, hasta que se comprueba
  checks?: number[];
} = { words: 24, singlePurpose: 84, singleAccountIndex: 0, entry: newEntry(12), carry: "" };

// ─── QR en pantalla ──────────────────────────────────────────────────────────

const qrRoots = new Map<string, { root: Root; timer: number }>();

function paintQr(boxId: string, values: () => string, animated: boolean) {
  stopQr(boxId);
  const box = $(boxId);
  box.innerHTML = '<div class="qr"></div>';
  const root = createRoot(box.firstElementChild as HTMLElement);
  const render = () => root.render(createElement(QRCodeSVG, { value: values(), size: 300, marginSize: 2, bgColor: "#ffffff", fgColor: "#000000" }));
  render();
  const timer = animated ? window.setInterval(render, PSBT_QR_FRAME_MS) : 0;
  qrRoots.set(boxId, { root, timer });
}

function stopQr(boxId: string) {
  const cur = qrRoots.get(boxId);
  if (!cur) return;
  clearInterval(cur.timer);
  cur.root.unmount();
  qrRoots.delete(boxId);
  $(boxId).innerHTML = "";
}

// ─── Cámara ──────────────────────────────────────────────────────────────────

let camStop: (() => void) | null = null;

/**
 * Abre la cámara en `boxId` y entrega cada texto NUEVO que lee. `onText`
 * devuelve true cuando ya tiene lo que necesita (y la cámara se cierra).
 */
async function openCamera(boxId: string, onText: (text: string, bytes: number[]) => boolean) {
  closeCamera();
  const box = $(boxId);
  box.innerHTML = '<video playsinline muted></video><p class="muted cam-status">Abriendo la cámara…</p><button class="sec" type="button">Cerrar la cámara</button>';
  const video = box.querySelector("video")!;
  const status = box.querySelector(".cam-status") as HTMLElement;
  (box.querySelector("button") as HTMLButtonElement).onclick = closeCamera;
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Este navegador no deja usar la cámara aquí. En los Xiaomi funciona con el navegador Mi; en otros móviles prueba con Firefox.";
    return;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    status.textContent =
      name === "NotAllowedError"
        ? "El navegador no ha dejado usar la cámara. Revisa el permiso de cámara del navegador en los ajustes del móvil, o prueba con otro (en los Xiaomi, el navegador Mi; si no, Firefox)."
        : `No se pudo abrir la cámara: ${errText(e)}.`;
    return;
  }
  video.srcObject = stream;
  await video.play().catch(e => console.warn("[muchosigner] play:", errText(e)));
  status.textContent = "Apunta al QR y mantén el móvil quieto.";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  let last = "";
  let timer = 0;
  let stopped = false;
  camStop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach(t => t.stop());
    box.innerHTML = "";
    camStop = null;
  };
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const scale = Math.min(1, 720 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
      const key = code ? code.data || code.binaryData.join(",") : "";
      if (code && key && key !== last) {
        last = key;
        if (onText(code.data, code.binaryData)) {
          closeCamera();
          return;
        }
      }
    }
    timer = window.setTimeout(tick, 120);
  };
  tick();
}

function closeCamera() {
  camStop?.();
}

// ─── 1 · Tu llave ────────────────────────────────────────────────────────────

type Tab = "frase" | "dados" | "monedas" | "azar";
const TABS: Tab[] = ["frase", "dados", "monedas", "azar"];

function setTab(tab: Tab) {
  for (const t of TABS) {
    show(`tab-${t}`, t === tab);
    $(`btn-tab-${t}`).classList.toggle("on", t === tab);
  }
  show("wc-row", tab !== "frase");
  if (tab !== "frase") closeCamera();
  say("keymsg", "");
}

/** 12 o 24 palabras: cambia lo que se pide y lo que dicen los botones. */
function setWords(words: WordCount) {
  state.words = words;
  $("wc-12").classList.toggle("on", words === 12);
  $("wc-24").classList.toggle("on", words === 24);
  $("dice-need").textContent = String(DICE_ROLLS[words]);
  $("coins-need").textContent = String(COIN_FLIPS[words]);
  for (const id of ["from-dice", "from-coins"]) $(id).textContent = `Calcular mis ${words} palabras`;
  $("from-random").textContent = `Generar mis ${words} palabras`;
  // Una frase a medio apuntar de la otra longitud ya no es la que se ha pedido.
  if (state.draft && state.draft.split(" ").length !== words) {
    state.draft = undefined;
    show("draft", false);
  }
  updateDiceCount();
  updateCoinsCount();
}

function updateDiceCount() {
  const el = $("dice-count");
  try {
    const n = normalizeDice($<HTMLTextAreaElement>("dice").value).length;
    const need = DICE_ROLLS[state.words];
    el.textContent = `${n} de ${need} tiradas`;
    el.className = n >= need ? "ok-t" : "muted";
  } catch (e) {
    el.textContent = errText(e);
    el.className = "bad-t";
  }
}

function updateCoinsCount() {
  const el = $("coins-count");
  try {
    const n = normalizeCoins($<HTMLTextAreaElement>("coins").value).length;
    const need = COIN_FLIPS[state.words];
    el.textContent = n > need ? `${n} lanzamientos: sobran ${n - need}` : `${n} de ${need} lanzamientos`;
    el.className = n === need ? "ok-t" : n > need ? "bad-t" : "muted";
  } catch (e) {
    el.textContent = errText(e);
    el.className = "bad-t";
  }
}

function addCoin(bit: "0" | "1" | "del") {
  const ta = $<HTMLTextAreaElement>("coins");
  const bits = ta.value.replace(/[^01]/g, "");
  const next = bit === "del" ? bits.slice(0, -1) : bits + bit;
  // De 8 en 8, para que se lea y se cuente mejor al apuntar.
  ta.value = next.replace(/(.{8})/g, "$1 ").trim();
  updateCoinsCount();
}

// ─── La frase palabra a palabra ──────────────────────────────────────────────

function peCount(count: WordCount) {
  state.entry = setCount(state.entry, count);
  renderEntry();
}

function peSet(next: PhraseEntry, note = "") {
  state.entry = next;
  renderEntry(note);
}

/** Pone una palabra y deja la casilla lista para la siguiente. */
function peAccept(word: string, carry = "") {
  const at = state.entry.cursor;
  state.carry = carry;
  $<HTMLInputElement>("pe-input").value = "";
  peSet(acceptWord(state.entry, word), `Palabra ${at + 1}: ${word}`);
}

function peInput() {
  const input = $<HTMLInputElement>("pe-input");
  const { carry, rest } = absorbCarry(state.carry, input.value);
  state.carry = carry;
  if (rest !== input.value) input.value = rest;
  // Un espacio (o varias palabras pegadas) cierra lo escrito.
  if (/\s/.test(rest)) {
    const [first, ...more] = rest.split(/\s+/);
    const w = first ? acceptTyped(first) : null;
    if (first && !w) {
      input.value = first;
      renderSuggestions();
      say("pe-msg", typedProblem(first) ?? "", "bad");
      return;
    }
    if (w) peAccept(w);
    input.value = more.join(" ");
    if (input.value) peInput();
    else renderSuggestions();
    return;
  }
  const v = evaluateTyped(rest);
  if (v.status === "unique") {
    peAccept(v.word, v.word.slice(rest.length));
    return;
  }
  renderSuggestions();
  say("pe-msg", v.status === "unknown" ? typedProblem(rest) ?? "" : "", v.status === "unknown" ? "bad" : "info");
}

function peSubmit(ev: Event) {
  ev.preventDefault();
  const input = $<HTMLInputElement>("pe-input");
  const w = acceptTyped(input.value);
  if (w) peAccept(w);
  else say("pe-msg", input.value.trim() ? typedProblem(input.value) ?? "" : "Escribe la palabra.", "bad");
}

function renderSuggestions() {
  const box = $("pe-sugs");
  const list = state.entry.cursor < state.entry.count ? suggestions($<HTMLInputElement>("pe-input").value) : [];
  box.innerHTML = list.map(w => `<button type="button" data-w="${esc(w)}">${esc(w)}</button>`).join("");
  box.querySelectorAll<HTMLButtonElement>("button").forEach(b => {
    // Sin quitarle el foco a la casilla: el teclado se queda abierto.
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => {
      peAccept(b.dataset.w!);
      $("pe-input").focus();
    };
  });
}

function renderEntry(note = "") {
  const e = state.entry;
  $("pe-12").classList.toggle("on", e.count === 12);
  $("pe-24").classList.toggle("on", e.count === 24);
  const lastFilled = e.words.reduce((m, w, i) => (w ? i : m), -1);
  const upto = Math.min(e.count - 1, Math.max(lastFilled, e.cursor));
  const items: string[] = [];
  for (let i = 0; i <= upto; i++) {
    const w = e.words[i];
    const cls = [i === e.cursor ? "cur" : "", w ? "" : "hole"].filter(Boolean).join(" ");
    items.push(`<li><button type="button" data-i="${i}"${cls ? ` class="${cls}"` : ""}><span>${i + 1}.</span>${w ? esc(w) : "…"}</button></li>`);
  }
  $("pe-list").innerHTML = items.join("");
  $("pe-list")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach(b => {
      b.onclick = () => {
        state.carry = "";
        $<HTMLInputElement>("pe-input").value = "";
        peSet(editAt(state.entry, Number(b.dataset.i)));
        $("pe-input").focus();
      };
    });
  const writing = e.cursor < e.count;
  show("pe-form", writing);
  const current = writing ? e.words[e.cursor] : null;
  $("pe-label").textContent = writing
    ? `Palabra ${e.cursor + 1} de ${e.count}${current ? ` (ahora «${current}»: escribe la buena o bórrala)` : ""}`
    : "";
  show("pe-del", !!current);
  $("pe-del").textContent = `Borrar la palabra ${e.cursor + 1}`;
  renderSuggestions();
  const done = isComplete(e);
  $<HTMLButtonElement>("open").disabled = !done;
  if (done) {
    try {
      phraseOf(e);
      say("pe-msg", `Las ${e.count} palabras cuadran (la suma de control es correcta). Si usas passphrase, escríbela abajo; después, pulsa «Abrir mi llave».`, "ok");
    } catch (err) {
      say("pe-msg", errText(err), "bad");
    }
  } else {
    say("pe-msg", note);
  }
}

/** Vacía todo lo tecleado de la frase (palabra a palabra y de una vez). */
function clearEntry() {
  state.entry = newEntry(state.entry.count);
  state.carry = "";
  $<HTMLInputElement>("pe-input").value = "";
  $<HTMLTextAreaElement>("words").value = "";
  renderEntry();
}

/** Lee un SeedQR (de SeedSigner o copiado a mano) y abre la llave con él. */
function scanSeedQr() {
  say("keymsg", "");
  void openCamera("seedcam", (text, bytes) => {
    let phrase: string | null;
    try {
      phrase = mnemonicFromSeedQr(text, bytes);
    } catch (e) {
      say("keymsg", errText(e), "bad");
      return false;
    }
    if (!phrase) {
      say("keymsg", "Ese QR no es un SeedQR. Apunta al QR de tu frase (el que copiaste a mano o el de SeedSigner).", "bad");
      return false;
    }
    openSigner(phrase);
    return true;
  });
}

/**
 * Una cuadrícula de casillas con coordenadas (A, B… arriba; 1, 2… al lado) y
 * una franja blanca entre ellas y el código: un QR necesita margen para que la
 * cámara lo encuentre, y en el papel copiado también.
 */
function gridHtml(size: number, on?: boolean[][]): string {
  const gapRow = `<tr><th class="gap"></th><th class="gap"></th>${Array.from({ length: size }, () => '<td class="gap"></td>').join("")}<td class="gap"></td></tr>`;
  const head = `<tr><th></th><th class="gap"></th>${Array.from({ length: size }, (_, x) => `<th>${columnLabel(x)}</th>`).join("")}<th class="gap"></th></tr>`;
  const rows = Array.from({ length: size }, (_, y) => {
    const cells = Array.from({ length: size }, (_, x) => {
      const cls = [on?.[y][x] ? "on" : "", x % 5 === 4 && x < size - 1 ? "r5" : ""].filter(Boolean).join(" ");
      return `<td${cls ? ` class="${cls}"` : ""}></td>`;
    }).join("");
    return `<tr${y % 5 === 4 && y < size - 1 ? ' class="b5"' : ""}><th>${y + 1}</th><td class="gap"></td>${cells}<td class="gap"></td></tr>`;
  }).join("");
  return `<table class="grid">${head}${gapRow}${rows}${gapRow}</table>`;
}

function showSeedQr() {
  if (!state.mnemonic) return;
  let m: boolean[][];
  try {
    m = seedQrMatrix(state.mnemonic);
  } catch (e) {
    say("keymsg", errText(e), "bad");
    return;
  }
  const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0);
  $("seedqr-size").textContent = `${m.length}×${m.length} casillas (${state.mnemonic.split(" ").length} palabras): pinta las ${dark} negras.`;
  $("seedqr-grid").innerHTML = gridHtml(m.length, m);
  show("seedqr-wrap");
}

function hideSeedQr() {
  $("seedqr-grid").innerHTML = "";
  show("seedqr-wrap", false);
}

function openSigner(mnemonic: string) {
  const passphrase = $<HTMLInputElement>("passphrase").value;
  state.signer = deriveSigner(mnemonic, passphrase);
  state.evm = deriveEvmKey(mnemonic, passphrase);
  state.single = deriveSingleSig(mnemonic, passphrase);
  state.mnemonic = mnemonic;
  state.draft = undefined;
  closeCamera();
  hideSeedQr();
  clearEntry();
  $<HTMLInputElement>("passphrase").value = "";
  show("key-new", false);
  show("key-open");
  $("fp").textContent = state.signer.fingerprint;
  $("fp2").textContent = state.signer.fingerprint;
  show("pp-note", passphrase.length > 0);
  stopQr("keyqr");
  show("keyqr-wrap", false);
  restoreVault();
  openEvm();
  show("sec-single");
  renderSingleChoice();
}

function showDraft(mnemonic: string) {
  say("keymsg", "");
  state.draft = mnemonic;
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  state.checks = checkPositions(rnd, 3, mnemonic.split(" ").length);
  $("draft-n").textContent = String(mnemonic.split(" ").length);
  $("draft-words").innerHTML = mnemonic
    .split(" ")
    .map((w, i) => `<li><span>${i + 1}</span>${esc(w)}</li>`)
    .join("");
  $("draft-checks").innerHTML = state.checks
    .map(p => `<label>Palabra ${p}: <input data-pos="${p}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>`)
    .join("");
  show("draft");
  say("draftmsg", "");
}

function confirmDraft() {
  if (!state.draft || !state.checks) return;
  const words = state.draft.split(" ");
  const wrong = state.checks.filter(p => {
    const v = ($("draft-checks").querySelector(`[data-pos="${p}"]`) as HTMLInputElement).value.trim().toLowerCase();
    return v.length < 4 || !words[p - 1].startsWith(v.slice(0, 4));
  });
  if (wrong.length) {
    say("draftmsg", `No coincide la palabra ${wrong.join(", ")}. Revisa lo que has apuntado: es tu única copia.`, "bad");
    return;
  }
  show("draft", false);
  openSigner(state.draft);
}

function closeSigner() {
  state.signer = undefined;
  state.mnemonic = undefined;
  hideSeedQr();
  state.vault = undefined;
  state.pending = undefined;
  state.evm = undefined;
  state.pendingTx = undefined;
  state.single = undefined;
  state.pendingSingle = undefined;
  clearEntry();
  closeCamera();
  stopQr("keyqr");
  stopQr("signedqr");
  stopQr("evmqr");
  stopQr("safesigqr");
  stopQr("singleqr");
  stopQr("singlesignedqr");
  show("singleqr-wrap", false);
  show("single-review", false);
  show("single-signed", false);
  show("sec-single", false);
  show("evmqr-wrap", false);
  show("safetx-review", false);
  show("safetx-signed", false);
  show("sec-evm", false);
  show("key-open", false);
  show("key-new");
  show("sec-vault", false);
  show("sec-sign", false);
  say("keymsg", "Llave cerrada: la frase ya no está en este móvil.", "ok");
}

// ─── 2 · Tu bóveda ───────────────────────────────────────────────────────────

function readStoredVault(): string | null {
  try {
    return localStorage.getItem(VAULT_KEY);
  } catch {
    return null;
  }
}

function restoreVault() {
  show("sec-vault");
  const saved = readStoredVault();
  if (saved && state.signer) {
    try {
      setVault(saved, false);
      return;
    } catch (e) {
      say("vaultmsg", `La bóveda guardada no es de esta llave: ${errText(e)}`, "bad");
    }
  }
  renderVault();
}

function setVault(descriptor: string, remember: boolean) {
  if (!state.signer) throw new Error("Abre antes tu llave.");
  state.vault = checkVault(descriptor, state.signer);
  state.descriptor = descriptor;
  if (remember) {
    try {
      localStorage.setItem(VAULT_KEY, descriptor);
    } catch (e) {
      console.warn("[muchosigner] no se pudo recordar la bóveda:", errText(e));
    }
  }
  renderVault();
}

function renderVault() {
  const v = state.vault;
  show("vault-none", !v);
  show("vault-ok", !!v);
  show("sec-sign", !!v);
  if (!v) return;
  const first = deriveAddress(v.desc, 0, 0).address;
  $("vault-sum").innerHTML =
    `Bóveda <b>${v.desc.threshold} de ${v.desc.keys.length}</b>: hacen falta ${v.desc.threshold} firmas para mover el dinero y esta llave es una de ellas.` +
    `<br><span class="muted">Primera dirección de recepción, para comprobar que es la misma que ves en el ordenador:</span><br><code>${esc(first)}</code>`;
  show("vault-forget", !!readStoredVault());
}

function scanVault() {
  say("vaultmsg", "");
  const parts = new Set<string>();
  void openCamera("vaultcam", text => {
    const t = text.trim().toLowerCase();
    if (!/^ur:crypto-output\//.test(t)) {
      say("vaultmsg", "Ese QR no es la copia de una bóveda. En el ordenador, en la bóveda, pulsa «Copia de seguridad (QR + texto)» y lee ese QR.", "bad");
      return false;
    }
    parts.add(t);
    let descriptor: string;
    try {
      descriptor = urToDescriptor([...parts]);
    } catch (e) {
      if (/incompleto/i.test(errText(e))) {
        say("vaultmsg", `Leído ${parts.size} QR de la copia; sigue con el siguiente.`);
        return false;
      }
      say("vaultmsg", errText(e), "bad");
      return true;
    }
    try {
      setVault(descriptor, $<HTMLInputElement>("remember").checked);
      say("vaultmsg", "Bóveda registrada.", "ok");
    } catch (e) {
      say("vaultmsg", errText(e), "bad");
    }
    return true;
  });
}

function forgetVault() {
  try {
    localStorage.removeItem(VAULT_KEY);
  } catch (e) {
    console.warn("[muchosigner] no se pudo borrar la bóveda:", errText(e));
  }
  state.vault = undefined;
  state.descriptor = undefined;
  renderVault();
  say("vaultmsg", "Este móvil ya no recuerda la bóveda.", "ok");
}

// ─── 3 · Firmar un envío ─────────────────────────────────────────────────────

function scanPsbt() {
  say("signmsg", "");
  show("review", false);
  stopQr("signedqr");
  show("signed", false);
  const collector = new PsbtQrCollector();
  void openCamera("signcam", text => {
    const st = collector.receive(text);
    if (st.status === "partial") {
      say("signmsg", `Leyendo el envío… ${Math.round(st.progress * 100)} %. Mantén el móvil quieto.`);
      return false;
    }
    if (st.status === "error") {
      say("signmsg", st.message, "bad");
      return false;
    }
    if (st.status !== "done") return false;
    try {
      const review = reviewPsbt(st.psbt, state.vault!, state.signer!);
      state.pending = { psbt: st.psbt, review };
      renderReview(review);
      say("signmsg", "");
    } catch (e) {
      say("signmsg", errText(e), "bad");
    }
    return true;
  });
}

function renderReview(r: PsbtReview) {
  const outs = r.outputs
    .map(o =>
      o.own
        ? `<li class="own"><b>${esc(formatBtc(o.sats))}</b> vuelve a tu bóveda <span class="muted">(${o.own.branch === 1 ? "cambio" : "recepción"} n.º ${o.own.index}, comprobado)</span><br><code>${esc(o.address)}</code></li>`
        : `<li class="out"><b>${esc(formatBtc(o.sats))}</b> sale a<br><code>${esc(o.address)}</code></li>`
    )
    .join("");
  const after = r.alreadySignedByUs ? r.signaturesBefore : r.signaturesBefore + 1;
  $("review-body").innerHTML =
    `<p>Sale de la bóveda: <b>${esc(formatBtc(r.sendingSats))}</b> · comisión de la red: <b>${esc(formatBtc(r.feeSats))}</b></p>` +
    `<ul class="outs">${outs}</ul>` +
    `<p class="muted">${r.inputs.length} ${r.inputs.length === 1 ? "moneda" : "monedas"} de la bóveda. Firmas: ${r.signaturesBefore} antes, ${after} de ${r.threshold} después de la tuya.</p>` +
    (r.alreadySignedByUs ? '<p class="warn">Este envío ya lleva la firma de esta llave: firmarlo otra vez no añade nada.</p>' : "") +
    (r.feeSats * 10n > r.sendingSats && r.sendingSats > 0n
      ? '<p class="warn">La comisión es más del 10 % de lo que envías. Compruébalo antes de firmar.</p>'
      : "");
  show("review");
}

function confirmSign() {
  const p = state.pending;
  if (!p || !state.vault || !state.signer) return;
  let signed: Uint8Array;
  try {
    signed = signPsbt(p.psbt, state.vault, state.signer);
  } catch (e) {
    say("signmsg", errText(e), "bad");
    return;
  }
  state.pending = undefined;
  show("review", false);
  const anim = psbtUrAnimation(base64.encode(signed));
  paintQr("signedqr", anim.nextPart, anim.fragments > 1);
  $("signed-n").textContent = anim.fragments > 1 ? `QR animado de ${anim.fragments} partes.` : "";
  show("signed");
}

function cancelSign() {
  state.pending = undefined;
  show("review", false);
  say("signmsg", "Envío descartado: no se ha firmado nada.");
}

// ─── 4 · Multifirma EVM ──────────────────────────────────────────────────────

function readSafes(): RegisteredSafe[] {
  try {
    return parseStoredSafes(localStorage.getItem(SAFES_KEY));
  } catch {
    return [];
  }
}

function writeSafes(list: RegisteredSafe[]) {
  try {
    localStorage.setItem(SAFES_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn("[muchosigner] no se pudo recordar la multifirma:", errText(e));
    say("safemsg", "Este navegador no deja guardar la multifirma: tendrás que registrarla cada vez.", "bad");
  }
}

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

function openEvm() {
  show("sec-evm");
  renderSafes();
}

function renderSafes() {
  const list = readSafes();
  const mine = (s: RegisteredSafe) => !!state.evm && s.owners.some(o => o.toLowerCase() === state.evm!.address.toLowerCase());
  $("safes-list").innerHTML = list.length
    ? `<ul class="safes">${list
        .map(
          (s, i) =>
            `<li><b>${esc(s.name || "Multifirma")}</b> · ${s.threshold} de ${s.owners.length}<br><code>${esc(s.safe)}</code>` +
            (mine(s) ? "" : '<br><span class="bad-t">La llave abierta no es una de las suyas.</span>') +
            `<br><button class="sec" type="button" data-forget="${i}" style="margin:6px 0 0">Olvidarla en este móvil</button></li>`,
        )
        .join("")}</ul>`
    : '<p class="muted">Ninguna todavía.</p>';
  $("safes-list")
    .querySelectorAll<HTMLButtonElement>("[data-forget]")
    .forEach(b => {
      b.onclick = () => {
        const all = readSafes();
        all.splice(Number(b.dataset.forget), 1);
        try {
          localStorage.removeItem(SAFES_KEY);
        } catch (e) {
          console.warn("[muchosigner] no se pudo borrar la multifirma:", errText(e));
        }
        if (all.length) writeSafes(all);
        renderSafes();
        say("safemsg", "Este móvil ya no recuerda esa multifirma.", "ok");
      };
    });
}

function showEvmAddress() {
  if (!state.evm) return;
  const addr = state.evm.address;
  paintQr("evmqr", () => addr, false);
  $("evmaddr").textContent = addr;
  show("evmqr-wrap");
}

/** Lee un QR del monedero (registro u operación) con su colector. */
function scanOffline(boxId: string, msgId: string, onDone: (payload: OfflinePayload) => void) {
  say(msgId, "");
  const col = new OfflineQrCollector();
  void openCamera(boxId, text => {
    const st = col.receive(text);
    if (st.status === "partial") {
      say(msgId, `Leyendo… ${Math.round(st.progress * 100)} %. Mantén el móvil quieto.`);
      return false;
    }
    if (st.status === "error") {
      say(msgId, st.message, "bad");
      return false;
    }
    if (st.status !== "done") return false;
    onDone(st.payload);
    return true;
  });
}

function scanSafe() {
  scanOffline("safecam", "safemsg", payload => {
    if (payload.t !== "mucho-safe") {
      say("safemsg", "Ese QR es una operación, no el registro de una multifirma. Léelo en «Firmar una operación».", "bad");
      return;
    }
    if (!state.evm) return;
    say("safemsg", "Comprobando la multifirma…");
    checkSafeReg(payload, state.evm)
      .then(saved => {
        writeSafes(upsertSafe(readSafes(), saved));
        renderSafes();
        say("safemsg", `Multifirma «${saved.name || short(saved.safe)}» registrada: su dirección sale de sus ${saved.owners.length} llaves y la tuya es una de ellas.`, "ok");
      })
      .catch(e => say("safemsg", errText(e), "bad"));
  });
}

function scanSafeTx() {
  show("safetx-review", false);
  stopQr("safesigqr");
  show("safetx-signed", false);
  scanOffline("safetxcam", "safetxmsg", payload => {
    if (payload.t !== "mucho-safetx") {
      say("safetxmsg", "Ese QR es el registro de una multifirma, no una operación. Léelo en «Registrar una multifirma».", "bad");
      return;
    }
    try {
      const review = reviewSafeTx(payload, readSafes(), state.evm!);
      state.pendingTx = { tx: payload, review };
      renderSafeTx(review);
      say("safetxmsg", "");
    } catch (e) {
      say("safetxmsg", errText(e), "bad");
    }
  });
}

function renderSafeTx(r: SafeTxReview) {
  const d = r.decoded;
  const lines = d.lines.map(l => `<dt>${esc(l.label)}</dt><dd>${l.mono ? `<code>${esc(l.value)}</code>` : esc(l.value)}</dd>`).join("");
  const flags = d.flags.map(f => `<p class="${f.level === "danger" ? "bad" : "warn"}">${esc(f.text)}</p>`).join("");
  $("safetx-body").innerHTML =
    `<p>Multifirma <b>${esc(r.safe.name || short(r.safe.safe))}</b> en <b>${esc(r.chainName)}</b> · turno ${esc(r.nonce)}</p>` +
    (r.selfAdmin
      ? `<p class="bad">Esta operación cambia la PROPIA multifirma: ${esc(r.selfAdmin)}. Así se le pueden cambiar las llaves o quitarte el control. Fírmala solo si la has preparado tú y sabes por qué.</p>`
      : "") +
    `<p><b>${esc(d.title)}</b>${d.target ? ` · ${esc(d.target)}` : ""}</p>` +
    `<dl class="tx">${lines}<dt>Llama a</dt><dd><code>${esc(r.to)}</code></dd></dl>` +
    flags +
    `<p class="muted">Hash de la operación (el mismo que ves en el ordenador):<br><code>${esc(r.hash)}</code></p>` +
    (d.recognized ? "" : `<details><summary class="muted">Datos técnicos</summary><code>${esc(r.data)}</code></details>`);
  show("safetx-review");
}

function confirmSafeTx() {
  const p = state.pendingTx;
  if (!p || !state.evm) return;
  const key = state.evm;
  signSafeTx(p.tx, key)
    .then(sig => {
      state.pendingTx = undefined;
      show("safetx-review", false);
      paintQr("safesigqr", () => sig, false);
      $("safesig").textContent = sig;
      show("safetx-signed");
    })
    .catch(e => say("safetxmsg", errText(e), "bad"));
}

// ─── 5 · Firma única (Bitcoin) ───────────────────────────────────────────────

function setSinglePurpose(purpose: SinglePurpose) {
  state.singlePurpose = purpose;
  renderSingleChoice();
}

function setSingleAccount(n: number) {
  const index = Math.min(SINGLE_MAX_ACCOUNT_INDEX, Math.max(0, Math.round(n) - 1));
  state.singleAccountIndex = Number.isFinite(index) ? index : 0;
  renderSingleChoice();
}

/** Tipo y cuenta elegidos: la ruta, el aviso de Legacy y el QR si está a la vista. */
function renderSingleChoice() {
  const { singlePurpose: purpose, singleAccountIndex: index } = state;
  for (const t of SINGLE_TYPES) $(`st-${t.purpose}`).classList.toggle("on", t.purpose === purpose);
  $<HTMLInputElement>("single-acct").value = String(index + 1);
  $("single-path").textContent =
    `${accountLabel(purpose, index)}: ruta m/${purpose}'/0'/${index}' (direcciones ${typeOf(purpose).prefix}).` +
    (index === 0
      ? " La cuenta 1 es la de casi todos los monederos."
      : " Apunta el número de cuenta junto a tu frase: para recuperarla en otro monedero hace falta saberlo.");
  show("single-legacy", !typeOf(purpose).signs);
  $("single-legacy").textContent = LEGACY_SIGN_REASON;
  if (!$("singleqr-wrap").hidden) showSingleAccount();
}

function showSingleAccount() {
  const sg = state.single;
  if (!sg) return;
  const acc = singleAccount(sg, state.singlePurpose, state.singleAccountIndex);
  paintQr("singleqr", () => acc.descriptor, false);
  $("singledesc").textContent = acc.descriptor;
  $("singlefirst").textContent = acc.firstAddress;
  $("singlefp").textContent = sg.fingerprint;
  show("singleqr-wrap");
}

const ownText = (o: SingleOwn) =>
  `${accountLabel(o.purpose, o.accountIndex)}, ${o.branch === 1 ? "cambio" : "recepción"} n.º ${o.index}, comprobado`;

function scanSinglePsbt() {
  say("singlemsg", "");
  show("single-review", false);
  stopQr("singlesignedqr");
  show("single-signed", false);
  const collector = new PsbtQrCollector();
  void openCamera("singlecam", text => {
    const st = collector.receive(text);
    if (st.status === "partial") {
      say("singlemsg", `Leyendo el envío… ${Math.round(st.progress * 100)} %. Mantén el móvil quieto.`);
      return false;
    }
    if (st.status === "error") {
      say("singlemsg", st.message, "bad");
      return false;
    }
    if (st.status !== "done") return false;
    try {
      const review = reviewSinglePsbt(st.psbt, state.single!);
      state.pendingSingle = { psbt: st.psbt, review };
      renderSingleReview(review);
      say("singlemsg", "");
    } catch (e) {
      say("singlemsg", errText(e), "bad");
    }
    return true;
  });
}

function renderSingleReview(r: SinglePsbtReview) {
  const outs = r.outputs
    .map(o =>
      o.own
        ? `<li class="own"><b>${esc(formatBtc(o.sats))}</b> vuelve a tu cuenta <span class="muted">(${esc(ownText(o.own))})</span><br><code>${esc(o.address)}</code></li>`
        : `<li class="out"><b>${esc(formatBtc(o.sats))}</b> sale a<br><code>${esc(o.address)}</code></li>`
    )
    .join("");
  const from = r.accounts.map(a => accountLabel(a.purpose, a.accountIndex)).join(", ");
  $("single-body").innerHTML =
    `<p>Sale de tu cuenta: <b>${esc(formatBtc(r.sendingSats))}</b> · comisión de la red: <b>${esc(formatBtc(r.feeSats))}</b></p>` +
    `<ul class="outs">${outs}</ul>` +
    `<p class="muted">${r.inputs.length} ${r.inputs.length === 1 ? "moneda" : "monedas"} de: ${esc(from)}.</p>` +
    (r.accounts.length > 1
      ? `<p class="warn">Este envío junta monedas de ${r.accounts.length} cuentas o tipos de dirección distintos de tu frase. Todas son tuyas, pero en la cadena quedarán unidas: cualquiera verá que son del mismo dueño.</p>`
      : "") +
    (r.alreadySigned ? '<p class="warn">Este envío ya está firmado por esta llave: firmarlo otra vez no añade nada.</p>' : "") +
    (r.feeSats * 10n > r.sendingSats && r.sendingSats > 0n
      ? '<p class="warn">La comisión es más del 10 % de lo que envías. Compruébalo antes de firmar.</p>'
      : "");
  show("single-review");
}

function confirmSingleSign() {
  const p = state.pendingSingle;
  if (!p || !state.single) return;
  let signed: Uint8Array;
  try {
    signed = signSinglePsbt(p.psbt, state.single);
  } catch (e) {
    say("singlemsg", errText(e), "bad");
    return;
  }
  state.pendingSingle = undefined;
  show("single-review", false);
  const anim = psbtUrAnimation(base64.encode(signed));
  paintQr("singlesignedqr", anim.nextPart, anim.fragments > 1);
  $("singlesigned-n").textContent = anim.fragments > 1 ? `QR animado de ${anim.fragments} partes.` : "";
  show("single-signed");
}

// ─── Arranque ────────────────────────────────────────────────────────────────

function connectionNotice() {
  show("online-warn", navigator.onLine);
}

function init() {
  connectionNotice();
  window.addEventListener("online", connectionNotice);
  window.addEventListener("offline", connectionNotice);

  for (const t of TABS) $(`btn-tab-${t}`).onclick = () => setTab(t);
  $("wc-12").onclick = () => setWords(12);
  $("wc-24").onclick = () => setWords(24);
  setTab("frase");
  setWords(24);

  $("pe-12").onclick = () => peCount(12);
  $("pe-24").onclick = () => peCount(24);
  $("pe-input").oninput = peInput;
  $("pe-form").onsubmit = peSubmit;
  $("pe-del").onclick = () => {
    state.carry = "";
    $<HTMLInputElement>("pe-input").value = "";
    const at = state.entry.cursor;
    peSet(removeAt(state.entry, at), `Palabra ${at + 1} borrada: escribe la buena.`);
    $("pe-input").focus();
  };
  renderEntry();
  $("open").onclick = () => {
    try {
      openSigner(phraseOf(state.entry));
      say("keymsg", "");
    } catch (e) {
      say("pe-msg", errText(e), "bad");
    }
  };
  $("open-all").onclick = () => {
    try {
      openSigner(parseMnemonic($<HTMLTextAreaElement>("words").value));
      say("keymsg", "");
    } catch (e) {
      say("keymsg", errText(e), "bad");
    }
  };
  $("scan-seedqr").onclick = scanSeedQr;

  const dice = $<HTMLTextAreaElement>("dice");
  dice.oninput = updateDiceCount;
  $("from-dice").onclick = () => {
    try {
      showDraft(mnemonicFromDice(dice.value, state.words));
      dice.value = "";
      updateDiceCount();
    } catch (e) {
      say("keymsg", errText(e), "bad");
    }
  };
  const coins = $<HTMLTextAreaElement>("coins");
  coins.oninput = updateCoinsCount;
  $("coin-1").onclick = () => addCoin("1");
  $("coin-0").onclick = () => addCoin("0");
  $("coin-del").onclick = () => addCoin("del");
  $("from-coins").onclick = () => {
    try {
      showDraft(mnemonicFromCoins(coins.value, state.words));
      coins.value = "";
      updateCoinsCount();
    } catch (e) {
      say("keymsg", errText(e), "bad");
    }
  };
  $("from-random").onclick = () => {
    try {
      const r = new Uint8Array(state.words === 12 ? 16 : 32);
      crypto.getRandomValues(r);
      showDraft(mnemonicFromRandom(r));
    } catch (e) {
      say("keymsg", errText(e), "bad");
    }
  };
  $("draft-ok").onclick = confirmDraft;
  $("draft-cancel").onclick = () => {
    state.draft = undefined;
    show("draft", false);
  };
  $("pp-toggle").onclick = () => {
    const i = $<HTMLInputElement>("passphrase");
    i.type = i.type === "password" ? "text" : "password";
  };

  $("show-key").onclick = () => {
    if (!state.signer) return;
    const expr = state.signer.keyExpr;
    paintQr("keyqr", () => expr, false);
    $("keyexpr").textContent = expr;
    show("keyqr-wrap");
  };
  $("show-seedqr").onclick = showSeedQr;
  $("seedqr-hide").onclick = hideSeedQr;
  $("seedqr-zoom").onclick = () => {
    const t = $("seedqr-grid").querySelector("table");
    const big = t?.classList.toggle("big");
    $("seedqr-zoom").textContent = big ? "Reducir" : "Ampliar";
  };
  $("plantilla-show").onclick = () => {
    $("tpl-25").innerHTML = gridHtml(25);
    $("tpl-29").innerHTML = gridHtml(29);
    show("plantilla");
  };
  $("plantilla-print").onclick = () => window.print();
  $("close-key").onclick = closeSigner;
  $("scan-vault").onclick = scanVault;
  $("vault-forget").onclick = forgetVault;
  $("scan-psbt").onclick = scanPsbt;
  $("sign-ok").onclick = confirmSign;
  $("sign-cancel").onclick = cancelSign;
  $("show-evm").onclick = showEvmAddress;
  $("scan-safe").onclick = scanSafe;
  $("scan-safetx").onclick = scanSafeTx;
  $("safetx-ok").onclick = confirmSafeTx;
  $("safetx-cancel").onclick = () => {
    state.pendingTx = undefined;
    show("safetx-review", false);
    say("safetxmsg", "Operación descartada: no se ha firmado nada.");
  };
  $("safetx-done").onclick = () => {
    stopQr("safesigqr");
    show("safetx-signed", false);
    say("safetxmsg", "Listo. Puedes leer otra operación cuando quieras.", "ok");
  };
  for (const t of SINGLE_TYPES) $(`st-${t.purpose}`).onclick = () => setSinglePurpose(t.purpose);
  $("acct-minus").onclick = () => setSingleAccount(state.singleAccountIndex);
  $("acct-plus").onclick = () => setSingleAccount(state.singleAccountIndex + 2);
  const acct = $<HTMLInputElement>("single-acct");
  acct.onchange = () => setSingleAccount(Number(acct.value) || 1);
  renderSingleChoice();
  $("show-single").onclick = showSingleAccount;
  $("scan-single").onclick = scanSinglePsbt;
  $("single-ok").onclick = confirmSingleSign;
  $("single-cancel").onclick = () => {
    state.pendingSingle = undefined;
    show("single-review", false);
    say("singlemsg", "Envío descartado: no se ha firmado nada.");
  };
  $("single-done").onclick = () => {
    stopQr("singlesignedqr");
    show("single-signed", false);
    say("singlemsg", "Listo. Puedes leer otro envío cuando quieras.", "ok");
  };
  $("signed-done").onclick = () => {
    stopQr("signedqr");
    show("signed", false);
    say("signmsg", "Listo. Puedes leer otro envío cuando quieras.", "ok");
  };
}

init();
