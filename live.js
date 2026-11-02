/* Live-Abstimmung: Teilnehmer-Popup, Beamer-Ansicht und Admin-Steuerung.
   Firestore: live/current = laufende Umfrage, votes/{runId}_{uid} = eine Stimme pro Person und Umfrage. */
import {
  doc, setDoc, onSnapshot, collection, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const APP_URL = "https://tev-hid.github.io/tefsir-quiz/";
const LETTERS = "ABCDEF";
let ctx = null;              // { db, state, app, tx, esc, plain, toast, go }
let live = null;             // Daten von live/current
let votes = [];
let votesRun = null;
let unsubLive = null, unsubVotes = null;
let dismissed = null;        // runId, die der Teilnehmer minimiert hat
let polls = null;            // flache Liste der vorbereiteten Umfragen
let beamerKey = null;        // erkennt, ob die Beamer-Ansicht neu aufgebaut werden muss

export function initLive(c) { ctx = c; }

const isActive = () => !!live && (live.state === "open" || live.state === "revealed");
const myUid = () => ctx.state.user?.uid;
const myVote = () => { const v = votes.find((x) => x.uid === myUid()); return v ? v.choice : null; };
function counts() {
  const c = (live?.options || []).map(() => 0);
  votes.forEach((v) => { if (v.choice >= 0 && v.choice < c.length) c[v.choice]++; });
  return c;
}

/* ---------- Abonnements ---------- */
export function startLive() {
  stopLive();
  unsubLive = onSnapshot(doc(ctx.db, "live", "current"), (s) => {
    live = s.exists() ? s.data() : null;
    subscribeVotes();
    refreshLive();
  }, (e) => console.warn("live", e));
}
export function stopLive() {
  unsubLive?.(); unsubVotes?.();
  unsubLive = unsubVotes = null; live = null; votes = []; votesRun = null;
  document.getElementById("live-ov")?.remove();
  document.getElementById("live-pill")?.remove();
}
function subscribeVotes() {
  const run = isActive() ? live.runId : null;
  if (run === votesRun) return;
  unsubVotes?.(); unsubVotes = null; votes = []; votesRun = run;
  if (!run) return;
  unsubVotes = onSnapshot(query(collection(ctx.db, "votes"), where("runId", "==", run)), (s) => {
    votes = s.docs.map((d) => d.data());
    refreshLive();
  }, (e) => console.warn("votes", e));
}

/* Alles neu zeichnen, was von der Umfrage abhängt */
export function refreshLive() {
  if (!ctx) return;
  paintParticipant();
  if (ctx.state.view === "beamer") paintBeamer();
  if (ctx.state.view === "live") paintAdminStatus();
}

/* ---------- Teilnehmer ---------- */
function paintParticipant() {
  const ov = document.getElementById("live-ov");
  const pill = document.getElementById("live-pill");
  const view = ctx.state.view;
  if (!ctx.state.user || !isActive() || view === "beamer" || view === "live") {
    ov?.remove(); pill?.remove(); return;
  }
  if (dismissed === live.runId || ctx.state.inQuiz) {
    ov?.remove();
    if (!pill) {
      const p = document.createElement("button");
      p.id = "live-pill"; p.className = "live-pill";
      p.innerHTML = `<span class="dot"></span> Live-Abstimmung`;
      p.onclick = () => {
        if (ctx.state.inQuiz) { ctx.toast("Erst das Quiz beenden, dann abstimmen."); return; }
        dismissed = null; refreshLive();
      };
      document.body.appendChild(p);
    }
    return;
  }
  pill?.remove();
  let box = ov;
  if (!box) {
    box = document.createElement("div");
    box.id = "live-ov"; box.className = "live-ov";
    box.addEventListener("click", onParticipantClick);
    document.body.appendChild(box);
  }
  const { tx } = ctx;
  const mine = myVote();
  const revealed = live.state === "revealed";
  const c = counts(); const total = votes.length;
  box.innerHTML = `
    <div class="live-card">
      <div class="live-head"><span><span class="dot"></span> Live-Abstimmung</span>
        <button class="live-x" data-close aria-label="Minimieren">✕</button></div>
      <h2 class="live-q">${tx(live.q)}</h2>
      <div class="live-opts">${live.options.map((o, i) => {
        const pct = total ? Math.round((c[i] / total) * 100) : 0;
        const cls = [mine === i ? "mine" : "", revealed && live.answer === i ? "right" : ""].join(" ");
        return `<button class="live-opt ${cls}" data-vote="${i}" ${revealed ? "disabled" : ""}>
          ${revealed ? `<span class="fill" style="width:${pct}%"></span>` : ""}
          <span class="key">${LETTERS[i]}</span><span class="txt">${tx(o)}</span>
          ${revealed ? `<span class="pct">${pct}%</span>` : mine === i ? `<span class="pct">✓</span>` : ""}
        </button>`;
      }).join("")}</div>
      <p class="live-foot">${revealed ? `Ergebnis · ${total} Stimme${total === 1 ? "" : "n"}`
        : mine == null ? "Tippe deine Antwort · auf dem Beamer bleibt sie anonym"
        : "✓ Abgestimmt · du kannst bis zum Ende noch ändern"}</p>
    </div>`;
}
async function onParticipantClick(e) {
  if (e.target.closest("[data-close]")) { dismissed = live?.runId; refreshLive(); return; }
  const b = e.target.closest("[data-vote]");
  if (!b || !isActive() || live.state !== "open") return;
  const choice = +b.dataset.vote, uid = myUid(), runId = live.runId;
  // sofort anzeigen, dann speichern
  votes = [...votes.filter((v) => v.uid !== uid), { uid, runId, choice }];
  refreshLive();
  try {
    await setDoc(doc(ctx.db, "votes", `${runId}_${uid}`), { runId, uid, choice, at: Date.now() });
  } catch (err) {
    ctx.toast("Stimme konnte nicht gespeichert werden. Vielleicht ist die Abstimmung schon beendet.", 4000);
  }
}

/* ---------- Vorbereitete Umfragen ---------- */
async function loadPolls() {
  if (polls) return polls;
  try {
    const groups = await fetch(`polls.json?v=${Date.now()}`).then((r) => r.json());
    polls = [];
    groups.forEach((g, gi) => g.items.forEach((p, i) => polls.push({ ...p, group: g.group, src: `${gi}:${i}` })));
  } catch (e) { polls = []; }
  return polls;
}

/* ---------- Admin-Aktionen ---------- */
async function startPoll(p) {
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const data = { runId, q: p.q, options: p.options, answer: Number.isInteger(p.answer) ? p.answer : null,
                 note: p.note || null, src: p.src || null, state: "open", startedAt: Date.now() };
  try { await setDoc(doc(ctx.db, "live", "current"), data); }
  catch (e) { ctx.toast("Fehler: " + e.message, 5000); }
}
async function setState(st) {
  if (!live) return;
  try {
    if (st === "idle") await setDoc(doc(ctx.db, "live", "current"), { state: "idle", runId: null, endedAt: Date.now() });
    else await setDoc(doc(ctx.db, "live", "current"), { ...live, state: st });
  } catch (e) { ctx.toast("Fehler: " + e.message, 5000); }
}
async function nextPoll() {
  const list = await loadPolls();
  const i = live?.src ? list.findIndex((p) => p.src === live.src) : -1;
  const n = list[i + 1];
  if (n) startPoll(n); else ctx.toast("Keine weitere vorbereitete Umfrage.");
}
function toggleReveal() {
  if (!isActive()) return;
  setState(live.state === "open" ? "revealed" : "open");
}

/* ---------- Admin-Seite ---------- */
export async function renderLiveAdmin() {
  const { app, esc, tx, plain } = ctx;
  const list = await loadPolls();
  let lastGroup = null;
  app.innerHTML = `
    <h1>Live-Abstimmung</h1>
    <p class="muted">Startest du eine Umfrage, erscheint sie sofort auf allen Handys. Öffne am Laptop die Beamer-Ansicht und steuere dort oder hier vom Handy aus.</p>
    <div class="card dark" id="live-status"></div>
    <div class="card">
      <h3 style="margin-top:0">Vorbereitete Umfragen</h3>
      <div class="poll-list">${list.map((p) => {
        const head = p.group !== lastGroup ? `<div class="eyebrow" style="margin:10px 0 4px">${esc(p.group)}</div>` : "";
        lastGroup = p.group;
        return `${head}<div class="poll-row" data-src="${p.src}">
          <div style="flex:1;min-width:0"><b>${esc(plain(p.q))}</b>
            <div class="muted small">${p.options.map((o, i) => `${LETTERS[i]}) ${esc(plain(o))}${p.answer === i ? " ✓" : ""}`).join(" · ")}</div></div>
          <button class="btn small" data-start="${p.src}">Starten</button></div>`;
      }).join("") || `<p class="muted">Keine vorbereiteten Umfragen gefunden.</p>`}</div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Eigene Frage spontan</h3>
      <label class="field"><span>Frage</span><input type="text" id="cq" maxlength="200" placeholder="z. B. Was bedeutet für euch Takva?"></label>
      <label class="field"><span>Antworten (eine pro Zeile, 2 bis 6)</span><textarea id="co" rows="4" placeholder="Ja&#10;Nein&#10;Weiß nicht"></textarea></label>
      <label class="field"><span>Richtige Antwort (optional)</span><select id="ca"><option value="">keine, nur Meinung</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n - 1}">${LETTERS[n - 1]}</option>`).join("")}</select></label>
      <button class="btn" id="cstart">Diese Frage starten</button>
    </div>`;
  paintAdminStatus();
  app.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => {
    const p = list.find((x) => x.src === b.dataset.start);
    if (p) startPoll(p);
  }));
  app.querySelector("#cstart").onclick = () => {
    const q = app.querySelector("#cq").value.trim();
    const options = app.querySelector("#co").value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const a = app.querySelector("#ca").value;
    if (!q || options.length < 2) { ctx.toast("Bitte eine Frage und mindestens 2 Antworten eingeben."); return; }
    const answer = a === "" ? null : +a;
    if (answer != null && answer >= options.length) { ctx.toast("Die richtige Antwort gibt es nicht in der Liste."); return; }
    startPoll({ q, options, answer });
  };
}
function paintAdminStatus() {
  const el = document.getElementById("live-status");
  if (!el) return;
  const { tx, esc } = ctx;
  if (!isActive()) {
    el.innerHTML = `<div class="eyebrow" style="color:var(--gold-2)">Status</div>
      <h3 style="margin:4px 0 12px;color:var(--cream)">Gerade keine Umfrage aktiv</h3>
      <button class="btn" data-beamer>📽️ Beamer-Ansicht öffnen</button>`;
  } else {
    const c = counts(), total = votes.length;
    el.innerHTML = `<div class="eyebrow" style="color:var(--gold-2)"><span class="dot"></span> ${live.state === "open" ? "Läuft · Ergebnis verdeckt" : "Ergebnis wird gezeigt"}</div>
      <h3 style="margin:4px 0 6px;color:var(--cream)">${tx(live.q)}</h3>
      <p style="margin:0 0 10px;color:#CFDDD6">${total} Stimme${total === 1 ? "" : "n"}: ${live.options.map((o, i) => `${LETTERS[i]} ${c[i]}`).join(" · ")}</p>
      ${live.note ? `<p class="live-note">💡 ${esc(live.note)}</p>` : ""}
      <div class="btn-row">
        <button class="btn" data-reveal>${live.state === "open" ? "Ergebnis zeigen" : "Ergebnis verbergen"}</button>
        ${live.src ? `<button class="btn secondary" data-next>Nächste ▶</button>` : ""}
        <button class="btn danger" data-end>Beenden</button>
        <button class="btn secondary" data-beamer>📽️ Beamer</button>
      </div>`;
  }
  el.querySelector("[data-beamer]")?.addEventListener("click", () => ctx.go("beamer"));
  el.querySelector("[data-reveal]")?.addEventListener("click", toggleReveal);
  el.querySelector("[data-next]")?.addEventListener("click", nextPoll);
  el.querySelector("[data-end]")?.addEventListener("click", () => setState("idle"));
}

/* ---------- Beamer ---------- */
let keyHandler = null;
export function renderBeamer() {
  beamerKey = null;
  document.body.classList.add("beamer-mode");
  ctx.app.innerHTML = `<div class="beamer" id="beamer"><div id="bm-main"></div>
    <div class="bm-controls">
      <button data-b="reveal" title="R">Ergebnis <kbd>R</kbd></button>
      <button data-b="next" title="N">Nächste <kbd>N</kbd></button>
      <button data-b="end">Beenden</button>
      <button data-b="full" title="F">Vollbild <kbd>F</kbd></button>
      <button data-b="back">✕ Zurück</button>
    </div></div>`;
  const bm = document.getElementById("beamer");
  bm.querySelector(".bm-controls").addEventListener("click", (e) => {
    const b = e.target.closest("[data-b]"); if (!b) return;
    const a = b.dataset.b;
    if (a === "reveal") toggleReveal();
    if (a === "next") nextPoll();
    if (a === "end") setState("idle");
    if (a === "full") toggleFull();
    if (a === "back") leaveBeamer();
  });
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = (e) => {
    if (ctx.state.view !== "beamer" || e.target.closest?.("input,textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "r" || k === " ") { e.preventDefault(); toggleReveal(); }
    if (k === "n" || k === "arrowright") nextPoll();
    if (k === "f") toggleFull();
    if (k === "escape" && !document.fullscreenElement) leaveBeamer();
  };
  document.addEventListener("keydown", keyHandler);
  loadQr().then(() => { beamerKey = null; paintBeamer(); });
  paintBeamer();
}
function leaveBeamer() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  ctx.go("live");
}
function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
function loadQr() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
    s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  });
}
function qrSvg(size) {
  if (!window.qrcode) return "";
  const q = window.qrcode(0, "M"); q.addData(APP_URL); q.make();
  const n = q.getModuleCount(), cell = size / (n + 4);
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${(c + 2) * cell},${(r + 2) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR-Code zur App"><rect width="${size}" height="${size}" rx="${cell * 2}" fill="#F6F1E7"/><path d="${path}" fill="#16302B"/></svg>`;
}
function paintBeamer() {
  const main = document.getElementById("bm-main");
  if (!main) return;
  const { tx } = ctx;
  const key = isActive() ? `${live.runId}|${live.state}` : "idle";
  const c = counts(), total = votes.length;
  if (key !== beamerKey) {
    beamerKey = key;
    if (!isActive()) {
      main.innerHTML = `<div class="bm-idle">
        <div class="bm-qr big">${qrSvg(320)}</div>
        <div><div class="bm-eyebrow">Live-Abstimmung</div>
          <h1 class="bm-title">Handy raus, in der App anmelden 📱</h1>
          <p class="bm-url">tev-hid.github.io/tefsir-quiz</p>
          <p class="bm-sub">Die Frage erscheint gleich automatisch.</p></div></div>`;
      return;
    }
    const revealed = live.state === "revealed";
    main.innerHTML = `
      <div class="bm-top">
        <div class="bm-live"><span class="dot"></span> LIVE</div>
        <div class="bm-count" id="bm-total"></div>
        <div class="bm-qr">${qrSvg(110)}</div>
      </div>
      <h1 class="bm-q">${tx(live.q)}</h1>
      <div class="bm-opts ${revealed ? "revealed" : "hidden-res"}">${live.options.map((o, i) => `
        <div class="bm-opt ${revealed && live.answer === i ? "right" : ""}" data-i="${i}">
          <span class="fill" style="width:0%"></span>
          <span class="key">${revealed && live.answer === i ? "✓" : LETTERS[i]}</span><span class="txt">${tx(o)}</span>
          <span class="pct"></span>
        </div>`).join("")}</div>
      <p class="bm-hint">${revealed ? (live.answer != null ? "✓ = richtige Antwort" : "Meinungsumfrage · keine richtige Antwort") : "Ergebnis noch verdeckt · stimmt auf dem Handy ab"}</p>`;
  }
  const t = document.getElementById("bm-total"); if (t) t.innerHTML = `<b>${total}</b> Stimme${total === 1 ? "" : "n"}`;
  if (live?.state === "revealed") {
    requestAnimationFrame(() => {
      main.querySelectorAll(".bm-opt").forEach((el) => {
        const i = +el.dataset.i, pct = total ? Math.round((c[i] / total) * 100) : 0;
        el.querySelector(".fill").style.width = pct + "%";
        el.querySelector(".pct").textContent = `${pct}% · ${c[i]}`;
      });
    });
  }
}
