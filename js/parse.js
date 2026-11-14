// Statement parsing. Excel/CSV through SheetJS, PDF through pdf.js. Everything runs on the device; files never leave it.
// Output of every parser: { kind, rows:[{date, desc, amt, bal, ref, acctHint, tags, amb}], meta:{...} }
// amt is signed: + money in, - money out. amb = sign could not be determined.
'use strict';
const Parse = (() => {
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');
  const r2 = n => Math.round(n * 100) / 100;

  function ymd(y, m, d) {
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  // Indian statements are day-first. Handles 01/11/2024, 01-11-24, 01-Nov-2024, 01 Nov 24, Nov 01 2024, 2024-11-01, Excel serials.
  function date(v, yearHint) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
      return null;
    }
    const s = String(v).trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
    let m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?![\d])/))) return ymd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})(?![\d])/))) return ymd(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[-\/. ]?([a-z]{3,9})\.?[-\/. ']*(\d{4}|\d{2})(?![\d])/)) && MON[m[2].slice(0, 3)]) return ymd(+m[3], MON[m[2].slice(0, 3)], +m[1]);
    if ((m = s.match(/^([a-z]{3,9})\.? (\d{1,2}) (\d{4})(?![\d])/)) && MON[m[1].slice(0, 3)]) return ymd(+m[3], MON[m[1].slice(0, 3)], +m[2]);
    if (yearHint && (m = s.match(/^(\d{1,2}) ([a-z]{3,9})\.?$/)) && MON[m[2].slice(0, 3)]) return ymd(yearHint, MON[m[2].slice(0, 3)], +m[1]);
    return null;
  }

  // Money in any of: 1,23,456.78 | 1234.00 Cr | (500.00) | -500 | + Rs.1,200 | ₹ 99 | 500.00Dr
  // Returns {n: absolute value, sign: -1 | 1 | 0 when not stated} or null.
  function money(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? { n: Math.abs(v), sign: v < 0 ? -1 : 0 } : null;
    let s = String(v).trim().toLowerCase();
    if (!s || s === '-' || s === '--') return null;
    let sign = 0;
    if (/\bdr\.?$|\bdebit$/.test(s)) sign = -1;
    else if (/\bcr\.?$|\bcredit$/.test(s)) sign = 1;
    s = s.replace(/\b(dr|cr|debit|credit)\.?$/, '').replace(/rs\.?|inr|₹/g, '').replace(/\s+/g, '');
    if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
    if (/^-|-$/.test(s)) sign = -1; else if (/^\+/.test(s)) sign = sign || 1;
    s = s.replace(/^[-+]|-$/g, '');
    if (!/^\d[\d,]*(\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s.replace(/,/g, ''));
    return isFinite(n) ? { n, sign } : null;
  }
  // A PDF token that is clearly an amount (not a cheque or reference number).
  const MONEY_RE = /^[-+]?\s*(?:rs\.?|inr|₹)?\s*[-+]?\(?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?\)?\s*(?:cr|dr)?\.?$/i;
  function isMoneyTok(s) {
    if (!MONEY_RE.test(s)) return false;
    return /\.\d{1,2}\)?\s*(cr|dr)?\.?$/i.test(s) || /,/.test(s) || /rs|₹|inr/i.test(s) || /^[-+]/.test(s.trim());
  }

  const refOf = s => { const m = String(s || '').match(/(?<!\d)(\d{12})(?!\d)/); return m ? m[1] : ''; };

  // Words that hint at direction when nothing else does (Paytm "Paid to", "Received from").
  function hintSign(desc) {
    const d = desc.toLowerCase();
    if (/^(paid to|sent to|money sent|transferred to|payment to|paid for|recharge|bill payment|debit)/.test(d) || /\b(withdrawal|purchase|pos |emi)\b/.test(d)) return -1;
    if (/^(received from|money received|added to|refund|cashback|credit)/.test(d) || /\b(salary|interest credit|refund|cashback|reversal)\b/.test(d)) return 1;
    return 0;
  }

  // Put the rows in date order, use running balances to fix signs, and count rows whose balance does not tie.
  function finish(rows, opening) {
    rows = rows.filter(r => r.date && r.amt != null && isFinite(r.amt));
    if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) rows.reverse();
    let prev = opening;
    for (const r of rows) {
      if (r.bal != null && prev != null) {
        const diff = r2(r.bal - prev);
        if (r.amb && Math.abs(Math.abs(diff) - Math.abs(r.amt)) < 0.011) { r.amt = diff; r.amb = false; }
      }
      if (r.bal != null) prev = r.bal; else if (prev != null && !r.amb) prev = r2(prev + r.amt);
    }
    // First row may still be unsigned when there was no opening balance: derive opening from the next row.
    for (const r of rows) if (r.amb) { const h = hintSign(r.desc); r.amt = Math.abs(r.amt) * (h || -1); r.guess = !h; r.amb = false; }

    // Balance check, and a whole-statement flip if debit/credit columns were read the wrong way round.
    const check = flip => {
      let ok = 0, bad = 0, p = opening;
      for (const r of rows) {
        if (r.bal == null) { if (p != null) p = r2(p + (flip ? -r.amt : r.amt)); continue; }
        if (p != null) (Math.abs(p + (flip ? -r.amt : r.amt) - r.bal) < 0.011 ? ok++ : bad++);
        p = r.bal;
      }
      return { ok, bad };
    };
    let recon = check(false);
    const flipped = check(true);
    if (flipped.ok > recon.ok * 2 && flipped.ok >= 3) { rows.forEach(r => r.amt = -r.amt); recon = flipped; }
    for (const r of rows) { r.amt = r2(r.amt); if (!r.ref) r.ref = refOf(r.desc); r.desc = r.desc.replace(/\s+/g, ' ').trim(); }
    const dates = rows.map(r => r.date).sort();
    return {
      rows,
      recon,
      opening: opening ?? null,
      closing: [...rows].reverse().find(r => r.bal != null)?.bal ?? null,
      from: dates[0] || null, to: dates[dates.length - 1] || null,
    };
  }

  // Account number hint from statement header text ("Account No : XXXXXXXX1234").
  function acctNoHint(text) {
    const m = text.match(/(?:a\/?c|account)\s*(?:no|number|#)?\.?\s*[:\-]?\s*([X*x\d][X*x\d\- ]{5,22}\d)/i);
    if (!m) return '';
    const digits = m[1].replace(/\D/g, '');
    return digits.slice(-4);
  }
  function bankHint(text) {
    const t = text.toLowerCase();
    const banks = [['hdfc bank', 'HDFC Bank'], ['icici bank', 'ICICI Bank'], ['state bank of india', 'SBI'], ['axis bank', 'Axis Bank'], ['kotak', 'Kotak'],
      ['yes bank', 'Yes Bank'], ['idfc first', 'IDFC First'], ['indusind', 'IndusInd'], ['bank of baroda', 'Bank of Baroda'], ['punjab national', 'PNB'],
      ['canara bank', 'Canara Bank'], ['union bank', 'Union Bank'], ['federal bank', 'Federal Bank'], ['au small finance', 'AU Bank'], ['rbl bank', 'RBL Bank'],
      ['paytm payments bank', 'Paytm Payments Bank'], ['paytm', 'Paytm'], ['bank of india', 'Bank of India'], ['indian bank', 'Indian Bank'], ['uco bank', 'UCO Bank'],
      ['idbi', 'IDBI Bank'], ['bandhan', 'Bandhan Bank'], ['standard chartered', 'Standard Chartered'], ['hsbc', 'HSBC'], ['citi', 'Citibank']];
    for (const [k, v] of banks) if (t.includes(k)) return v;
    return '';
  }

  /* ---------------- Excel / CSV ---------------- */
  const H = {
    date: /^(txn|tran|transaction|posting|post|value)?\.?\s*date|^date\b|date\s*&\s*time/,
    valueDate: /value\s*d(ate|t)/,
    desc: [/narration/, /description/, /particulars/, /transaction details/, /^details/, /remarks/, /^transaction$/],
    debit: /withdraw|debit|\bdr\b|paid out|money out/,
    credit: /deposit|credit|\bcr\b|paid in|money in/,
    amount: /amount|^amt/,
    drcr: /^(dr|cr)\s*\/\s*(cr|dr)$|^type$|txn type|transaction type|debit\s*\/\s*credit|^cr\/dr|^dr\/cr/,
    balance: /balance/,
    ref: /ref|chq|cheque|utr/,
    account: /your account|^account$|paid from|source account/,
    tags: /^tags?$|categor/,
    other: /other transaction details|upi id|counterparty/,
  };
  function mapHeader(row) {
    const cells = row.map(c => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
    const find = (re, not) => cells.findIndex((c, i) => c && re.test(c) && !(not && not.includes(i)));
    const map = {};
    const dateCols = cells.map((c, i) => c && H.date.test(c) ? i : -1).filter(i => i >= 0);
    map.date = dateCols.find(i => !H.valueDate.test(cells[i])) ?? dateCols[0] ?? -1;
    map.drcr = find(H.drcr);
    const used = [map.date, map.drcr];
    map.debit = cells.findIndex((c, i) => c && H.debit.test(c) && !used.includes(i) && !H.drcr.test(c));
    map.credit = cells.findIndex((c, i) => c && H.credit.test(c) && !used.includes(i) && i !== map.debit && !H.drcr.test(c));
    if (map.debit >= 0 && map.credit < 0) map.debit = -1;
    map.balance = find(H.balance);
    map.amount = cells.findIndex((c, i) => c && H.amount.test(c) && ![map.debit, map.credit, map.balance].includes(i));
    map.desc = -1;
    for (const re of H.desc) { const i = cells.findIndex((c, j) => c && re.test(c) && j !== map.date); if (i >= 0) { map.desc = i; break; } }
    map.ref = cells.findIndex((c, i) => c && H.ref.test(c) && ![map.desc, map.date].includes(i));
    map.account = find(H.account);
    map.tags = find(H.tags);
    map.other = find(H.other);
    const ok = map.date >= 0 && (map.debit >= 0 || map.amount >= 0);
    return ok ? map : null;
  }

  function fromTable(table, text) {
    let hdrAt = -1, map = null;
    for (let i = 0; i < Math.min(table.length, 60); i++) { map = mapHeader(table[i] || []); if (map) { hdrAt = i; break; } }
    if (!map) return null;
    const yearHint = +((text.match(/\b(20\d{2})\b/) || [])[1]) || new Date().getFullYear();
    const rows = [];
    let opening = null;
    for (let i = hdrAt + 1; i < table.length; i++) {
      const row = table[i] || [];
      const d = date(row[map.date], yearHint);
      const desc = [row[map.desc], map.other >= 0 ? row[map.other] : ''].filter(x => x != null && String(x).trim()).join(' · ');
      if (!d) {
        const joined = row.map(c => String(c ?? '')).join(' ').toLowerCase();
        if (/opening balance/.test(joined) && map.balance >= 0) { const b = money(row[map.balance]); if (b) opening = b.n * (b.sign || 1); }
        else if (rows.length && desc && row.filter(c => c != null && String(c).trim()).length === 1 && String(row[map.desc] ?? '').trim()) rows[rows.length - 1].desc += ' ' + String(row[map.desc]).trim();
        continue;
      }
      let amt = null, amb = false;
      if (map.debit >= 0) {
        const dr = money(row[map.debit]), cr = money(row[map.credit]);
        if (!dr && !cr) continue;
        amt = (cr ? cr.n : 0) - (dr ? dr.n : 0);
      } else {
        const a = money(row[map.amount]);
        if (!a) continue;
        let sign = a.sign;
        if (map.drcr >= 0) { const t = String(row[map.drcr] ?? '').toLowerCase(); if (/^d|debit|withdraw/.test(t)) sign = -1; else if (/^c|credit|deposit/.test(t)) sign = 1; }
        if (!sign) { sign = 0; amb = true; }
        amt = a.n * (sign || 1);
      }
      const b = map.balance >= 0 ? money(row[map.balance]) : null;
      rows.push({
        date: d, desc: desc || '(no description)', amt, amb,
        bal: b ? r2(b.n * (b.sign === -1 ? -1 : 1)) : null,
        ref: map.ref >= 0 ? String(row[map.ref] ?? '').replace(/\D/g, '').slice(-12) : '',
        acctHint: map.account >= 0 ? String(row[map.account] ?? '').trim() : '',
        tags: map.tags >= 0 ? String(row[map.tags] ?? '').trim() : '',
      });
    }
    if (!rows.length) return null;
    return { ...finish(rows, opening), map, hdrAt };
  }

  async function excel(file) {
    const buf = await file.arrayBuffer();
    // raw:true keeps text-file values (CSV, HTML-.xls) as typed, so 01/10/26 is not read the US way. Real Excel dates still arrive as dates.
    const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: true });
    let best = null;
    for (const name of wb.SheetNames) {
      const table = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
      const head = table.slice(0, 60).map(r => (r || []).join(' ')).join('\n');
      const res = fromTable(table, head);
      // Only the part above the column headings describes the statement (narrations below can mention Paytm etc.).
      const text = res ? table.slice(0, res.hdrAt + 1).map(r => (r || []).join(' ')).join('\n') : '';
      if (res && (!best || res.rows.length > best.rows.length)) best = { ...res, text };
    }
    if (!best) throw new Error('Could not find a transaction table (looked for Date and Debit/Credit or Amount columns).');
    const kind = best.map.account >= 0 && best.rows.some(r => /paytm|wallet/i.test(r.acctHint)) ? 'paytm' : detectKind(best.text, best.rows);
    return { kind, rows: best.rows, meta: { ...best, rows: undefined, last4: acctNoHint(best.text), bank: bankHint(best.text), format: 'Excel/CSV' } };
  }

  /* ---------------- PDF ---------------- */
  let pdfReady = null;
  function initPdf() {
    if (!pdfReady) { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; pdfReady = true; }
  }

  // Returns lines: [{page, y, toks:[{s, x, xr}]}] in reading order.
  async function pdfLines(file, askPassword) {
    initPdf();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjsLib.getDocument({ data, isEvalSupported: false });
    let cancelled = false;
    task.onPassword = (give, reason) => {
      askPassword(file.name, reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD).then(pw => {
        if (pw == null) { cancelled = true; task.destroy(); } else give(pw);
      });
    };
    let doc;
    try { doc = await task.promise; } catch (e) { if (cancelled) throw new Error('Skipped: no password given.'); throw e; }
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 8 }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      let cur = null;
      for (const it of items) {
        if (!cur || Math.abs(cur.y - it.y) > Math.max(2, it.h * 0.35)) { cur = { page: p, y: it.y, items: [] }; lines.push(cur); }
        cur.items.push(it);
      }
      page.cleanup();
    }
    for (const ln of lines) {
      ln.items.sort((a, b) => a.x - b.x);
      const toks = [];
      for (const it of ln.items) {
        const last = toks[toks.length - 1];
        const gap = last ? it.x - last.xr : 99;
        if (last && gap < Math.max(3, it.h * 0.45)) { last.s += (gap > it.h * 0.12 ? ' ' : '') + it.s; last.xr = it.x + it.w; }
        else toks.push({ s: it.s, x: it.x, xr: it.x + it.w });
      }
      ln.toks = toks.map(t => ({ ...t, s: t.s.replace(/\s+/g, ' ').trim() })).filter(t => t.s);
      delete ln.items;
    }
    await doc.destroy();
    return lines.filter(l => l.toks.length);
  }

  // A statement line may carry several logical cells in one token ("01/11/2024 UPI-SWIGGY ... 250.00"); split amounts off the ends.
  function explode(toks) {
    const out = [];
    toks.forEach((t, g) => {
      const parts = t.s.split(' ');
      if (parts.length > 1 && (isMoneyTok(parts[parts.length - 1]) || date(parts.slice(0, 3).join(' ')))) {
        const per = (t.xr - t.x) / Math.max(1, t.s.length);
        let pos = t.x;
        for (const p of parts) { out.push({ s: p, x: pos, xr: pos + p.length * per, g }); pos += (p.length + 1) * per; }
        return;
      }
      out.push({ ...t, g });
    });
    // Re-join plain words that were split out of the same piece of text, so descriptions stay whole.
    // Separate pieces are never joined: they are separate columns (e.g. "Withdrawals" and "Deposits").
    const merged = [];
    const plain = x => !isMoneyTok(x.s) && !/^(cr|dr)\.?$/i.test(x.s) && !/^[-+]$/.test(x.s);
    for (const t of out) {
      const last = merged[merged.length - 1];
      if (last && last.g === t.g && plain(last) && plain(t) && !date(t.s)) { last.s += ' ' + t.s; last.xr = t.xr; }
      else merged.push({ ...t });
    }
    // glue lone signs and Cr/Dr markers to their amount
    const res = [];
    for (let i = 0; i < merged.length; i++) {
      const t = merged[i];
      if (/^[-+]$/.test(t.s) && merged[i + 1] && isMoneyTok(merged[i + 1].s)) { merged[i + 1].s = t.s + merged[i + 1].s; merged[i + 1].x = t.x; continue; }
      if (/^(cr|dr)\.?$/i.test(t.s) && res.length && isMoneyTok(res[res.length - 1].s)) { res[res.length - 1].s += ' ' + t.s; res[res.length - 1].xr = t.xr; continue; }
      res.push(t);
    }
    return res;
  }

  function headerCols(toks) {
    const cols = {};
    for (const t of toks) {
      const s = t.s.toLowerCase();
      const c = (t.x + t.xr) / 2;
      const set = k => { if (!cols[k]) cols[k] = { c, x: t.x, xr: t.xr }; };
      if (/balance/.test(s)) set('balance');
      else if (/withdraw|debit|\bdr\b|paid out/.test(s)) set('debit');
      else if (/deposit|credit|\bcr\b|paid in/.test(s)) set('credit');
      else if (/amount|amt/.test(s)) set('amount');
    }
    return cols;
  }

  // Narrow date columns wrap: "01-10-" on one line and "2026" just below it. Join them back.
  function joinWrappedDates(lines) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].toks[0];
      if (!t || !/^\d{1,2}[-\/. ](\d{1,2}|[A-Za-z]{3,9})[-\/. ]?$/.test(t.s)) continue;
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const k = lines[j].toks.findIndex(u => Math.abs(u.x - t.x) < 6 && /^(\d{4}|\d{2})$/.test(u.s));
        if (k < 0) continue;
        t.s = t.s.replace(/[-\/. ]?$/, m => m || '-') + lines[j].toks[k].s;
        lines[j].toks.splice(k, 1);
        break;
      }
    }
    return lines.filter(l => l.toks.length);
  }

  function fromLines(lines, text) {
    lines = joinWrappedDates(lines);
    const yearHint = +((text.match(/\b(20\d{2})\b/) || [])[1]) || new Date().getFullYear();
    let cols = null, cur = null, opening = null;
    const txns = [];
    const isFooter = s => /page \d|statement of account|generated on|this is (a )?computer|end of statement|^total|closing balance|carried forward|^\*|registered office|call us|customer care|please (note|review)|for any (query|discrepancy)/i.test(s);

    for (const ln of lines) {
      const toks = explode(ln.toks);
      const joined = toks.map(t => t.s).join(' ');
      const low = joined.toLowerCase();

      // Date at the start of the line: one, two or three tokens ("01", "Nov", "2024")
      let d = null, used = 0;
      for (let k = 1; k <= Math.min(3, toks.length) && !d; k++) {
        const cand = toks.slice(0, k).map(t => t.s).join(' ');
        const got = date(cand, yearHint);
        if (got && (k === 1 || cand.length <= 14)) { d = got; used = k; }
      }

      if (!d && /date/.test(low) && /(balance|withdraw|debit|deposit|credit|amount|particulars|narration|description|details)/.test(low)) {
        const hc = headerCols(toks);
        if (Object.keys(hc).length) cols = hc;
        cur = null; continue;
      }
      if (/opening balance|balance b\/?f|brought forward|^b\/f\b/.test(low) || (d && /^(b\/f|opening balance|balance b\/?f|brought forward)\b/.test(toks.slice(used).map(t => t.s).join(' ').toLowerCase()))) {
        const m = toks.filter(t => isMoneyTok(t.s)).pop();
        if (m && opening == null) { const v = money(m.s); opening = v.n * (v.sign === -1 ? -1 : 1); }
        cur = null; continue;
      }
      if (!d) {
        if (isFooter(low)) { cur = null; continue; }
        const am = toks.filter(t => isMoneyTok(t.s));
        if (cur && !am.length && joined.length < 140 && !/^\d{1,2}:\d{2}/.test(joined)) { if (cur.desc.length < 220) cur.desc += ' ' + joined; }
        else if (cur && am.length && !cur.am.length) { cur.am = am; cur.desc += ' ' + toks.filter(t => !isMoneyTok(t.s)).map(t => t.s).join(' '); }
        continue;
      }
      const rest = toks.slice(used);
      const am = rest.filter(t => isMoneyTok(t.s));
      const words = rest.filter(t => !isMoneyTok(t.s) && !date(t.s, yearHint) && !/^\d{1,2}:\d{2}(\s?[ap]m)?$/i.test(t.s));
      cur = { date: d, desc: words.map(t => t.s).join(' '), am, cols };
      txns.push(cur);
    }

    const rows = [];
    for (const t of txns) {
      if (!t.am.length) continue;
      // A dated line that only carries a balance (B/F, opening) sets the opening balance instead of being a transaction.
      if (/^(b\/f|opening|balance b|brought forward)/i.test(t.desc)) { if (opening == null) { const v = money(t.am[t.am.length - 1].s); if (v) opening = v.n * (v.sign === -1 ? -1 : 1); } continue; }
      let amtTok = null, balTok = null, kind = null;
      const c = t.cols;
      if (c && (c.debit || c.credit || c.amount)) {
        for (const tok of t.am) {
          const mid = (tok.x + tok.xr) / 2;
          let best = null, bd = 1e9;
          for (const [k, col] of Object.entries(c)) {
            const dist = Math.min(Math.abs(mid - col.c), Math.abs(tok.xr - col.xr), Math.abs(tok.x - col.x));
            if (dist < bd) { bd = dist; best = k; }
          }
          if (best === 'balance') balTok = tok; else if (!amtTok) { amtTok = tok; kind = best; }
        }
      }
      if (!amtTok && balTok && c && (c.debit || c.credit || c.amount)) {
        if (!rows.length && opening == null) { const v = money(balTok.s); if (v) opening = v.n * (v.sign === -1 ? -1 : 1); }
        continue;
      }
      if (!amtTok) {
        if (t.am.length >= 2) { amtTok = t.am[t.am.length - 2]; balTok = t.am[t.am.length - 1]; } else amtTok = t.am[0];
        kind = 'amount';
      }
      const a = money(amtTok.s); if (!a) continue;
      let amt, amb = false;
      if (kind === 'debit') amt = -a.n; else if (kind === 'credit') amt = a.n;
      else if (a.sign) amt = a.n * a.sign; else { amt = a.n; amb = true; }
      const b = balTok ? money(balTok.s) : null;
      rows.push({ date: t.date, desc: t.desc || '(no description)', amt, amb, bal: b ? r2(b.n * (b.sign === -1 ? -1 : 1)) : null, ref: '', acctHint: '', tags: '' });
    }
    if (!rows.length) return null;
    return finish(rows, opening);
  }

  function detectKind(text, rows) {
    const t = text.toLowerCase();
    // Any credit bureau report (kind 'cibil' covers CIBIL, Experian, CRIF High Mark, Equifax).
    if (/cibil|transunion|experian|crif|high\s?mark|equifax|credit information report/.test(t) && /(member name|lender|institution|credit grantor|account type|ownership|date opened|sanction)/.test(t) && /(score|credit (information )?report|\bcir\b)/.test(t)) return 'cibil';
    if (/paytm/.test(t) && !/paytm payments bank/.test(t)) return 'paytm';
    if (/credit card|card statement|minimum amount due|total amount due/.test(t)) return 'card';
    return 'bank';
  }

  async function pdf(file, askPassword) {
    const lines = await pdfLines(file, askPassword);
    const text = lines.map(l => l.toks.map(t => t.s).join(' ')).join('\n');
    const kind = detectKind(text, []);
    if (kind === 'cibil') return { kind, rows: [], text, lines, meta: { format: 'PDF' } };
    const res = fromLines(lines, text);
    if (!res) {
      if (text.replace(/\s/g, '').length < 50) throw new Error('This PDF has no readable text (probably a scanned image). Download the e-statement or Excel version instead.');
      throw new Error('Could not find transaction lines in this PDF. Try the Excel/CSV download of the same statement.');
    }
    return { kind, rows: res.rows, text, meta: { ...res, rows: undefined, last4: acctNoHint(text), bank: bankHint(text), format: 'PDF' } };
  }

  async function file(f, askPassword) {
    const name = f.name.toLowerCase();
    if (name.endsWith('.pdf') || f.type === 'application/pdf') return pdf(f, askPassword);
    if (/\.(xlsx|xls|csv|ods|txt)$/.test(name)) return excel(f);
    throw new Error('Unsupported file type. Use PDF, Excel (.xlsx/.xls) or CSV.');
  }

  return { file, date, money, refOf, fromTable, fromLines, hintSign, pdfLines };
})();
