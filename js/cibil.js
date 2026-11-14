// CIBIL report reader. Rebuilds "LABEL: value" cells from the PDF layout (values often sit on the line below their label,
// in the same column), splits the account section into one block per lender ("Member Name") and picks labelled values.
// CIBIL layouts vary, so everything found is shown for review and stays editable.
'use strict';
const Cibil = (() => {
  const DATE = '(\\d{1,2}[-/.](?:\\d{1,2}|[A-Za-z]{3})[-/.]\\d{2,4})';
  const MONEY = '((?:rs\\.?|₹|inr)?\\s*[\\d,]+(?:\\.\\d{1,2})?)';
  const TEXT = '([^\\n]{2,60})';
  const F = {
    lender: [`member\\s*name`],
    type: [`account\\s*type`, `type`],
    acct: [`account\\s*(?:number|no\\.?)`],
    ownership: [`ownership`],
    opened: [`date\\s*opened|opened(?:\\s*on)?|open\\s*date`],
    closed: [`date\\s*closed|closed(?:\\s*on)?`],
    reported: [`date\\s*reported|reported\\s*(?:and|&)\\s*certified|reported\\s*on`],
    lastPay: [`last\\s*payment(?:\\s*date)?|date\\s*of\\s*last\\s*payment`],
    sanctioned: [`sanctioned(?:\\s*amount)?|high\\s*credit|loan\\s*amount|disbursed(?:\\s*amount)?`],
    limit: [`credit\\s*limit`],
    outstanding: [`current\\s*balance|outstanding(?:\\s*balance)?|balance\\s*outstanding`],
    overdue: [`amount\\s*overdue|overdue(?:\\s*amount)?`],
    emi: [`emi(?:\\s*amount)?|instal+ment\\s*amount`],
    tenure: [`repayment\\s*tenure|tenure`],
    rate: [`rate\\s*of\\s*interest|interest\\s*rate|roi`],
  };
  const KIND = { lender: TEXT, type: TEXT, acct: '([X*x\\d][X*x\\d -]{3,24})', ownership: TEXT, opened: DATE, closed: DATE, reported: DATE, lastPay: DATE,
    sanctioned: MONEY, limit: MONEY, outstanding: MONEY, overdue: MONEY, emi: MONEY, tenure: '(\\d{1,3})', rate: '(\\d{1,2}(?:\\.\\d{1,2})?)' };
  const isLabel = s => /:\s*$/.test(s);
  const hasLabel = s => /:/.test(s);

  // Turn positioned tokens into logical cells, pulling a label's value (and wrapped text) up from the lines below.
  function cells(lines) {
    const toks = [];
    lines.forEach((l, li) => l.toks.forEach(t => toks.push({ s: t.s, x: t.x, li, used: false })));
    const out = [];
    for (const t of toks) {
      if (t.used) continue;
      t.used = true;
      let s = t.s;
      for (let li = t.li + 1; li <= t.li + 3; li++) {
        const below = toks.find(u => !u.used && u.li === li && Math.abs(u.x - t.x) < 12);
        if (!below) continue;
        if (isLabel(s) && !hasLabel(below.s)) { s += ' ' + below.s; below.used = true; continue; }
        if (/\d{1,2}[-\/.](\d{1,2}|[A-Za-z]{3})[-\/.]$/.test(s) && /^\d{2,4}$/.test(below.s)) { s += below.s; below.used = true; continue; }
        if (/^member\s*name/i.test(s) && !hasLabel(below.s) && !/\d/.test(below.s)) { s += ' ' + below.s; below.used = true; continue; }
        break;
      }
      out.push({ s, li: t.li, x: t.x });
    }
    return out;
  }

  function pick(block, key) {
    for (const lab of F[key]) {
      const re = new RegExp(`(?:^|\\n)\\s*(?:${lab})\\s*[:\\-]?\\s*${KIND[key]}`, 'i');
      const m = block.match(re);
      if (m) return m[1].trim();
    }
    return '';
  }
  const num = s => { const v = Parse.money(s); return v ? v.n : null; };

  function read(lines) {
    const flat = lines.map(l => l.toks.map(t => t.s).join(' ')).join('\n');
    let score = null;
    const sm = flat.match(/(?:cibil\s*(?:transunion\s*)?score|credit\s*score|your\s*score)[^\d]{0,60}(\d{3})\b/i);
    if (sm && +sm[1] >= 300 && +sm[1] <= 900) score = +sm[1];
    const rep = flat.match(/(?:date|report\s*date|generated\s*on)\s*[:\-]?\s*(\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3})[-/.]\d{2,4})/i);

    const cs = cells(lines);
    // Block starts: each "Member Name" cell. A line just above it with nothing in the member-name column belongs to the new block
    // (table rows are often vertically centred, so the right-hand columns sit a little higher).
    const starts = cs.filter(c => /^member\s*name/i.test(c.s));
    const blocks = starts.map(() => []);
    const lineOwner = li => {
      let b = -1;
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const firstLine = (lines[s.li - 1] && !lines[s.li - 1].toks.some(t => Math.abs(t.x - s.x) < 12)) ? s.li - 1 : s.li;
        if (li >= firstLine) b = i;
      }
      return b;
    };
    for (const c of cs) { const b = lineOwner(c.li); if (b >= 0) blocks[b].push(c.s); }

    const loans = [];
    for (const bl of blocks) {
      const block = bl.join('\n');
      const g = {};
      for (const k of Object.keys(F)) g[k] = pick(block, k);
      if (!g.lender) continue;
      const loan = {
        lender: g.lender.replace(/\s{2,}/g, ' ').trim(),
        type: g.type.trim(),
        acct: g.acct.replace(/\s/g, ''),
        ownership: g.ownership,
        opened: Parse.date(g.opened) || '',
        closed: Parse.date(g.closed) || '',
        reported: Parse.date(g.reported) || '',
        lastPay: Parse.date(g.lastPay) || '',
        sanctioned: num(g.sanctioned) ?? num(g.limit),
        limit: num(g.limit),
        outstanding: num(g.outstanding),
        overdue: num(g.overdue) || 0,
        emi: num(g.emi),
        tenure: g.tenure ? +g.tenure : null,
        rate: g.rate ? +g.rate : null,
      };
      loan.isCard = /credit\s*card/i.test(loan.type);
      loan.status = loan.closed || (loan.outstanding === 0 && !loan.isCard) ? 'closed' : 'open';
      loans.push(loan);
    }
    return { score, reportDate: rep ? Parse.date(rep[1]) : null, loans };
  }
  return { read };
})();
