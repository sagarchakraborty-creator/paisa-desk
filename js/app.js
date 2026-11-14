// Paisa Desk: the app. Data lives in `db`, encrypted at rest by Store. All statement text is untrusted, so it is escaped before display.
'use strict';
const APP_VERSION = '2026-11-14.2';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const r2 = n => Math.round(n * 100) / 100;
const inr = (n, dp = 0) => (n < 0 ? '−' : '') + '₹' + Math.abs(n || 0).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const inrC = n => { const a = Math.abs(n || 0), s = n < 0 ? '−' : ''; if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`; if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`; return inr(n); };
const pct = (n, dp = 0) => isFinite(n) ? `${(n * 100).toFixed(dp)}%` : '–';
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymOf = d => d.slice(0, 7);
const ymLabel = (ym, short) => { const [y, m] = ym.split('-'); return short ? `${MN[+m - 1]} ${y.slice(2)}` : `${MN[+m - 1]} ${y}`; };
const ymAdd = (ym, k) => { let [y, m] = ym.split('-').map(Number); m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
const today = () => new Date().toISOString().slice(0, 10);
const dmy = d => d ? `${+d.slice(8)} ${MN[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '–';
const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5);

let db = null;
const ui = { tab: 'home', month: ymOf(today()), f: { q: '', acct: '', cat: '', type: '', month: '' }, limit: 150, pending: [], lockedAt: 0 };

function newDb() {
  return { v: 1, created: today(), accounts: [], txns: [], loans: [], cibil: { score: null, date: null, history: [] }, budgets: {}, rules: {}, assets: [], imports: [] };
}

/* ---------- save ---------- */
let saveT = null;
function save() {
  $('#saved').textContent = 'Saving…';
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try { await Store.save(db); $('#saved').textContent = 'Saved'; setTimeout(() => { if ($('#saved').textContent === 'Saved') $('#saved').textContent = ''; }, 1500); }
    catch (e) { $('#saved').textContent = 'Not saved'; toast('Could not save: ' + e.message); }
  }, 400);
}
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms); }

/* ---------- derived values ---------- */
const acct = id => db.accounts.find(a => a.id === id);
function catOf(t) { return t.mc || db.rules[Cat.key(t.m)] || t.xf || t.cat; }
function kindOf(t) { return Cat.KIND[catOf(t)] || (t.amt < 0 ? 'exp' : 'inc'); }
function monthStats(ym) {
  const s = { inc: 0, exp: 0, inv: 0, byCat: {}, n: 0 };
  for (const t of db.txns) {
    if (!t.d.startsWith(ym)) continue;
    s.n++;
    const k = kindOf(t), c = catOf(t);
    if (k === 'exp') { s.exp -= t.amt; s.byCat[c] = (s.byCat[c] || 0) - t.amt; }
    else if (k === 'inc') s.inc += t.amt;
    else if (k === 'inv') s.inv -= t.amt;
  }
  s.saved = s.inc - s.exp; s.rate = s.inc > 0 ? s.saved / s.inc : NaN;
  return s;
}
function monthsWithData() { return [...new Set(db.txns.map(t => ymOf(t.d)))].sort(); }
function latestBal(a) {
  let best = null;
  db.txns.forEach((t, i) => { if (t.a === a.id && t.bal != null && (!best || t.d > best.d || (t.d === best.d && i > best.i))) best = { d: t.d, bal: t.bal, i }; });
  if (a.manualBal != null && (!best || (a.manualAt || '') >= best.d)) return { bal: +a.manualBal, d: a.manualAt || '', manual: true };
  return best ? { bal: best.bal, d: best.d } : null;
}
function avgIncome(n = 3) {
  const end = ymAdd(ymOf(today()), -1);
  let sum = 0, k = 0;
  for (let i = 0; i < n; i++) { const s = monthStats(ymAdd(end, -i)); if (s.n) { sum += s.inc; k++; } }
  return k ? sum / k : 0;
}
function avgSpendByCat(n = 3) {
  const end = ymAdd(ymOf(today()), -1), out = {};
  let k = 0;
  for (let i = 0; i < n; i++) { const s = monthStats(ymAdd(end, -i)); if (!s.n) continue; k++; for (const [c, v] of Object.entries(s.byCat)) out[c] = (out[c] || 0) + v; }
  for (const c in out) out[c] /= Math.max(1, k);
  return out;
}
const openLoans = () => db.loans.filter(l => l.status !== 'closed');
function loanTotals() {
  const open = openLoans(), loans = open.filter(l => !l.isCard), cards = open.filter(l => l.isCard);
  const out = loans.reduce((s, l) => s + (l.outstanding || 0), 0);
  const cardOut = cards.reduce((s, l) => s + (l.outstanding || 0), 0);
  const cardLim = cards.reduce((s, l) => s + (l.limit || l.sanctioned || 0), 0);
  const emi = loans.reduce((s, l) => s + (l.emi || 0), 0);
  const overdue = open.reduce((s, l) => s + (l.overdue || 0), 0);
  return { loans, cards, out, cardOut, cardLim, emi, overdue };
}
function netWorth() {
  let accts = 0;
  for (const a of db.accounts) { if (a.type === 'card' || a.hidden) continue; const b = latestBal(a); if (b) accts += b.bal; }
  const other = db.assets.reduce((s, x) => s + (+x.value || 0), 0);
  const lt = loanTotals();
  const liab = lt.out + lt.cardOut;
  return { accts, other, assets: accts + other, liab, net: accts + other - liab };
}
function emiSeen(l) {
  const word = (l.lender || '').toLowerCase().split(/\s+/).find(w => w.length > 2 && !['bank', 'ltd', 'limited', 'the'].includes(w)) || '';
  const since = ymAdd(ymOf(today()), -6) + '-01';
  const hits = db.txns.filter(t => t.amt < 0 && t.d >= since && (
    (l.emi && Math.abs(-t.amt - l.emi) <= Math.max(2, l.emi * 0.02) && (catOf(t) === 'EMI & loans' || (word && t.desc.toLowerCase().includes(word)))) ||
    (!l.emi && word && catOf(t) === 'EMI & loans' && t.desc.toLowerCase().includes(word))));
  hits.sort((a, b) => a.d < b.d ? 1 : -1);
  return { n: hits.length, last: hits[0]?.d || null };
}

/* ---------- transfers between own accounts ---------- */
function matchTransfers() {
  const credits = db.txns.filter(t => t.amt > 0 && !t.xf && !t.mc && !t.noX);
  let n = 0;
  for (const t of db.txns) {
    if (t.amt >= 0 || t.xf || t.mc || t.noX) continue;
    const c = credits.find(c => !c.xf && c.a !== t.a && Math.abs(c.amt + t.amt) < 0.01 && days(c.d, t.d) <= 2);
    if (!c) continue;
    const ta = acct(t.a)?.type, ca = acct(c.a)?.type;
    const label = ca === 'card' ? 'Credit card bill' : (ca === 'wallet' || ta === 'wallet') ? 'Wallet top-up' : 'Self transfer';
    t.xf = c.xf = label; t.pair = c.id; c.pair = t.id; n++;
  }
  return n;
}

/* ---------- lock screen ---------- */
async function showLock() {
  $('#app').hidden = true; closeSheet();
  const L = $('#lock'); L.hidden = false;
  const exists = await Store.exists();
  L.innerHTML = `<form class="box" id="lockForm" autocomplete="off">
    <div class="logo">₹</div><h1>Paisa Desk</h1>
    ${exists ? `<p>Enter your passcode to open your money data.</p>
      <input type="password" id="p1" placeholder="Passcode" autofocus inputmode="text" autocomplete="current-password">
      <button class="btn pri">Unlock</button>
      <div class="err" id="err"></div>
      <div class="fine"><button type="button" class="link" style="color:#fff;opacity:.75" id="forgot">Forgot passcode?</button></div>`
    : `<p>Set a passcode. Your statements are read and stored only on this device, encrypted with this passcode.</p>
      <input type="password" id="p1" placeholder="New passcode (6+ characters)" autocomplete="new-password">
      <input type="password" id="p2" placeholder="Repeat passcode" autocomplete="new-password">
      <button class="btn pri">Create</button>
      <div class="err" id="err"></div>
      <div class="fine">There is no recovery: if you forget the passcode, the data cannot be opened. Keep an encrypted backup from Settings.<br>
      <button type="button" class="link" style="color:#fff" id="restoreFirst">Restore a backup from another device</button>
      <input type="file" id="restoreFile" accept=".json,application/json" hidden></div>`}
  </form>`;
  const err = m => $('#err').textContent = m;
  $('#lockForm').onsubmit = async e => {
    e.preventDefault();
    const p1 = $('#p1').value;
    try {
      if (exists) { err('Opening…'); db = await Store.unlock(p1); }
      else {
        if (p1.length < 6) return err('Use at least 6 characters.');
        if (p1 !== $('#p2').value) return err('The two passcodes do not match.');
        db = newDb(); await Store.create(p1, db);
      }
      start();
    } catch (ex) { err(exists ? 'Wrong passcode.' : 'Could not create: ' + ex.message); }
  };
  if (exists) $('#forgot').onclick = async () => {
    if (!confirm('Without the passcode the data cannot be opened. Erase everything on this device and start again? (A backup file can be restored later with its own passcode.)')) return;
    await Store.wipe(); showLock();
  };
  else {
    $('#restoreFirst').onclick = () => $('#restoreFile').click();
    $('#restoreFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const vault = JSON.parse(await f.text());
        const pass = prompt('Passcode of this backup (it becomes the passcode on this device):');
        if (pass == null) return;
        db = await Store.readBackup(vault, async () => pass);
        await Store.create(pass, db);
        start(); toast('Backup restored');
      } catch (ex) { err(/decrypt|operation/i.test(ex.message + ex.name) ? 'Wrong passcode for that backup.' : ex.message); }
    };
  }
  if (!isInstalled()) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.id = 'installBtn';
    b.style.cssText = 'margin-top:18px;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.35)';
    b.textContent = '📲 Install on this phone';
    b.onclick = installApp;
    $('#lockForm').appendChild(b);
  }
  setTimeout(() => $('#p1')?.focus(), 50);
}

/* ---------- install ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installEvt = null; $('#installBtn')?.remove(); toast('Installed. Open Paisa Desk from your home screen.'); });
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function installApp() {
  if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice; if (r.outcome === 'accepted') installEvt = null; return; }
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const inApp = /; wv\)|FBAN|FBAV|Instagram|Line\/|GSA\/|WhatsApp|LinkedInApp|Twitter/i.test(ua) || (ios && !/Safari\//.test(ua)) || (ios && /CriOS|FxiOS|EdgiOS/.test(ua));
  const link = location.href.split('#')[0];
  let steps;
  if (inApp && !ios) steps = `<p>This page is open inside another app (Gmail, WhatsApp…), which can't install apps.</p>
    <ol><li>Tap <b>⋮</b> (top right) → <b>Open in Chrome</b>.<br><span class="tiny muted">Or copy the link below and paste it in Chrome.</span></li><li>In Chrome tap <b>⋮</b> → <b>Install app</b> (or <b>Add to Home screen</b> → <b>Install</b>).</li></ol>`;
  else if (ios && (inApp || !/Safari\//.test(ua) || /CriOS|FxiOS|EdgiOS/.test(ua))) steps = `<p>On iPhone, only <b>Safari</b> can add apps to the home screen.</p>
    <ol><li>Copy the link below and open it in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with ↑ arrow at the bottom).</li><li>Scroll down, tap <b>Add to Home Screen</b> → <b>Add</b>.</li></ol>`;
  else if (ios) steps = `<ol><li>Tap the <b>Share</b> button (square with ↑ arrow, bottom bar of Safari).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Paisa Desk appears on your home screen.</li></ol>`;
  else steps = `<ol><li>Tap Chrome's <b>⋮</b> menu (top right).</li><li>Tap <b>Install app</b>. If you only see <b>Add to Home screen</b>, tap it, then <b>Install</b>.</li><li>Open Paisa Desk from your home screen or app drawer.</li></ol>
    <p class="tiny muted">Not in the menu? Make sure this is Chrome (not the Gmail/WhatsApp viewer), then reload the page once and try again.</p>`;
  openSheet(`<h3>📲 Install Paisa Desk</h3>${steps}
    <label class="f">App link</label><div class="row"><input type="text" readonly value="${esc(link)}" id="instLink"><button class="btn sm" id="copyLink">Copy</button></div>
    <div class="row" style="margin-top:14px"><span class="grow"></span><button class="btn pri" data-act="close">OK</button></div>`);
  $('#copyLink').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { $('#instLink').select(); } };
}
function lockNow() { Store.lock(); db = null; ui.pending = []; showLock(); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) ui.lockedAt = Date.now();
  else if (db && ui.lockedAt && Date.now() - ui.lockedAt > 3 * 60 * 1000) lockNow();
});

async function start() {
  migrate();
  $('#lock').hidden = true; $('#lock').innerHTML = ''; $('#app').hidden = false;
  const h = location.hash.slice(1);
  if (['home', 'spends', 'import', 'loans', 'plan'].includes(h)) ui.tab = h;
  const shared = await Store.takeShared().catch(() => []);
  if (shared.length) { ui.tab = 'import'; render(); handleFiles(shared); } else render();
}
function migrate() {
  const d = newDb();
  for (const k of Object.keys(d)) if (db[k] == null) db[k] = d[k];
}

/* ---------- render ---------- */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const v = $('#view');
  v.innerHTML = ({ home: viewHome, spends: viewSpends, import: viewImport, loans: viewLoans, plan: viewPlan })[ui.tab]();
  if (ui.tab === 'import') bindImport();
}
function go(tab) { ui.tab = tab; history.replaceState(null, '', '#' + tab); render(); window.scrollTo(0, 0); }

function monthBar() {
  return `<div class="month"><button data-act="mPrev" aria-label="Previous month">‹</button><b>${ymLabel(ui.month)}</b><button data-act="mNext" aria-label="Next month">›</button></div>`;
}

function viewHome() {
  if (!db.txns.length && !db.loans.length) return `
    <div class="card empty"><div class="big">📥</div><h3>Start by importing a statement</h3>
    <p class="small">Bank statements (PDF or Excel), Paytm statement, and your CIBIL report PDF. They are read on this device; nothing is uploaded.</p>
    <button class="btn pri" data-act="go" data-tab="import">Import statements</button></div>`;
  const s = monthStats(ui.month), prev = monthStats(ymAdd(ui.month, -1)), nw = netWorth();
  const delta = prev.exp ? (s.exp - prev.exp) / prev.exp : NaN;
  const cats = Object.entries(s.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const maxC = cats[0]?.[1] || 1;
  return `${monthBar()}
  <div class="tiles">
    <div class="tile"><div class="k">Spent</div><div class="v num">${inrC(s.exp)}</div><div class="s">${isFinite(delta) ? `${delta > 0 ? '▲' : '▼'} ${pct(Math.abs(delta))} vs ${ymLabel(ymAdd(ui.month, -1), 1)}` : '&nbsp;'}</div></div>
    <div class="tile"><div class="k">Income</div><div class="v num">${inrC(s.inc)}</div><div class="s">${s.inv > 0 ? `${inrC(s.inv)} invested` : '&nbsp;'}</div></div>
    <div class="tile"><div class="k">Saved</div><div class="v num">${inrC(s.saved)}</div><div class="s">${isFinite(s.rate) ? `${pct(s.rate)} of income` : '&nbsp;'}</div></div>
    <div class="tile" data-act="go" data-tab="plan" style="cursor:pointer"><div class="k">Net worth</div><div class="v num">${inrC(nw.net)}</div><div class="s">${inrC(nw.liab)} owed</div></div>
  </div>
  ${alerts(s)}
  <div class="card chart"><div class="row between"><h3>Money in and out</h3><span class="tiny muted">last 12 months, ₹</span></div>
    <div class="legend"><span><i style="background:var(--in)"></i>Income</span><span><i style="background:var(--out)"></i>Spent</span></div>
    ${cashflowChart()}</div>
  <div class="card"><div class="row between"><h3>Where it went · ${ymLabel(ui.month, 1)}</h3><span class="tiny muted">${s.n} entries</span></div>
    ${cats.length ? cats.map(([c, v]) => `<button class="catrow" data-act="filterCat" data-cat="${esc(c)}"><span>${Cat.ICON[c] || '•'}</span><span class="ellip">${esc(c)} <span class="muted tiny">${pct(v / s.exp)}</span></span><b class="num">${inr(v)}</b><div class="bar"><i style="width:${(v / maxC * 100).toFixed(1)}%"></i></div></button>`).join('') : '<p class="muted small">No spending recorded for this month.</p>'}
  </div>`;
}

function alerts(s) {
  const out = [];
  const isNow = ui.month === ymOf(today());
  const dayFrac = isNow ? new Date().getDate() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() : 1;
  for (const [c, b] of Object.entries(db.budgets)) {
    if (!b) continue;
    const sp = s.byCat[c] || 0;
    if (sp > b) out.push(['bad', '⛔', `<b>${esc(c)}</b> is over budget: ${inr(sp)} of ${inr(b)} (${pct(sp / b)}).`]);
    else if (isNow && sp > b * 0.5 && sp / b > dayFrac + 0.15) out.push(['warn', '⚠️', `<b>${esc(c)}</b> is running fast: ${pct(sp / b)} of budget used, ${pct(dayFrac)} of the month gone.`]);
  }
  const lt = loanTotals();
  if (lt.overdue > 0) out.push(['bad', '🏦', `Loans show <b>${inr(lt.overdue)} overdue</b> in your CIBIL report. Clear it to protect your score.`]);
  if (lt.cardLim && lt.cardOut / lt.cardLim > 0.3) out.push(['warn', '💳', `Credit card use is ${pct(lt.cardOut / lt.cardLim)} of the limit. Under 30% is better for your score.`]);
  const unc = db.txns.filter(t => t.d.startsWith(ui.month) && catOf(t) === 'Others').length;
  if (unc >= 5) out.push(['info', '🏷️', `${unc} entries this month are in "Others". <button class="link" data-act="filterCat" data-cat="Others">Sort them</button> and the app will remember each merchant.`]);
  const guessN = db.txns.filter(t => t.guess).length;
  if (guessN) out.push(['info', '❔', `${guessN} entries had no clear debit/credit mark and were taken as money out. <button class="link" data-act="showGuess">Check them</button>.`]);
  return out.map(([k, i, h]) => `<div class="alert ${k}"><span class="ic">${i}</span><div>${h}</div></div>`).join('');
}

function cashflowChart() {
  const months = []; for (let i = 11; i >= 0; i--) months.push(ymAdd(ui.month, -i));
  const data = months.map(m => ({ m, ...monthStats(m) }));
  const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));
  const W = 360, H = 150, pb = 18, bw = 9, gap = 2, step = W / 12;
  const y = v => (H - pb) * (1 - v / max);
  const bar = (x, v, col) => { const h = (H - pb) - y(v); if (h <= 0.5) return ''; const r = Math.min(4, h, bw / 2); const top = y(v); return `<path d="M${x},${H - pb} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - pb} Z" fill="${col}"/>`; };
  let g = '';
  data.forEach((d, i) => {
    const cx = i * step + step / 2;
    const tip = `${ymLabel(d.m)} · In ${inr(d.inc)} · Spent ${inr(d.exp)} · Saved ${inr(d.saved)}`;
    g += `<g data-tip="${esc(tip)}" data-act="pickMonth" data-m="${d.m}" style="cursor:pointer"><rect x="${i * step}" y="0" width="${step}" height="${H}" fill="transparent"/>`;
    g += bar(cx - bw - gap / 2, d.inc, 'var(--in)') + bar(cx + gap / 2, d.exp, 'var(--out)');
    g += `<text class="ax" x="${cx}" y="${H - 4}" text-anchor="middle" ${d.m === ui.month ? 'style="font-weight:700;fill:var(--ink)"' : ''}>${MN[+d.m.slice(5) - 1].slice(0, 3)}</text></g>`;
  });
  g += `<line x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}" stroke="var(--line)"/>`;
  g += `<text class="ax" x="0" y="9">${inrC(max)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly income and spending">${g}</svg>`;
}

/* ---------- spends ---------- */
function filteredTxns() {
  const f = ui.f, q = f.q.trim().toLowerCase();
  return db.txns.filter(t => {
    if (f.month && !t.d.startsWith(f.month)) return false;
    if (f.acct && t.a !== f.acct) return false;
    if (f.cat && catOf(t) !== f.cat) return false;
    if (f.type === 'out' && kindOf(t) !== 'exp') return false;
    if (f.type === 'in' && kindOf(t) !== 'inc') return false;
    if (f.type === 'xfer' && !['xfer', 'inv'].includes(kindOf(t))) return false;
    if (f.type === 'guess' && !t.guess) return false;
    if (q && !(`${t.desc} ${t.m} ${t.note || ''} ${t.pdesc || ''} ${Math.abs(t.amt)}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
}
function viewSpends() {
  if (!db.txns.length) return `<div class="card empty"><div class="big">📋</div><p>No transactions yet.</p><button class="btn pri" data-act="go" data-tab="import">Import a statement</button></div>`;
  const f = ui.f, list = filteredTxns();
  const out = list.filter(t => kindOf(t) === 'exp').reduce((s, t) => s - t.amt, 0);
  const inn = list.filter(t => kindOf(t) === 'inc').reduce((s, t) => s + t.amt, 0);
  const months = monthsWithData().reverse();
  let html = `<div class="filters">
    <input type="search" id="fq" placeholder="Search merchant, note or amount" value="${esc(f.q)}">
    <div class="grid3">
      <select id="fm"><option value="">All months</option>${months.map(m => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${ymLabel(m)}</option>`).join('')}</select>
      <select id="fa"><option value="">All accounts</option>${db.accounts.map(a => `<option value="${a.id}" ${f.acct === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <select id="fc"><option value="">All categories</option>${Cat.names.map(c => `<option ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    </div>
    <div class="chips">${[['', 'All'], ['out', 'Spending'], ['in', 'Income'], ['xfer', 'Transfers & investing'], ['guess', 'Check sign']].map(([k, l]) => `<button class="chip ${f.type === k ? 'on' : ''}" data-act="fType" data-t="${k}">${l}</button>`).join('')}</div>
  </div>
  <div class="sumbar"><span>${list.length} entries</span><span>Spent <b class="num">${inr(out)}</b></span><span>Income <b class="num">${inr(inn)}</b></span>
  ${f.q || f.month || f.acct || f.cat || f.type ? '<button class="link" data-act="fClear">Clear filters</button>' : ''}</div>`;
  let lastD = '';
  const shown = list.slice(0, ui.limit);
  const dayTot = {};
  for (const t of list) if (kindOf(t) === 'exp') dayTot[t.d] = (dayTot[t.d] || 0) - t.amt;
  for (const t of shown) {
    if (t.d !== lastD) { html += `<div class="day"><span>${dmy(t.d)}</span><span class="num">${dayTot[t.d] ? 'spent ' + inr(dayTot[t.d]) : ''}</span></div>`; lastD = t.d; }
    html += txRow(t);
  }
  if (list.length > shown.length) html += `<button class="btn block" data-act="more">Show ${Math.min(150, list.length - shown.length)} more</button>`;
  if (!list.length) html += '<div class="empty">Nothing matches these filters.</div>';
  setTimeout(bindSpendFilters);
  return html;
}
function txRow(t) {
  const c = catOf(t), k = kindOf(t), a = acct(t.a);
  const cls = k === 'inc' ? 'in' : (k === 'xfer' ? 'x' : '');
  return `<button class="tx" data-act="tx" data-id="${t.id}"><span class="ic">${Cat.ICON[c] || '•'}</span>
    <span class="grow"><span class="m ellip" style="display:block">${esc(t.m)}</span><span class="d ellip" style="display:block">${esc(c)} · ${esc(a?.name || '')}${t.guess ? ' · <b style="color:var(--warn)">sign?</b>' : ''}${t.note ? ' · ' + esc(t.note) : ''}</span></span>
    <span class="a num ${cls}">${t.amt > 0 ? '+' : '−'}${inr(Math.abs(t.amt), Math.abs(t.amt) % 1 ? 2 : 0).replace('−', '')}</span></button>`;
}
function bindSpendFilters() {
  const q = $('#fq'); if (!q) return;
  q.oninput = () => { ui.f.q = q.value; ui.limit = 150; const pos = q.selectionStart; render(); const n = $('#fq'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#fm').onchange = e => { ui.f.month = e.target.value; ui.limit = 150; render(); };
  $('#fa').onchange = e => { ui.f.acct = e.target.value; ui.limit = 150; render(); };
  $('#fc').onchange = e => { ui.f.cat = e.target.value; ui.limit = 150; render(); };
}

function txSheet(id) {
  const t = db.txns.find(x => x.id === id); if (!t) return;
  const c = catOf(t), a = acct(t.a);
  const pair = t.pair ? db.txns.find(x => x.id === t.pair) : null;
  openSheet(`<h3>${esc(t.m)}</h3>
    <div class="row between"><span class="muted small">${dmy(t.d)} · ${esc(a?.name || '')}</span><b class="num" style="font-size:20px">${t.amt > 0 ? '+' : '−'}${inr(Math.abs(t.amt), 2).replace('−', '')}</b></div>
    <p class="small" style="word-break:break-word;background:var(--bg);padding:8px 10px;border-radius:10px">${esc(t.desc)}${t.pdesc ? `<br><span class="muted">Paytm: ${esc(t.pdesc)}</span>` : ''}${t.bal != null ? `<br><span class="muted">Balance after: ${inr(t.bal, 2)}</span>` : ''}</p>
    ${t.guess ? `<div class="alert warn"><span class="ic">❔</span><div>The statement did not show whether this was money in or out; it was taken as <b>${t.amt < 0 ? 'out' : 'in'}</b>. <button class="link" data-act="flipSign" data-id="${t.id}">Switch to money ${t.amt < 0 ? 'in' : 'out'}</button> · <button class="link" data-act="okSign" data-id="${t.id}">It's right</button></div></div>` : ''}
    ${pair ? `<div class="alert info"><span class="ic">🔁</span><div>Matched as ${esc(t.xf)} with ${esc(acct(pair.a)?.name || '')} on ${dmy(pair.d)}. It is left out of income and spending. <button class="link" data-act="unpair" data-id="${t.id}">Not a transfer</button></div></div>` : ''}
    <label class="f">Merchant name</label><input type="text" id="txM" value="${esc(t.m)}">
    <label class="f">Category</label>
    <div class="catgrid">${Cat.LIST.filter(([, k]) => t.amt < 0 ? k !== 'inc' || true : true).map(([n, , i]) => `<button class="${n === c ? 'on' : ''}" data-act="setCat" data-cat="${esc(n)}">${i} ${esc(n)}</button>`).join('')}</div>
    <label class="switch"><input type="checkbox" id="txAll" checked> Use this category for every entry from “${esc(t.m)}”</label>
    <label class="f">Note</label><input type="text" id="txNote" value="${esc(t.note || '')}" placeholder="e.g. Diwali gifts">
    <div class="row" style="margin-top:14px"><button class="btn danger" data-act="delTx" data-id="${t.id}">Delete</button><span class="grow"></span><button class="btn pri" data-act="saveTx" data-id="${t.id}">Done</button></div>`);
  ui.txCat = null;
}
function saveTxSheet(id) {
  const t = db.txns.find(x => x.id === id); if (!t) return;
  const newM = $('#txM').value.trim() || t.m;
  if (newM !== t.m) t.m = newM;
  t.note = $('#txNote').value.trim();
  if (ui.txCat) {
    if ($('#txAll').checked) {
      db.rules[Cat.key(t.m)] = ui.txCat;
      const n = db.txns.filter(x => Cat.key(x.m) === Cat.key(t.m)).length;
      t.mc = null;
      if (n > 1) toast(`${n} entries from ${t.m} now in ${ui.txCat}`);
    } else t.mc = ui.txCat;
  }
  save(); closeSheet(); render();
}

/* ---------- import ---------- */
function viewImport() {
  const hist = db.imports.slice(0, 30);
  return `<h2>Import statements</h2>
  <div class="drop" id="drop">
    <div class="big">📄</div>
    <p style="margin:6px 0 12px"><b>PDF, Excel or CSV</b> from your bank, Paytm, or the CIBIL report PDF.</p>
    <button class="btn pri" id="pick">Choose files</button>
    <input type="file" id="files" multiple accept=".pdf,.xlsx,.xls,.csv,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
    <p class="tiny muted" style="margin:12px 0 0">Read on this device only, nothing is uploaded. On Android you can also use <b>Share → Paisa Desk</b> on a statement in Gmail or Files.</p>
  </div>
  <div id="pending">${ui.pending.map(pendingCard).join('')}</div>
  ${hist.length ? `<h2>Imported so far</h2><div class="card">${hist.map(h => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
    <div class="grow"><div class="ellip"><b>${esc(h.file)}</b></div><div class="tiny muted">${h.kind === 'cibil' ? `CIBIL · ${h.added} accounts` : `${dmy(h.from)} – ${dmy(h.to)} · ${h.added} added${h.merged ? `, ${h.merged} matched with Paytm` : ''}${h.skipped ? `, ${h.skipped} already there` : ''}`}</div></div>
    ${h.kind !== 'cibil' ? `<button class="btn sm" data-act="undoImp" data-id="${h.id}">Remove</button>` : ''}</div>`).join('')}</div>` : ''}
  <div class="card small muted"><b>Tips.</b> Excel/CSV downloads from net banking read most reliably. Locked PDFs ask for their password here; it is used only to open the file and is not saved. Importing the same statement twice is safe: repeats are skipped. Paytm entries paid from a linked bank account are matched to that bank's entries, not counted twice.</div>`;
}
function bindImport() {
  const inp = $('#files'), drop = $('#drop');
  $('#pick').onclick = () => inp.click();
  inp.onchange = () => { handleFiles([...inp.files]); inp.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); };
}
function refreshPending() { const p = $('#pending'); if (p) p.innerHTML = ui.pending.map(pendingCard).join(''); }

function askPdfPassword(name, wrong) {
  return new Promise(res => {
    openSheet(`<h3>🔐 ${esc(name)} is locked</h3>
      <p class="small muted">${wrong ? '<b style="color:var(--bad)">That password did not work.</b> ' : ''}Banks usually use something like your customer ID, date of birth (DDMMYYYY) or the first letters of your name plus DOB. It opens the file on this device and is not saved.</p>
      <form id="pwF"><input type="password" id="pdfPw" placeholder="PDF password" autocomplete="off">
      <div class="row" style="margin-top:12px"><button type="button" class="btn" id="pwSkip">Skip file</button><span class="grow"></span><button class="btn pri">Open</button></div></form>`, () => res(null));
    setTimeout(() => $('#pdfPw')?.focus(), 50);
    $('#pwF').onsubmit = e => { e.preventDefault(); const v = $('#pdfPw').value; closeSheet(true); res(v); };
    $('#pwSkip').onclick = () => { closeSheet(true); res(null); };
  });
}

async function handleFiles(files) {
  for (const f of files) {
    const p = { id: uid(), name: f.name, status: 'reading' };
    ui.pending.push(p); refreshPending();
    try {
      const res = await Parse.file(f, askPdfPassword);
      p.res = res;
      if (res.kind === 'cibil') { p.cibil = Cibil.read(res.lines); delete res.lines; }
      else setupMapping(p);
      p.status = 'ready';
    } catch (e) { p.status = 'error'; p.err = e.message || String(e); console.error(e); }
    refreshPending();
  }
}
function setupMapping(p) {
  const res = p.res, groups = {};
  for (const r of res.rows) (groups[r.acctHint || ''] ||= []).push(r);
  p.map = {};
  for (const hint of Object.keys(groups)) {
    // Paytm shows linked banks as "HDFC Bank - 34" (last 2-4 digits).
    const digits = hint ? ((hint.match(/(\d{2,4})\D*$/) || [])[1] || '') : res.meta.last4;
    const isWallet = /wallet/i.test(hint) || (res.kind === 'paytm' && !hint);
    const hintBank = hint.replace(/[-–:]?\s*[xX*•\d\s-]*$/, '').trim().toLowerCase();
    let found = null;
    if (isWallet) found = db.accounts.find(a => a.type === 'wallet' && /paytm/i.test(a.name));
    else if (digits) found = db.accounts.find(a => a.last4 && a.last4.endsWith(digits) && (!hintBank || !a.bank || a.bank.toLowerCase().includes(hintBank.split(' ')[0])));
    if (!found && !hint && !digits && res.meta.bank) found = db.accounts.find(a => a.bank === res.meta.bank);
    const bank = isWallet ? 'Paytm' : (hint.replace(/[-–]?\s*[xX*•\d\s-]{4,}$/, '').trim() || res.meta.bank || 'Bank');
    const type = isWallet ? 'wallet' : res.kind === 'card' ? 'card' : 'bank';
    const name = isWallet ? 'Paytm Wallet' : `${bank}${digits ? ' ••' + digits : ''}${type === 'card' ? ' card' : ''}`;
    p.map[hint] = { to: found ? found.id : 'new', name, type, last4: digits || '', bank, n: groups[hint].length };
  }
}
function pendingCard(p) {
  if (p.status === 'reading') return `<div class="card"><b>${esc(p.name)}</b><div class="muted small">Reading…</div></div>`;
  if (p.status === 'error') return `<div class="card"><div class="row between"><b class="ellip">${esc(p.name)}</b><button class="btn sm" data-act="dropPend" data-id="${p.id}">Dismiss</button></div><div class="alert bad" style="margin:8px 0 0"><span class="ic">⚠️</span><div class="small">${esc(p.err)}</div></div></div>`;
  if (p.status === 'done') return '';
  if (p.cibil) {
    const c = p.cibil;
    return `<div class="card prev"><div class="row between"><b class="ellip">${esc(p.name)}</b><span class="pill info">CIBIL report</span></div>
      <dl class="kv" style="margin-top:8px"><dt>CIBIL score</dt><dd>${c.score ?? 'not found'}</dd><dt>Report date</dt><dd>${dmy(c.reportDate)}</dd><dt>Accounts found</dt><dd>${c.loans.length}</dd></dl>
      ${c.loans.length ? `<div class="tbl-wrap"><table><tr class="muted"><td>Lender</td><td>Type</td><td class="r">Outstanding</td><td class="r">EMI</td></tr>${c.loans.map(l => `<tr><td>${esc(l.lender)}</td><td>${esc(l.type)}${l.status === 'closed' ? ' <span class="pill">closed</span>' : ''}</td><td class="r num">${l.outstanding != null ? inr(l.outstanding) : '–'}</td><td class="r num">${l.emi ? inr(l.emi) : '–'}</td></tr>`).join('')}</table></div>`
        : '<p class="small muted">No loan accounts could be read from this layout. You can still save the score and add loans by hand in the Loans tab.</p>'}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="dropPend" data-id="${p.id}">Discard</button><span class="grow"></span><button class="btn pri" data-act="saveCibil" data-id="${p.id}">Save to Loans</button></div></div>`;
  }
  const r = p.res, m = r.meta, rows = r.rows;
  const inn = rows.filter(x => x.amt > 0).reduce((s, x) => s + x.amt, 0), out = rows.filter(x => x.amt < 0).reduce((s, x) => s - x.amt, 0);
  const rc = m.recon || { ok: 0, bad: 0 };
  const recon = rc.ok + rc.bad === 0 ? '<span class="pill">no running balance</span>' : rc.bad === 0 ? `<span class="pill good">✓ balances tie (${rc.ok})</span>` : `<span class="pill ${rc.bad / (rc.ok + rc.bad) > 0.1 ? 'bad' : 'warn'}">${rc.bad} of ${rc.ok + rc.bad} rows don't tie</span>`;
  const guesses = rows.filter(x => x.guess).length;
  const label = { paytm: 'Paytm', card: 'Credit card', bank: 'Bank' }[r.kind] || 'Statement';
  return `<div class="card prev"><div class="row between"><b class="ellip">${esc(p.name)}</b><span class="pill info">${label} · ${esc(m.format)}</span></div>
    <dl class="kv" style="margin-top:8px"><dt>Period</dt><dd>${dmy(m.from)} – ${dmy(m.to)}</dd><dt>Entries</dt><dd>${rows.length}</dd>
    <dt>Money in</dt><dd class="num">${inr(inn, 2)}</dd><dt>Money out</dt><dd class="num">${inr(out, 2)}</dd>
    ${m.closing != null ? `<dt>Closing balance</dt><dd class="num">${inr(m.closing, 2)}</dd>` : ''}<dt>Check</dt><dd>${recon}</dd></dl>
    ${guesses ? `<div class="alert warn small" style="margin-top:8px"><span class="ic">❔</span><div>${guesses} entries had no debit/credit mark and are taken as money out. You can fix them later under Spends → Check sign.</div></div>` : ''}
    ${Object.entries(p.map).map(([hint, mp]) => `<label class="f">${hint ? `Entries paid from “${esc(hint)}” (${mp.n})` : 'Save to account'}</label>
      <select data-act="mapSel" data-id="${p.id}" data-hint="${esc(hint)}">${db.accounts.map(a => `<option value="${a.id}" ${mp.to === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="new" ${mp.to === 'new' ? 'selected' : ''}>＋ New account: ${esc(mp.name)}</option></select>
      ${mp.to === 'new' ? `<div class="grid2" style="margin-top:6px"><input type="text" data-act="mapName" data-id="${p.id}" data-hint="${esc(hint)}" value="${esc(mp.name)}" aria-label="New account name">
      <select data-act="mapType" data-id="${p.id}" data-hint="${esc(hint)}">${[['bank', 'Bank account'], ['wallet', 'Wallet'], ['card', 'Credit card'], ['cash', 'Cash']].map(([v, l]) => `<option value="${v}" ${mp.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}`).join('')}
    <div class="tbl-wrap"><table>${rows.slice(0, 6).map(x => `<tr><td style="white-space:nowrap">${dmy(x.date).slice(0, -5)}</td><td>${esc(x.desc.slice(0, 60))}</td><td class="r num" style="color:${x.amt > 0 ? 'var(--good)' : 'inherit'}">${x.amt > 0 ? '+' : ''}${inr(x.amt, 2)}</td></tr>`).join('')}
    ${rows.length > 6 ? `<tr><td colspan="3" class="muted">…and ${rows.length - 6} more</td></tr>` : ''}</table></div>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="dropPend" data-id="${p.id}">Discard</button><span class="grow"></span><button class="btn pri" data-act="commit" data-id="${p.id}">Import ${rows.length}</button></div></div>`;
}
const normDesc = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
function commitImport(p) {
  const res = p.res, impId = uid(), src = res.kind === 'paytm' ? 'paytm' : 'stmt';
  const target = {};
  for (const [hint, mp] of Object.entries(p.map)) {
    if (mp.to === 'new') {
      const a = { id: uid(), name: mp.name.trim() || 'Account', type: mp.type, last4: mp.last4, bank: mp.bank };
      db.accounts.push(a); target[hint] = a.id; mp.to = a.id;
    } else target[hint] = mp.to;
  }
  const sigs = new Set(db.txns.map(t => `${t.a}|${t.d}|${t.amt}|${normDesc(t.src === 'paytm' ? t.desc : t.desc)}|${t.bal ?? ''}`));
  let added = 0, merged = 0, skipped = 0;
  const used = new Set();
  for (const r of res.rows) {
    const a = target[r.acctHint || ''];
    const sig = `${a}|${r.date}|${r.amt}|${normDesc(r.desc)}|${r.bal ?? ''}`;
    if (sigs.has(sig)) { skipped++; continue; }
    sigs.add(sig);
    const ref = r.ref || Parse.refOf(r.desc);
    // Same payment seen from the other side (Paytm app vs bank statement) on the same account.
    let cand = db.txns.filter(t => t.a === a && t.src !== src && !used.has(t.id) && Math.abs(t.amt - r.amt) < 0.01 && days(t.d, r.date) <= 1);
    if (ref) { const byRef = cand.filter(t => t.ref === ref || t.desc.includes(ref)); if (byRef.length) cand = byRef; else if (cand.some(t => t.ref)) cand = []; }
    if (cand.length === 1) {
      const t = cand[0]; used.add(t.id);
      if (src === 'stmt') { t.pdesc = t.desc; t.desc = r.desc; t.bal = r.bal; t.d = r.date; t.src = 'stmt'; }
      else { t.pdesc = r.desc; t.m = Cat.merchant(r.desc) || t.m; t.tags = r.tags || t.tags; }
      if (!t.mc) t.cat = Cat.guess(`${t.desc} ${t.pdesc}`, t.amt, t.tags);
      t.guess = false;
      merged++; continue;
    }
    db.txns.push({ id: uid(), a, d: r.date, desc: r.desc, m: Cat.merchant(r.desc), amt: r.amt, bal: r.bal, ref, cat: Cat.guess(r.desc, r.amt, r.tags), tags: r.tags || '', src, imp: impId, guess: !!r.guess });
    added++;
  }
  const xf = matchTransfers();
  db.imports.unshift({ id: impId, file: p.name, at: today(), kind: res.kind, added, merged, skipped, from: res.meta.from, to: res.meta.to });
  p.status = 'done';
  ui.pending = ui.pending.filter(x => x !== p);
  // Accounts just created may be the right home for files still waiting (e.g. Paytm's "HDFC Bank - 34").
  for (const q of ui.pending) if (q.status === 'ready' && q.map && Object.values(q.map).every(m => m.to === 'new')) setupMapping(q);
  if (res.meta.to) ui.month = ymOf(res.meta.to);
  save(); render();
  toast(`${added} added${merged ? `, ${merged} matched` : ''}${skipped ? `, ${skipped} already there` : ''}${xf ? `, ${xf} transfers paired` : ''}`, 4000);
}
function saveCibil(p) {
  const c = p.cibil, at = c.reportDate || today();
  if (c.score) { db.cibil.score = c.score; db.cibil.date = at; db.cibil.history = db.cibil.history.filter(h => h.date !== at); db.cibil.history.push({ date: at, score: c.score }); db.cibil.history.sort((a, b) => a.date < b.date ? -1 : 1); }
  const k = l => `${(l.lender || '').toLowerCase().replace(/[^a-z]/g, '')}|${(l.acct || '').replace(/\D/g, '').slice(-4)}|${(l.type || '').toLowerCase()}`;
  let n = 0;
  for (const l of c.loans) {
    const ex = db.loans.find(x => k(x) === k(l));
    if (ex) { for (const f of Object.keys(l)) if (l[f] != null && l[f] !== '') ex[f] = l[f]; ex.at = at; }
    else db.loans.push({ id: uid(), ...l, at, src: 'cibil' });
    n++;
  }
  db.imports.unshift({ id: uid(), file: p.name, at: today(), kind: 'cibil', added: n });
  ui.pending = ui.pending.filter(x => x !== p);
  save(); go('loans'); toast(`CIBIL saved: ${c.score ? 'score ' + c.score + ', ' : ''}${n} accounts`);
}

/* ---------- loans ---------- */
function viewLoans() {
  const lt = loanTotals(), c = db.cibil, inc = avgIncome();
  const foir = inc ? lt.emi / inc : NaN;
  const hist = c.history || [];
  const prev = hist.length > 1 ? hist[hist.length - 2].score : null;
  const sc = c.score, band = !sc ? '' : sc >= 750 ? 'good' : sc >= 650 ? 'warn' : 'bad';
  const bandTxt = !sc ? '' : sc >= 750 ? 'Good' : sc >= 650 ? 'Fair' : 'Needs work';
  const deg = sc ? Math.round((sc - 300) / 600 * 360) : 0;
  const closed = db.loans.filter(l => l.status === 'closed');
  return `<div class="card score">
      <div class="gauge" style="background:conic-gradient(var(--${band || 'line'}) ${deg}deg, var(--line) 0)"><div style="background:var(--card);width:74px;height:74px;border-radius:50%;display:grid;place-items:center"><div><b>${sc ?? '–'}</b><span>CIBIL</span></div></div></div>
      <div class="grow">${sc ? `<div><span class="pill ${band}">${bandTxt}</span> ${prev ? `<span class="small muted">${sc >= prev ? '▲' : '▼'} ${Math.abs(sc - prev)} since ${dmy(hist[hist.length - 2].date)}</span>` : ''}</div>
        <div class="small muted" style="margin-top:6px">From report dated ${dmy(c.date)}. Score range 300–900; 750+ gets the best loan rates.</div>`
        : `<div class="small">No CIBIL report yet. Download it free once a year from the CIBIL website (or your bank / Paytm app), then import the PDF here.</div><button class="btn sm" style="margin-top:8px" data-act="go" data-tab="import">Import CIBIL PDF</button>`}</div></div>
    <div class="tiles">
      <div class="tile"><div class="k">Loans outstanding</div><div class="v num">${inrC(lt.out)}</div><div class="s">${lt.loans.length} open loan${lt.loans.length === 1 ? "" : "s"}</div></div>
      <div class="tile"><div class="k">EMI per month</div><div class="v num">${inrC(lt.emi)}</div><div class="s">${isFinite(foir) ? `${pct(foir)} of income` : 'add income to compare'}</div></div>
      <div class="tile"><div class="k">Card balances</div><div class="v num">${inrC(lt.cardOut)}</div><div class="s">${lt.cardLim ? `${pct(lt.cardOut / lt.cardLim)} of ${inrC(lt.cardLim)} limit` : '&nbsp;'}</div></div>
      <div class="tile"><div class="k">Overdue</div><div class="v num" style="color:${lt.overdue ? 'var(--bad)' : 'inherit'}">${inrC(lt.overdue)}</div><div class="s">${lt.overdue ? 'pay this first' : 'nothing overdue'}</div></div>
    </div>
    ${isFinite(foir) && foir > 0.5 ? `<div class="alert bad"><span class="ic">⚠️</span><div>EMIs take ${pct(foir)} of your income. Lenders usually want this under 50%.</div></div>` : ''}
    <div class="row between"><h2>Open loans & cards</h2><button class="btn sm" data-act="loanEdit">＋ Add</button></div>
    ${openLoans().length ? openLoans().map(loanCard).join('') : '<div class="card muted small">No open loans recorded.</div>'}
    ${closed.length ? `<details class="card"><summary><b>Closed accounts (${closed.length})</b></summary>${closed.map(l => `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(l.lender)} · ${esc(l.type)}</span><span class="muted">${l.closed ? 'closed ' + dmy(l.closed) : ''} <button class="link" data-act="loanEdit" data-id="${l.id}">Edit</button></span></div>`).join('')}</details>` : ''}`;
}
function loanCard(l) {
  const repaid = l.sanctioned && l.outstanding != null && !l.isCard ? Math.max(0, Math.min(1, 1 - l.outstanding / l.sanctioned)) : null;
  const use = l.isCard && (l.limit || l.sanctioned) ? l.outstanding / (l.limit || l.sanctioned) : null;
  const seen = emiSeen(l);
  const left = l.emi && l.outstanding && !l.isCard ? Math.ceil(l.outstanding / l.emi) : null;
  return `<div class="card loan"><div class="top-l"><div><div class="name">${esc(l.lender)}</div><div class="small muted">${esc(l.type || 'Loan')}${l.acct ? ' · ' + esc(l.acct) : ''}${l.opened ? ' · since ' + dmy(l.opened) : ''}</div></div>
    <button class="link" data-act="loanEdit" data-id="${l.id}">Edit</button></div>
    ${l.overdue ? `<div class="alert bad small" style="margin:8px 0 0"><span class="ic">⛔</span><div>${inr(l.overdue)} overdue</div></div>` : ''}
    ${repaid != null ? `<div class="row between tiny muted" style="margin-top:10px"><span>${pct(repaid)} repaid</span><span>${inr(l.outstanding)} of ${inr(l.sanctioned)}</span></div><div class="bar"><i class="good" style="width:${(repaid * 100).toFixed(1)}%"></i></div>` : ''}
    ${use != null ? `<div class="row between tiny muted" style="margin-top:10px"><span>${pct(use)} of limit used</span><span>${inr(l.outstanding)} of ${inr(l.limit || l.sanctioned)}</span></div><div class="bar"><i class="${use > 0.3 ? 'warn' : 'good'}" style="width:${Math.min(100, use * 100).toFixed(1)}%"></i></div>` : ''}
    <div class="facts">
      <div><span>Outstanding</span><b class="num">${l.outstanding != null ? inr(l.outstanding) : '–'}</b></div>
      <div><span>EMI</span><b class="num">${l.emi ? inr(l.emi) : '–'}</b></div>
      <div><span>${l.isCard ? 'Limit' : 'Rate'}</span><b class="num">${l.isCard ? (l.limit ? inr(l.limit) : '–') : (l.rate ? l.rate + '%' : '–')}</b></div>
    </div>
    <div class="tiny muted" style="margin-top:8px">${left ? `About ${left} EMIs left. ` : ''}${seen.n ? `EMI seen in your bank ${seen.n === 1 ? "once" : seen.n + " times"} in 6 months, last on ${dmy(seen.last)}.` : (l.emi && db.txns.length ? 'No matching EMI found in imported bank statements.' : '')}${l.at ? ` CIBIL as of ${dmy(l.at)}.` : ''}</div></div>`;
}
function loanSheet(id) {
  const l = id ? db.loans.find(x => x.id === id) : { lender: '', type: 'Personal Loan', status: 'open' };
  const f = (k, lab, type = 'text', ph = '') => `<div><label class="f">${lab}</label><input type="${type}" id="L_${k}" value="${esc(l[k] ?? '')}" placeholder="${ph}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''}></div>`;
  openSheet(`<h3>${id ? 'Edit' : 'Add'} loan or card</h3>
    ${f('lender', 'Lender', 'text', 'e.g. HDFC Bank')}
    <div class="grid2">${f('type', 'Type', 'text', 'Home / Car / Personal / Credit Card')}${f('acct', 'Account no. (last digits)')}</div>
    <div class="grid2">${f('sanctioned', 'Sanctioned ₹', 'number')}${f('outstanding', 'Outstanding ₹', 'number')}</div>
    <div class="grid2">${f('emi', 'EMI ₹', 'number')}${f('rate', 'Interest rate %', 'number')}</div>
    <div class="grid2">${f('limit', 'Card limit ₹', 'number')}${f('overdue', 'Overdue ₹', 'number')}</div>
    <div class="grid2">${f('opened', 'Opened', 'date')}<div><label class="f">Status</label><select id="L_status"><option value="open" ${l.status !== 'closed' ? 'selected' : ''}>Open</option><option value="closed" ${l.status === 'closed' ? 'selected' : ''}>Closed</option></select></div></div>
    <div class="row" style="margin-top:14px">${id ? `<button class="btn danger" data-act="loanDel" data-id="${id}">Delete</button>` : ''}<span class="grow"></span><button class="btn pri" data-act="loanSave" data-id="${id || ''}">Save</button></div>`);
}
function loanSave(id) {
  const g = k => $('#L_' + k).value.trim();
  const n = k => { const v = g(k); return v === '' ? null : +v; };
  const l = id ? db.loans.find(x => x.id === id) : { id: uid(), src: 'manual' };
  Object.assign(l, { lender: g('lender') || 'Loan', type: g('type'), acct: g('acct'), sanctioned: n('sanctioned'), outstanding: n('outstanding'), emi: n('emi'), rate: n('rate'), limit: n('limit'), overdue: n('overdue') || 0, opened: g('opened'), status: g('status') });
  l.isCard = /card/i.test(l.type);
  if (!id) db.loans.push(l);
  save(); closeSheet(); render();
}

/* ---------- plan: budgets + net worth ---------- */
function viewPlan() {
  const s = monthStats(ui.month), avg = avgSpendByCat(), nw = netWorth(), lt = loanTotals();
  const exp = Cat.LIST.filter(([, k]) => k === 'exp').map(([n]) => n);
  const totalB = exp.reduce((t, c) => t + (+db.budgets[c] || 0), 0);
  const rows = exp.map(c => {
    const b = +db.budgets[c] || 0, sp = s.byCat[c] || 0, r = b ? sp / b : 0;
    if (!b && !sp && !avg[c]) return '';
    return `<div style="padding:9px 0;border-bottom:1px solid var(--line)"><div class="row"><span style="width:22px">${Cat.ICON[c]}</span><span class="grow ellip">${esc(c)}<div class="tiny muted">${inr(sp)} spent${avg[c] ? ` · avg ${inr(avg[c])}` : ''}</div></span>
      <input type="number" inputmode="numeric" class="num" style="width:110px;min-height:38px;text-align:right" data-act="budget" data-cat="${esc(c)}" value="${b || ''}" placeholder="Budget ₹"></div>
      ${b ? `<div class="bar" style="margin-top:6px"><i class="${r > 1 ? 'bad' : r > 0.85 ? 'warn' : 'good'}" style="width:${Math.min(100, r * 100).toFixed(1)}%"></i></div>` : ''}</div>`;
  }).join('');
  const totalSp = exp.filter(c => db.budgets[c]).reduce((t, c) => t + (s.byCat[c] || 0), 0);
  return `${monthBar()}
  <div class="row between"><h2 style="margin-top:0">Budgets</h2>${Object.keys(avg).length ? '<button class="btn sm" data-act="autoBudget">Set from 3-month average</button>' : ''}</div>
  <div class="card">${totalB ? `<div class="row between small" style="margin-bottom:6px"><span>${inr(totalSp)} of ${inr(totalB)} budgeted</span><b>${pct(totalSp / totalB)}</b></div><div class="bar"><i class="${totalSp > totalB ? 'bad' : 'good'}" style="width:${Math.min(100, totalSp / totalB * 100).toFixed(1)}%"></i></div>` : '<p class="small muted" style="margin:0">Type a monthly budget next to any category. You get a warning on Home when a category runs ahead of the month.</p>'}
  ${rows || '<p class="small muted">Categories show up here once you import statements.</p>'}</div>
  <h2>Net worth</h2>
  <div class="card"><div class="row between"><span class="muted">Net worth</span><b class="num" style="font-size:22px">${inr(nw.net)}</b></div>
    <dl class="kv" style="margin-top:10px"><dt>Bank & wallet balances</dt><dd class="num">${inr(nw.accts)}</dd><dt>Other assets</dt><dd class="num">${inr(nw.other)}</dd><dt>Loans outstanding</dt><dd class="num">−${inr(lt.out).replace('−', '')}</dd><dt>Credit card balances</dt><dd class="num">−${inr(lt.cardOut).replace('−', '')}</dd></dl></div>
  <h3>Accounts</h3>
  <div class="card">${db.accounts.filter(a => a.type !== 'card').map(a => { const b = latestBal(a); return `<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)"><span class="grow ellip">${esc(a.name)}<div class="tiny muted">${b ? (b.manual ? 'entered ' : 'statement ') + dmy(b.d) : 'no balance yet'}</div></span><b class="num">${b ? inr(b.bal) : '–'}</b><button class="link" data-act="acctEdit" data-id="${a.id}">Edit</button></div>`; }).join('') || '<p class="small muted" style="margin:0">Accounts are created when you import statements.</p>'}</div>
  <div class="row between"><h3 style="margin:14px 0 8px">Other assets</h3><button class="btn sm" data-act="assetEdit">＋ Add</button></div>
  <div class="card">${db.assets.map(x => `<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)"><span class="grow ellip">${esc(x.name)}<div class="tiny muted">${esc(x.kind)} · as of ${dmy(x.at)}</div></span><b class="num">${inr(+x.value)}</b><button class="link" data-act="assetEdit" data-id="${x.id}">Edit</button></div>`).join('') || '<p class="small muted" style="margin:0">Add FDs, mutual funds, PF/PPF, NPS, gold or property to see your full net worth.</p>'}</div>`;
}
function assetSheet(id) {
  const x = id ? db.assets.find(a => a.id === id) : { name: '', kind: 'Mutual funds', value: '', at: today() };
  openSheet(`<h3>${id ? 'Edit' : 'Add'} asset</h3>
    <label class="f">Name</label><input type="text" id="A_name" value="${esc(x.name)}" placeholder="e.g. SBI FD, Zerodha MF">
    <label class="f">Kind</label><select id="A_kind">${['Fixed deposit', 'Mutual funds', 'Stocks', 'PF / PPF', 'NPS', 'Gold', 'Property', 'Insurance (cash value)', 'Other'].map(k => `<option ${x.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
    <div class="grid2"><div><label class="f">Value ₹</label><input type="number" inputmode="decimal" id="A_value" value="${esc(x.value)}"></div><div><label class="f">As of</label><input type="date" id="A_at" value="${esc(x.at)}"></div></div>
    <div class="row" style="margin-top:14px">${id ? `<button class="btn danger" data-act="assetDel" data-id="${id}">Delete</button>` : ''}<span class="grow"></span><button class="btn pri" data-act="assetSave" data-id="${id || ''}">Save</button></div>`);
}
function acctSheet(id) {
  const a = acct(id); if (!a) return;
  const n = db.txns.filter(t => t.a === id).length;
  openSheet(`<h3>Account</h3>
    <label class="f">Name</label><input type="text" id="C_name" value="${esc(a.name)}">
    <div class="grid2"><div><label class="f">Type</label><select id="C_type">${[['bank', 'Bank account'], ['wallet', 'Wallet'], ['card', 'Credit card'], ['cash', 'Cash']].map(([v, l]) => `<option value="${v}" ${a.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div><label class="f">Last 4 digits</label><input type="text" inputmode="numeric" maxlength="4" id="C_last4" value="${esc(a.last4 || '')}"></div></div>
    <div class="grid2"><div><label class="f">Balance today ₹ (optional)</label><input type="number" inputmode="decimal" id="C_bal" value="${a.manualBal ?? ''}"></div><div><label class="f">As of</label><input type="date" id="C_at" value="${esc(a.manualAt || today())}"></div></div>
    <p class="tiny muted">The latest statement balance is used unless you enter a newer one here. ${n} entries in this account.</p>
    <div class="row" style="margin-top:10px"><button class="btn danger" data-act="acctDel" data-id="${id}">Delete account</button><span class="grow"></span><button class="btn pri" data-act="acctSave" data-id="${id}">Save</button></div>`);
}

/* ---------- settings ---------- */
function settingsSheet() {
  const rules = Object.entries(db.rules);
  openSheet(`<h3>Settings</h3>
    <h3 style="margin-top:14px;font-size:15px">Accounts</h3>
    ${db.accounts.map(a => `<div class="row between small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(a.name)} <span class="muted">· ${a.type}</span></span><button class="link" data-act="acctEdit" data-id="${a.id}">Edit</button></div>`).join('') || '<p class="small muted">None yet.</p>'}
    <h3 style="margin-top:16px;font-size:15px">Remembered merchants (${rules.length})</h3>
    <div style="max-height:180px;overflow:auto">${rules.map(([k, c]) => `<div class="row between small" style="padding:5px 0;border-bottom:1px solid var(--line)"><span class="ellip">${esc(k)} → ${esc(c)}</span><button class="link" data-act="ruleDel" data-k="${esc(k)}">Remove</button></div>`).join('') || '<p class="small muted">When you set a category and keep “use for every entry” ticked, it shows up here.</p>'}</div>
    <h3 style="margin-top:16px;font-size:15px">Backup & move to another device</h3>
    <p class="small muted">The backup file is encrypted with your passcode. Open the app on the other device and choose “Restore a backup” on first start, or Restore below.</p>
    <div class="row wrap"><button class="btn" data-act="backup">Download backup</button><button class="btn" data-act="restore">Restore backup</button><input type="file" id="restoreIn" accept=".json,application/json" hidden></div>
    <h3 style="margin-top:16px;font-size:15px">Security</h3>
    <div class="row wrap"><button class="btn" data-act="changePass">Change passcode</button><button class="btn danger" data-act="wipe">Erase all data</button></div>
    ${isInstalled() ? '' : '<div style="margin-top:16px"><button class="btn" data-act="install">📲 Install on this phone</button></div>'}
    <p class="tiny muted" style="margin-top:14px">Paisa Desk ${APP_VERSION}. Statements are read inside this app on this device; nothing is sent to any server. Data is stored encrypted (AES-256) in this browser and locks after 3 minutes in the background. ${db.txns.length} entries, ${db.loans.length} loans.</p>`);
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- sheet + tooltip ---------- */
let sheetOnClose = null;
function openSheet(html, onClose) { $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; sheetOnClose = onClose || null; }
function closeSheet(silent) { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; const f = sheetOnClose; sheetOnClose = null; if (f && !silent) f(); }
const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
function showTip(el, x, y) { tip.textContent = el.dataset.tip; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px'; tip.style.top = Math.max(8, y - 44) + 'px'; }
document.addEventListener('pointermove', e => { const el = e.target.closest?.('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true; });
document.addEventListener('pointerleave', () => tip.hidden = true);

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) return go(tabBtn.dataset.tab);
  const el = e.target.closest('[data-act]'); if (!el || !db && !['close'].includes(el.dataset.act)) return;
  const act = el.dataset.act, id = el.dataset.id;
  const pend = () => ui.pending.find(p => p.id === id);
  switch (act) {
    case 'close': closeSheet(); break;
    case 'lock': lockNow(); break;
    case 'settings': settingsSheet(); break;
    case 'install': installApp(); break;
    case 'go': closeSheet(true); go(el.dataset.tab); break;
    case 'mPrev': ui.month = ymAdd(ui.month, -1); render(); break;
    case 'mNext': ui.month = ymAdd(ui.month, 1); render(); break;
    case 'pickMonth': ui.month = el.dataset.m; render(); break;
    case 'filterCat': ui.f = { q: '', acct: '', cat: el.dataset.cat, type: '', month: ui.month }; ui.limit = 150; go('spends'); break;
    case 'showGuess': ui.f = { q: '', acct: '', cat: '', type: 'guess', month: '' }; go('spends'); break;
    case 'fType': ui.f.type = el.dataset.t; ui.limit = 150; render(); break;
    case 'fClear': ui.f = { q: '', acct: '', cat: '', type: '', month: '' }; render(); break;
    case 'more': ui.limit += 150; render(); break;
    case 'tx': txSheet(id); break;
    case 'setCat': ui.txCat = el.dataset.cat; document.querySelectorAll('.catgrid button').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'saveTx': saveTxSheet(id); break;
    case 'delTx': if (confirm('Delete this entry?')) { db.txns = db.txns.filter(t => t.id !== id); save(); closeSheet(); render(); } break;
    case 'flipSign': { const t = db.txns.find(x => x.id === id); t.amt = -t.amt; t.guess = false; if (!t.mc) t.cat = Cat.guess(t.desc, t.amt, t.tags); matchTransfers(); save(); txSheet(id); render(); break; }
    case 'okSign': { const t = db.txns.find(x => x.id === id); t.guess = false; save(); txSheet(id); render(); break; }
    case 'unpair': { const t = db.txns.find(x => x.id === id), p = db.txns.find(x => x.id === t.pair); for (const x of [t, p]) if (x) { x.xf = null; x.pair = null; x.noX = true; } save(); txSheet(id); render(); break; }
    case 'dropPend': ui.pending = ui.pending.filter(p => p.id !== id); refreshPending(); break;
    case 'commit': commitImport(pend()); break;
    case 'saveCibil': saveCibil(pend()); break;
    case 'undoImp': {
      const h = db.imports.find(x => x.id === id); const n = db.txns.filter(t => t.imp === id).length;
      if (!confirm(`Remove the ${n} entries added from ${h.file}?`)) break;
      const gone = new Set(db.txns.filter(t => t.imp === id).map(t => t.id));
      db.txns = db.txns.filter(t => !gone.has(t.id));
      for (const t of db.txns) if (t.pair && gone.has(t.pair)) { t.pair = null; t.xf = null; }
      db.imports = db.imports.filter(x => x.id !== id);
      db.accounts = db.accounts.filter(a => db.txns.some(t => t.a === a.id) || a.manualBal != null);
      save(); render(); break;
    }
    case 'loanEdit': loanSheet(id); break;
    case 'loanSave': loanSave(id); break;
    case 'loanDel': if (confirm('Delete this loan?')) { db.loans = db.loans.filter(l => l.id !== id); save(); closeSheet(); render(); } break;
    case 'autoBudget': {
      const avg = avgSpendByCat();
      for (const [c, v] of Object.entries(avg)) if (Cat.KIND[c] === 'exp' && v > 0 && !db.budgets[c]) db.budgets[c] = Math.ceil(v / 500) * 500;
      save(); render(); toast('Budgets set from your 3-month average (rounded up to ₹500). Adjust any of them.'); break;
    }
    case 'assetEdit': assetSheet(id); break;
    case 'assetSave': {
      const x = id ? db.assets.find(a => a.id === id) : { id: uid() };
      Object.assign(x, { name: $('#A_name').value.trim() || 'Asset', kind: $('#A_kind').value, value: +$('#A_value').value || 0, at: $('#A_at').value || today() });
      if (!id) db.assets.push(x); save(); closeSheet(); render(); break;
    }
    case 'assetDel': db.assets = db.assets.filter(a => a.id !== id); save(); closeSheet(); render(); break;
    case 'acctEdit': acctSheet(id); break;
    case 'acctSave': {
      const a = acct(id), bal = $('#C_bal').value.trim();
      Object.assign(a, { name: $('#C_name').value.trim() || a.name, type: $('#C_type').value, last4: $('#C_last4').value.trim(), manualBal: bal === '' ? null : +bal, manualAt: bal === '' ? null : $('#C_at').value });
      save(); closeSheet(); render(); break;
    }
    case 'acctDel': {
      const n = db.txns.filter(t => t.a === id).length;
      if (!confirm(`Delete this account and its ${n} entries?`)) break;
      db.txns = db.txns.filter(t => t.a !== id); db.accounts = db.accounts.filter(a => a.id !== id);
      save(); closeSheet(); render(); break;
    }
    case 'ruleDel': delete db.rules[el.dataset.k]; save(); settingsSheet(); render(); break;
    case 'backup': { const v = await Store.backup(db); download(`paisa-desk-backup-${today()}.json`, JSON.stringify(v)); toast('Encrypted backup downloaded'); break; }
    case 'restore': {
      const inp = $('#restoreIn');
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        try {
          const data = await Store.readBackup(JSON.parse(await f.text()), async () => prompt('Passcode of this backup file:'));
          if (!confirm(`Replace what is on this device with the backup (${data.txns?.length || 0} entries, ${data.loans?.length || 0} loans)?`)) return;
          db = data; migrate(); save(); closeSheet(); render(); toast('Backup restored');
        } catch (ex) { toast(/decrypt|operation/i.test(ex.message + ex.name) ? 'Wrong passcode for that backup.' : ex.message); }
      };
      inp.click(); break;
    }
    case 'changePass': {
      const p1 = prompt('New passcode (6+ characters):'); if (p1 == null) break;
      if (p1.length < 6) { toast('Use at least 6 characters.'); break; }
      if (prompt('Repeat the new passcode:') !== p1) { toast('Passcodes did not match.'); break; }
      await Store.changePass(p1, db); toast('Passcode changed. Old backups still open with the old passcode.'); break;
    }
    case 'wipe': {
      if (!confirm('Erase all Paisa Desk data on this device? This cannot be undone. Download a backup first if you need one.')) break;
      if (prompt('Type ERASE to confirm') !== 'ERASE') break;
      await Store.wipe(); db = null; showLock(); break;
    }
  }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-act]'); if (!el || !db) return;
  const p = ui.pending.find(x => x.id === el.dataset.id);
  if (el.dataset.act === 'mapSel' && p) { p.map[el.dataset.hint].to = el.value; refreshPending(); }
  if (el.dataset.act === 'mapType' && p) p.map[el.dataset.hint].type = el.value;
  if (el.dataset.act === 'budget') { const v = +el.value; if (v > 0) db.budgets[el.dataset.cat] = v; else delete db.budgets[el.dataset.cat]; save(); render(); }
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-act="mapName"]'); if (!el) return;
  const p = ui.pending.find(x => x.id === el.dataset.id); if (p) p.map[el.dataset.hint].name = el.value;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (db && h !== ui.tab && ['home', 'spends', 'import', 'loans', 'plan'].includes(h)) { ui.tab = h; render(); } });

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !db) { reloaded = true; location.reload(); } });
}
showLock();
