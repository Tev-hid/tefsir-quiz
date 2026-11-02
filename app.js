import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { initLive, startLive, stopLive, refreshLive, renderLiveAdmin, renderBeamer } from "./live.js";
import { EMAIL_DOMAIN, ADMIN_NICKS, BASE_POINTS, SPEED_BONUS, DEFAULT_TIME } from "./settings.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const app = document.getElementById("app");
const topbar = document.getElementById("topbar");
const state = { user: null, nick: "", isAdmin: false, catalog: null, view: "home" };

/* ---------- Hilfsfunktionen ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Text, der entweder ein String oder {tr, de} ist -> HTML mit türkischer Zeile und deutscher Zeile darunter
function tx(v) {
  if (v == null) return "";
  if (typeof v === "string") return esc(v);
  const tr = v.tr ? esc(v.tr) : "";
  const de = v.de ? `<span class="de">${esc(v.de)}</span>` : "";
  return tr + de;
}
const plain = (v) => (typeof v === "string" ? v : v?.tr || v?.de || "");
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function askConfirm(msg, okLabel) {
  return new Promise(function (resolve) {
    var w = document.createElement("div");
    w.style.cssText = "position:fixed;inset:0;background:rgba(10,20,18,.55);display:flex;align-items:center;justify-content:center;padding:20px;z-index:100";
    var box = document.createElement("div");
    box.style.cssText = "background:#FFFCF6;border-radius:18px;padding:22px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.25)";
    var p = document.createElement("p");
    p.style.cssText = "margin:0 0 16px;font-weight:700;color:#16302B;line-height:1.45";
    p.textContent = msg;
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap";
    var no = document.createElement("button"); no.className = "btn secondary"; no.textContent = "Abbrechen";
    var yes = document.createElement("button"); yes.className = "btn danger"; yes.textContent = okLabel || "Ja";
    row.append(no, yes); box.append(p, row); w.append(box);
    var done = function (v) { w.remove(); resolve(v); };
    no.onclick = function () { done(false); };
    yes.onclick = function () { done(true); };
    w.onclick = function (e) { if (e.target === w) done(false); };
    document.body.appendChild(w);
  });
}
const translit = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ı/g, "i").replace(/İ/g, "I").replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ğ/g, "g").replace(/Ğ/g, "G");
const nickToEmail = (nick) => `${translit(nick.trim()).toLowerCase()}@${EMAIL_DOMAIN}`;
const NICK_RE = /^[A-Za-z0-9_\-ÇĞİÖŞÜçğıöşü]{3,20}$/;
const medal = (i) => ["🥇", "🥈", "🥉"][i] || String(i + 1);

initLive({ db, state, app, tx, esc, plain, toast, go: (v, a) => go(v, a) });

async function loadCatalog() {
  if (state.catalog) return state.catalog;
  const res = await fetch(`quizzes/index.json?v=${Date.now()}`);
  state.catalog = await res.json();
  return state.catalog;
}
async function loadQuiz(meta) {
  const res = await fetch(`quizzes/${meta.file}?v=${Date.now()}`);
  return res.json();
}
async function quizOpenMap() {
  const snap = await getDocs(collection(db, "quizState"));
  const m = {};
  snap.forEach((d) => (m[d.id] = !!d.data().open));
  return m;
}

/* ---------- Navigation ---------- */
function setActiveNav(view) {
  document.querySelectorAll("#topbar nav button[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === view));
}
function go(view, arg) {
  state.view = view;
  setActiveNav(view === "live" || view === "beamer" ? "admin" : view);
  window.scrollTo(0, 0);
  if (view !== "beamer") document.body.classList.remove("beamer-mode");
  refreshLive();
  if (view === "live") return state.isAdmin ? renderLiveAdmin() : go("home");
  if (view === "beamer") return state.isAdmin ? renderBeamer() : go("home");
  if (view === "home") return renderHome();
  if (view === "league") return renderLeague(arg);
  if (view === "admin") return renderAdmin();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-nav]");
  if (b && state.user) go(b.dataset.nav);
});
document.getElementById("btn-logout").addEventListener("click", async () => {
  if (state.inQuiz && !(await askConfirm("Das Quiz läuft noch. Wirklich abmelden?", "Abmelden"))) return;
  await signOut(auth);
});

/* ---------- Anmeldung ---------- */
function renderLogin(mode = "login") {
  topbar.hidden = true;
  app.innerHTML = `
    <div class="hero">
      <div class="arabic">في ظلال القرآن</div>
      <h1>Tefsir Quiz</h1>
      <p class="muted">Wöchentliches Quiz zur Tefsir-Sohbet · Haftalık tefsir yarışması</p>
    </div>
    <div class="card">
      <div class="tabs">
        <button data-mode="login" class="${mode === "login" ? "active" : ""}">Anmelden</button>
        <button data-mode="register" class="${mode === "register" ? "active" : ""}">Registrieren</button>
      </div>
      <form id="auth-form" novalidate>
        <label for="nick">Nickname</label>
        <input id="nick" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="20" required>
        ${mode === "register" ? `<div class="hint">3–20 Zeichen: Buchstaben, Zahlen, _ oder -. So erscheinst du in der Liga.</div>` : ""}
        <label for="pw">Passwort</label>
        <input id="pw" type="password" autocomplete="${mode === "register" ? "new-password" : "current-password"}" required>
        ${mode === "register" ? `
          <div class="hint">Mindestens 6 Zeichen. Merk es dir gut – es gibt keine E-Mail zum Zurücksetzen (der Admin kann helfen).</div>
          <label for="pw2">Passwort wiederholen</label>
          <input id="pw2" type="password" autocomplete="new-password" required>` : ""}
        <div class="error" id="auth-error"></div>
        <button class="btn block" type="submit">${mode === "register" ? "Konto erstellen" : "Anmelden"}</button>
      </form>
    </div>`;
  app.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => renderLogin(b.dataset.mode)));
  const form = document.getElementById("auth-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("auth-error");
    const nick = document.getElementById("nick").value.trim();
    const pw = document.getElementById("pw").value;
    err.textContent = "";
    if (!NICK_RE.test(nick)) return (err.textContent = "Der Nickname muss 3–20 Zeichen haben (Buchstaben, Zahlen, _ oder -).");
    if (pw.length < 6) return (err.textContent = "Das Passwort braucht mindestens 6 Zeichen.");
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (mode === "register") {
        if (pw !== document.getElementById("pw2").value) { btn.disabled = false; return (err.textContent = "Die Passwörter stimmen nicht überein."); }
        state.pendingNick = nick; // das Nutzerprofil legt onAuthStateChanged an
        await createUserWithEmailAndPassword(auth, nickToEmail(nick), pw);
      } else {
        await signInWithEmailAndPassword(auth, nickToEmail(nick), pw);
      }
    } catch (ex) {
      btn.disabled = false;
      const c = ex.code || "";
      err.textContent =
        c.includes("email-already-in-use") ? "Diesen Nickname gibt es schon. Bitte einen anderen wählen." :
        c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") ? "Nickname oder Passwort ist falsch." :
        c.includes("too-many-requests") ? "Zu viele Versuche. Bitte kurz warten." :
        c.includes("invalid-email") ? "Dieser Nickname ist nicht erlaubt." :
        c.includes("network") ? "Keine Verbindung. Bitte Internet prüfen." :
        "Das hat nicht geklappt: " + (ex.message || c);
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.inQuiz = false;
  if (!user) { stopLive(); document.body.classList.remove("beamer-mode"); return renderLogin(); }
  try {
    const uref = doc(db, "users", user.uid);
    let snap = await getDoc(uref);
    if (!snap.exists()) {
      const nick = state.pendingNick || user.email.split("@")[0];
      await setDoc(uref, { nick, createdAt: Date.now() });
      snap = await getDoc(uref);
    }
    state.nick = snap.data().nick;
  } catch (e) {
    state.nick = user.email.split("@")[0];
  }
  state.isAdmin = ADMIN_NICKS.includes(user.email.split("@")[0]);
  document.getElementById("nav-admin").hidden = !state.isAdmin;
  topbar.hidden = false;
  startLive();
  go("home");
});

/* ---------- Startseite ---------- */
async function renderHome() {
  app.innerHTML = `<div class="loading">Lädt …</div>`;
  const [catalog, open, resSnap] = await Promise.all([
    loadCatalog(), quizOpenMap(), getDocs(collection(db, "results"))
  ]);
  const results = resSnap.docs.map((d) => d.data());
  const mine = {};
  results.filter((r) => r.uid === state.user.uid).forEach((r) => (mine[r.quizId] = r));

  const items = [...catalog].reverse().map((q) => {
    const done = mine[q.id];
    const isOpen = open[q.id];
    let badge, action = "";
    if (done) { badge = `<span class="badge done">Erledigt · ${done.score} Punkte</span>`; action = `<button class="btn small secondary" data-league="${q.id}">Wochenwertung</button>`; }
    else if (isOpen) { badge = `<span class="badge open">Offen</span>`; action = `<button class="btn" data-play="${q.id}">Jetzt spielen ▶</button>`; }
    else { badge = `<span class="badge closed">Noch nicht freigegeben / geschlossen</span>`; }
    return `<div class="card quiz-item">
      <div class="meta">
        <div class="eyebrow">${esc(q.week || "")}</div>
        <h3>${tx(q.title)}</h3>
        <div class="muted" style="margin:4px 0 8px">${esc(q.ayat || "")}</div>
        ${badge}
      </div>
      ${action}
    </div>`;
  }).join("");

  const board = leagueTotals(results).slice(0, 5);
  app.innerHTML = `
    <h1>Selam, ${esc(state.nick)}!</h1>
    <p class="muted">Jede Woche ein neues Quiz zum Thema der letzten Sohbet. Ein Versuch pro Quiz – schnell antworten gibt Bonuspunkte.</p>
    <h2 style="margin-top:20px">Quizze</h2>
    ${items || `<div class="card muted">Noch keine Quizze vorhanden.</div>`}
    <div class="card dark">
      <h3>🏆 Liga · Top 5</h3>
      ${board.length ? leagueTable(board, "dark") : `<p>Noch keine Ergebnisse. Sei der Erste!</p>`}
      <button class="btn small" data-nav="league" style="margin-top:10px">Ganze Liga ansehen</button>
    </div>`;
  app.querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => startQuiz(catalog.find((q) => q.id === b.dataset.play))));
  app.querySelectorAll("[data-league]").forEach((b) => b.addEventListener("click", () => go("league", b.dataset.league)));
}

/* ---------- Liga ---------- */
function leagueTotals(results, quizId) {
  const by = {};
  results.filter((r) => !quizId || r.quizId === quizId).forEach((r) => {
    const e = (by[r.uid] ||= { uid: r.uid, nick: r.nick, score: 0, played: 0, correct: 0, total: 0, time: 0 });
    e.score += r.score; e.played += 1; e.correct += r.correct || 0; e.total += r.total || 0; e.time += r.durationMs || 0;
    e.nick = r.nick;
  });
  return Object.values(by).sort((a, b) => b.score - a.score || a.time - b.time);
}
function leagueTable(rows, mode) {
  return `<table class="league">
    <thead><tr><th></th><th>Nickname</th><th style="text-align:right">Punkte</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${r.uid === state.user.uid ? "me" : ""}" ${mode === "dark" ? 'style="color:#F6F1E7"' : ""}>
      <td class="rank">${medal(i)}</td>
      <td>${esc(r.nick)}${r.uid === state.user.uid ? " (du)" : ""}<div class="muted" style="font-size:12px;font-weight:600;${mode === "dark" ? "color:#A9BDB4" : ""}">${r.correct}/${r.total} richtig${r.played > 1 ? ` · ${r.played} Quizze` : ""}</div></td>
      <td class="pts" ${mode === "dark" ? 'style="color:#E2B864"' : ""}>${r.score}</td></tr>`).join("")}</tbody></table>`;
}
async function renderLeague(selected = "all") {
  app.innerHTML = `<div class="loading">Lädt …</div>`;
  const [catalog, resSnap] = await Promise.all([loadCatalog(), getDocs(collection(db, "results"))]);
  const results = resSnap.docs.map((d) => d.data());
  const rows = leagueTotals(results, selected === "all" ? null : selected);
  const chips = [`<button data-q="all" class="${selected === "all" ? "active" : ""}">Gesamt</button>`]
    .concat([...catalog].reverse().map((q) => `<button data-q="${q.id}" class="${selected === q.id ? "active" : ""}">${esc(q.week || q.id)}</button>`)).join("");
  const top = rows.slice(0, 3);
  const podium = top.length ? `<div class="podium">
      ${[1, 0, 2].map((i) => top[i] ? `<div class="p p${i + 1}"><div class="medal">${medal(i)}</div><div class="n">${esc(top[i].nick)}</div><div class="s">${top[i].score}</div></div>` : `<div></div>`).join("")}
    </div>` : "";
  app.innerHTML = `
    <h1>🏆 Liga</h1>
    <div class="chips">${chips}</div>
    ${podium}
    <div class="card">${rows.length ? leagueTable(rows) : `<p class="muted">Noch keine Ergebnisse.</p>`}</div>`;
  app.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => renderLeague(b.dataset.q)));
}

/* ---------- Quiz spielen ---------- */
async function startQuiz(meta) {
  app.innerHTML = `<div class="loading">Quiz wird geladen …</div>`;
  const quiz = await loadQuiz(meta);
  const uid = state.user.uid;
  const id = `${quiz.id}_${uid}`;
  const resSnap = await getDoc(doc(db, "results", id));
  if (resSnap.exists()) { toast("Dieses Quiz hast du schon gemacht."); return go("home"); }
  const aRef = doc(db, "attempts", id);
  let st;
  const aSnap = await getDoc(aRef);
  if (!aSnap.exists()) {
    if (!(await confirmStart(quiz))) return;
    st = { uid, nick: state.nick, quizId: quiz.id, idx: 0, score: 0, correct: 0, pending: -1, answers: [], startedAt: Date.now() };
    try { await setDoc(aRef, st); }
    catch (e) { toast("Das Quiz ist gerade nicht freigegeben."); return go("home"); }
  } else {
    st = aSnap.data();
    if (st.pending === st.idx && st.idx < quiz.questions.length) {
      // Seite wurde während einer Frage verlassen -> Frage zählt als nicht beantwortet
      st.answers.push({ p: 0, ok: false, timeout: true });
      st.idx += 1; st.pending = -1;
      await updateDoc(aRef, { idx: st.idx, pending: -1, answers: st.answers });
      toast("Die letzte Frage wurde abgebrochen und zählt als nicht beantwortet.", 4000);
    }
  }
  state.inQuiz = true;
  refreshLive();
  nextQuestion(quiz, st, aRef);
}
function confirmStart(quiz) {
  return new Promise((resolve) => {
    app.innerHTML = `
      <div class="play">
        <div class="eyebrow" style="color:#E2B864">${esc(quiz.week || "")}</div>
        <h2 style="color:#F6F1E7">${tx(quiz.title)}</h2>
        <p>${quiz.questions.length} Fragen · ${esc(quiz.ayat || "")}</p>
        <ul style="line-height:1.7">
          <li>Du hast <b>nur einen Versuch</b>.</li>
          <li>Jede Frage hat einen Timer. Schnelle richtige Antworten geben bis zu ${SPEED_BONUS} Bonuspunkte.</li>
          <li>Wenn du die Seite während einer Frage verlässt, zählt sie als nicht beantwortet.</li>
        </ul>
        <button class="btn block" id="go">Bismillah – Los geht’s!</button>
        <button class="btn block secondary" id="back" style="margin-top:10px">Zurück</button>
      </div>`;
    document.getElementById("go").onclick = () => resolve(true);
    document.getElementById("back").onclick = () => { resolve(false); go("home"); };
  });
}

function nextQuestion(quiz, st, aRef) {
  if (st.idx >= quiz.questions.length) return finishQuiz(quiz, st, aRef);
  const q = quiz.questions[st.idx];
  const n = quiz.questions.length;
  const limit = q.time || DEFAULT_TIME;

  app.innerHTML = `
    <div class="play">
      <div class="play-head"><span>Frage ${st.idx + 1} / ${n}</span><span>⭐ ${st.score} Punkte</span></div>
      <div class="timer" id="timer"><div></div></div>
      <div class="q-text">${tx(q.q)}</div>
      ${q.arabic ? `<div class="q-arabic">${esc(q.arabic)}</div>` : ""}
      ${q.image ? `<div class="q-media"><img src="${esc(q.image)}" alt="${esc(plain(q.imageAlt) || "")}"></div>` : ""}
      ${q.video ? `<div class="q-media"><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(q.video)}?rel=0" allow="encrypted-media; picture-in-picture" allowfullscreen title="Video"></iframe></div></div>` : ""}
      <div id="answer-area"></div>
      <div id="fb"></div>
    </div>`;

  const area = document.getElementById("answer-area");
  let answered = false;
  let t0 = 0, raf = 0;
  const bar = document.querySelector("#timer > div");
  const timerBox = document.getElementById("timer");

  const startTimer = async () => {
    st.pending = st.idx;
    updateDoc(aRef, { pending: st.idx }).catch(() => {});
    t0 = performance.now();
    const tick = () => {
      const left = Math.max(0, 1 - (performance.now() - t0) / (limit * 1000));
      bar.style.transform = `scaleX(${left})`;
      timerBox.classList.toggle("low", left < 0.25);
      if (left <= 0) return submit(null, true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const submit = async (result, timeout = false) => {
    if (answered) return;
    answered = true;
    cancelAnimationFrame(raf);
    const ratioLeft = Math.max(0, 1 - (performance.now() - t0) / (limit * 1000));
    const frac = timeout ? 0 : result.fraction;
    let pts = frac > 0 ? Math.round(BASE_POINTS * frac) : 0;
    if (frac === 1) pts += Math.round(SPEED_BONUS * ratioLeft);
    st.score += pts;
    if (frac === 1) st.correct += 1;
    st.answers.push({ p: pts, ok: frac === 1, timeout: !!timeout });
    st.idx += 1; st.pending = -1;
    renderer.reveal?.(timeout);
    const fbBox = document.getElementById("fb");
    const ok = frac === 1;
    const verdict = timeout ? "⏱ Zeit abgelaufen" : ok ? "✓ Richtig!" : frac > 0 ? "◐ Teilweise richtig" : "✗ Leider falsch";
    fbBox.innerHTML = `<div class="feedback ${ok ? "ok" : "bad"}">
      <span class="pts">+${pts}</span>
      <div class="verdict">${verdict}</div>
      ${renderer.solutionHtml ? renderer.solutionHtml() : ""}
      ${q.explain ? `<p>${tx(q.explain)}</p>` : ""}
      <button class="btn block" id="next">${st.idx >= n ? "Ergebnis ansehen" : "Weiter"} →</button>
    </div>`;
    const nextBtn = document.getElementById("next");
    nextBtn.disabled = true;
    try {
      await updateDoc(aRef, { idx: st.idx, pending: -1, score: st.score, correct: st.correct, answers: st.answers });
    } catch (e) {
      toast("Speichern hat nicht geklappt – bitte Internet prüfen.", 4000);
    }
    nextBtn.disabled = false;
    nextBtn.onclick = () => nextQuestion(quiz, st, aRef);
    fbBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const renderer = RENDERERS[q.type](q, area, (r) => submit(r));

  if (q.video) {
    area.style.display = "none";
    const startBtn = document.createElement("button");
    startBtn.className = "btn block";
    startBtn.style.marginTop = "12px";
    startBtn.textContent = "Video gesehen – zur Frage";
    area.before(startBtn);
    bar.style.transform = "scaleX(1)";
    startBtn.onclick = () => { startBtn.remove(); area.style.display = ""; startTimer(); };
  } else {
    startTimer();
  }
}

/* Antworttypen: jeder Renderer baut die Antwortfläche und ruft done({fraction}) auf */
const RENDERERS = {
  // Multiple Choice. options: [{text:{tr,de}} | {image, alt}], answer: Index
  mc(q, area, done) {
    const order = shuffle(q.options.map((_, i) => i));
    const hasImg = q.options.some((o) => o.image);
    area.innerHTML = `<div class="options ${hasImg ? "grid2" : ""}">${order.map((oi, k) => {
      const o = q.options[oi];
      return `<button class="opt ${o.image ? "img-opt" : ""}" data-i="${oi}">
        ${o.image ? `<img src="${esc(o.image)}" alt="${esc(plain(o.alt) || "")}">${o.text ? `<span>${tx(o.text)}</span>` : ""}`
                  : `<span class="key">${"ABCDEF"[k]}</span><span>${tx(o.text)}</span>`}
      </button>`;
    }).join("")}</div>`;
    let chosen = null;
    area.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
      chosen = +b.dataset.i;
      done({ fraction: chosen === q.answer ? 1 : 0 });
    }));
    return {
      reveal() {
        area.querySelectorAll(".opt").forEach((b) => {
          const i = +b.dataset.i;
          b.disabled = true;
          if (i === q.answer) b.classList.add("correct");
          else if (i === chosen) b.classList.add("wrong");
          else b.classList.add("dim");
        });
      }
    };
  },
  // Richtig / Falsch. answer: true|false
  tf(q, area, done) {
    area.innerHTML = `<div class="options tf">
      <button class="opt" data-v="1">✓ Doğru<span class="de">Richtig</span></button>
      <button class="opt" data-v="0">✗ Yanlış<span class="de">Falsch</span></button></div>`;
    let chosen = null;
    area.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
      chosen = b.dataset.v === "1";
      done({ fraction: chosen === q.answer ? 1 : 0 });
    }));
    return {
      reveal() {
        area.querySelectorAll(".opt").forEach((b) => {
          const v = b.dataset.v === "1";
          b.disabled = true;
          if (v === q.answer) b.classList.add("correct");
          else if (v === chosen) b.classList.add("wrong");
        });
      }
    };
  },
  // Reihenfolge per Drag & Drop. items: in RICHTIGER Reihenfolge
  order(q, area, done) {
    let idx = q.items.map((_, i) => i);
    do { idx = shuffle(idx); } while (idx.every((v, i) => v === i) && idx.length > 1);
    area.innerHTML = `<ol class="sortable" id="sortlist">${idx.map((i) => `<li data-i="${i}"><span class="num"></span><span style="flex:1">${tx(q.items[i])}</span><span class="grip">⠿</span></li>`).join("")}</ol>
      <div class="drag-hint">Ziehen zum Sortieren · Sürükleyerek sırala</div>
      <button class="btn block" id="confirm" style="margin-top:12px">Bestätigen</button>`;
    const list = area.querySelector("#sortlist");
    const renum = () => list.querySelectorAll("li").forEach((li, k) => (li.querySelector(".num").textContent = k + 1));
    renum();
    const s = new Sortable(list, { animation: 160, ghostClass: "ghost", chosenClass: "chosen", onSort: renum });
    area.querySelector("#confirm").onclick = () => {
      const cur = [...list.querySelectorAll("li")].map((li) => +li.dataset.i);
      const right = cur.filter((v, k) => v === k).length;
      done({ fraction: right / cur.length });
    };
    return {
      reveal() {
        s.option("disabled", true);
        area.querySelector("#confirm").remove();
        area.querySelector(".drag-hint").remove();
        [...list.querySelectorAll("li")].forEach((li, k) => li.classList.add(+li.dataset.i === k ? "correct" : "wrong"));
      },
      solutionHtml() {
        return `<p><b>Richtige Reihenfolge:</b></p><ol class="solution">${q.items.map((it) => `<li>${tx(it)}</li>`).join("")}</ol>`;
      }
    };
  },
  // Zuordnen: linke Seite fest, rechte Seite per Drag & Drop passend sortieren. pairs: [{left, right}]
  match(q, area, done) {
    let idx = q.pairs.map((_, i) => i);
    do { idx = shuffle(idx); } while (idx.every((v, i) => v === i) && idx.length > 1);
    area.innerHTML = `<div class="match">
        <div class="left">${q.pairs.map((p) => `<div>${tx(p.left)}</div>`).join("")}</div>
        <ul class="sortable" id="matchlist">${idx.map((i) => `<li data-i="${i}"><span style="flex:1">${tx(q.pairs[i].right)}</span><span class="grip">⠿</span></li>`).join("")}</ul>
      </div>
      <div class="drag-hint">Rechte Seite passend ziehen · Sağ tarafı sürükleyerek eşleştir</div>
      <button class="btn block" id="confirm" style="margin-top:12px">Bestätigen</button>`;
    const list = area.querySelector("#matchlist");
    // Linke Kästen gleich hoch wie rechte halten
    const sync = () => {
      const L = area.querySelectorAll(".left div"), R = list.querySelectorAll("li");
      L.forEach((l, k) => { l.style.minHeight = ""; R[k].style.minHeight = ""; });
      L.forEach((l, k) => { const h = Math.max(l.offsetHeight, R[k].offsetHeight); l.style.minHeight = R[k].style.minHeight = h + "px"; });
    };
    requestAnimationFrame(sync);
    const s = new Sortable(list, { animation: 160, ghostClass: "ghost", chosenClass: "chosen", onSort: sync });
    area.querySelector("#confirm").onclick = () => {
      const cur = [...list.querySelectorAll("li")].map((li) => +li.dataset.i);
      const right = cur.filter((v, k) => v === k).length;
      done({ fraction: right / cur.length });
    };
    return {
      reveal() {
        s.option("disabled", true);
        area.querySelector("#confirm").remove();
        area.querySelector(".drag-hint").remove();
        [...list.querySelectorAll("li")].forEach((li, k) => li.classList.add(+li.dataset.i === k ? "correct" : "wrong"));
      },
      solutionHtml() {
        return `<p><b>Richtige Zuordnung:</b></p><ul class="solution">${q.pairs.map((p) => `<li>${esc(plain(p.left))} → ${esc(plain(p.right))}</li>`).join("")}</ul>`;
      }
    };
  },
  // Körbe: Karten per Drag & Drop in Kategorien sortieren. buckets: [{label}], items: [{text, bucket: Index}]
  bucket(q, area, done) {
    const idx = shuffle(q.items.map((_, i) => i));
    const card = (i) => `<li data-i="${i}"><span style="flex:1">${tx(q.items[i].text)}</span><span class="tap">${q.buckets.map((b, k) => `<button type="button" data-to="${k}" title="${esc(plain(b.label))}">${esc(b.icon || k + 1)}</button>`).join("")}</span></li>`;
    area.innerHTML = `
      <ul class="sortable bucket-pool" id="pool">${idx.map(card).join("")}</ul>
      <div class="buckets">${q.buckets.map((b, k) => `
        <div class="bucket"><div class="bucket-head">${tx(b.label)}</div><ul class="sortable bucket-drop" data-b="${k}"></ul></div>`).join("")}
      </div>
      <div class="drag-hint">Karte in einen Korb ziehen oder Symbol antippen · Kartı sepete sürükle ya da simgeye dokun</div>
      <button class="btn block" id="confirm" style="margin-top:12px">Bestätigen</button>`;
    const lists = [area.querySelector("#pool"), ...area.querySelectorAll(".bucket-drop")];
    const opts = { group: "bucket-" + Math.random(), animation: 160, ghostClass: "ghost", chosenClass: "chosen", filter: ".tap button", preventOnFilter: false };
    const sorts = lists.map((l) => new Sortable(l, opts));
    // Alternativ zum Ziehen: Antippen von 🚗/⛵ verschiebt die Karte in den Korb
    area.addEventListener("click", (e) => {
      const btn = e.target.closest(".tap button");
      if (!btn || btn.disabled) return;
      area.querySelector(`.bucket-drop[data-b="${btn.dataset.to}"]`).appendChild(btn.closest("li"));
    });
    const placed = () => [...area.querySelectorAll(".bucket-drop li")].map((li) => ({ li, i: +li.dataset.i, b: +li.closest(".bucket-drop").dataset.b }));
    area.querySelector("#confirm").onclick = () => {
      const right = placed().filter((p) => q.items[p.i].bucket === p.b).length;
      done({ fraction: right / q.items.length });
    };
    return {
      reveal() {
        sorts.forEach((s) => s.option("disabled", true));
        area.querySelectorAll(".tap button").forEach((b) => (b.disabled = true));
        area.querySelector("#confirm").remove();
        area.querySelector(".drag-hint").remove();
        placed().forEach((p) => p.li.classList.add(q.items[p.i].bucket === p.b ? "correct" : "wrong"));
        area.querySelectorAll("#pool li").forEach((li) => li.classList.add("wrong"));
      },
      solutionHtml() {
        return q.buckets.map((b, k) => `<p><b>${esc(plain(b.label))}</b></p><ul class="solution">${q.items.filter((it) => it.bucket === k).map((it) => `<li>${tx(it.text)}</li>`).join("")}</ul>`).join("");
      }
    };
  }
};

async function finishQuiz(quiz, st, aRef) {
  const total = quiz.questions.length;
  const result = {
    uid: state.user.uid, nick: state.nick, quizId: quiz.id,
    score: st.score, correct: st.correct, total,
    durationMs: Date.now() - (st.startedAt || Date.now()), finishedAt: Date.now()
  };
  app.innerHTML = `<div class="loading">Ergebnis wird gespeichert …</div>`;
  try {
    await setDoc(doc(db, "results", `${quiz.id}_${state.user.uid}`), result);
  } catch (e) {
    const exists = await getDoc(doc(db, "results", `${quiz.id}_${state.user.uid}`)).then((s) => s.exists()).catch(() => false);
    if (!exists) {
      app.innerHTML = `<div class="card"><h2>Speichern fehlgeschlagen</h2><p>Dein Ergebnis (${st.score} Punkte) konnte nicht gespeichert werden. Vielleicht wurde das Quiz inzwischen geschlossen. Bitte melde dich beim Admin.</p><button class="btn" data-nav="home">Zur Startseite</button></div>`;
      state.inQuiz = false;
      return;
    }
  }
  state.inQuiz = false;
  refreshLive();
  const resSnap = await getDocs(query(collection(db, "results"), where("quizId", "==", quiz.id)));
  const rows = leagueTotals(resSnap.docs.map((d) => d.data()));
  const rank = rows.findIndex((r) => r.uid === state.user.uid);
  const msg = st.correct === total ? "Mâşâallah – alles richtig!" : st.correct >= total * 0.7 ? "Sehr stark, bârekallâh!" : st.correct >= total * 0.4 ? "Gut gemacht!" : "Nächste Woche klappt’s noch besser, inşâallah!";
  app.innerHTML = `
    <div class="play result">
      <div class="eyebrow" style="color:#E2B864">${esc(quiz.week || "")}</div>
      <h2 style="color:#F6F1E7">${msg}</h2>
      <div class="big">${st.score}</div>
      <div>Punkte</div>
      <div class="stats">
        <div><b>${st.correct}/${total}</b>richtig</div>
        <div><b>${rank >= 0 ? medal(rank) : "–"}</b>Platz diese Woche</div>
      </div>
      <button class="btn block" id="to-league">Wochenwertung ansehen</button>
      <button class="btn block secondary" data-nav="home" style="margin-top:10px">Zur Startseite</button>
    </div>`;
  document.getElementById("to-league").onclick = () => go("league", quiz.id);
  if (window.confetti && st.correct >= total * 0.5) {
    confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 }, colors: ["#C8963E", "#E2B864", "#F6F1E7", "#2A5148"] });
  }
}

/* ---------- Admin ---------- */
async function renderAdmin() {
  if (!state.isAdmin) return go("home");
  app.innerHTML = `<div class="loading">Lädt …</div>`;
  state.catalog = null;
  const [catalog, open, usersSnap, resSnap, attSnap] = await Promise.all([
    loadCatalog(), quizOpenMap(), getDocs(collection(db, "users")),
    getDocs(collection(db, "results")), getDocs(collection(db, "attempts"))
  ]);
  const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => a.nick.localeCompare(b.nick));
  const results = resSnap.docs.map((d) => d.data());
  const attempts = attSnap.docs.map((d) => d.data());

  app.innerHTML = `
    <h1>Admin</h1>
    <div class="card dark switch-row" style="align-items:center">
      <div><h3 style="margin:0 0 4px"><span class="dot"></span>&nbsp; Live-Abstimmung</h3><div style="color:#CFDDD6">Umfragen während der Sohbet starten und am Beamer zeigen</div></div>
      <button class="btn" data-nav="live">Öffnen</button>
    </div>
    <p class="muted">${users.length} Teilnehmer registriert. Quiz freigeben = Teilnehmer können es spielen. Schließen = keine neuen Ergebnisse mehr.</p>
    ${[...catalog].reverse().map((q) => {
      const isOpen = !!open[q.id];
      return `<div class="card">
        <div class="switch-row">
          <div><div class="eyebrow">${esc(q.week || "")}</div><h3 style="margin:0">${tx(q.title)}</h3><div class="muted">${esc(q.ayat || "")} · ID: ${esc(q.id)}</div></div>
          <button class="btn ${isOpen ? "danger" : ""}" data-toggle="${q.id}" data-open="${isOpen ? 1 : 0}">${isOpen ? "Schließen" : "Freigeben"}</button>
        </div>
        <table class="admin-table" style="margin-top:12px">
          <thead><tr><th>Nickname</th><th>Status</th><th></th></tr></thead>
          <tbody>${users.map((u) => {
            const r = results.find((x) => x.quizId === q.id && x.uid === u.uid);
            const a = attempts.find((x) => x.quizId === q.id && x.uid === u.uid);
            const status = r ? `✅ ${r.score} Punkte (${r.correct}/${r.total})` : a ? `⏳ läuft (Frage ${a.idx + 1})` : "–";
            return `<tr><td>${esc(u.nick)}</td><td>${status}</td><td>${r || a ? `<button class="btn small secondary" data-reset="${q.id}" data-uid="${u.uid}" data-nick="${esc(u.nick)}">Zurücksetzen</button>` : ""}</td></tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
    }).join("")}
    <div class="card">
      <h3>Passwort vergessen?</h3>
      <p class="muted">Firebase-Konsole → Authentication → Nutzer → beim Nutzer „…“ → Konto löschen. Danach kann sich die Person mit demselben Nickname neu registrieren (ihre alten Ergebnisse bleiben in der Liga).</p>
    </div>`;

  app.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.toggle, willOpen = b.dataset.open !== "1";
    b.disabled = true;
    try { await setDoc(doc(db, "quizState", id), { open: willOpen, changedAt: Date.now() }); toast(willOpen ? "Quiz freigegeben ✓" : "Quiz geschlossen"); }
    catch (e) { toast("Fehler: " + e.message, 5000); }
    renderAdmin();
  }));
  app.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await askConfirm(`Versuch von ${b.dataset.nick} für dieses Quiz löschen? Die Person kann dann neu spielen.`, "Zurücksetzen"))) return;
    const id = `${b.dataset.reset}_${b.dataset.uid}`;
    try {
      await Promise.all([deleteDoc(doc(db, "results", id)), deleteDoc(doc(db, "attempts", id))]);
      toast("Zurückgesetzt");
    } catch (e) { toast("Fehler: " + e.message, 5000); }
    renderAdmin();
  }));
}

window.addEventListener("beforeunload", (e) => {
  if (state.inQuiz) { e.preventDefault(); e.returnValue = ""; }
});
