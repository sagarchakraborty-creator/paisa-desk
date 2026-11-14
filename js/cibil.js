// Credit report reader for CIBIL, Experian, CRIF High Mark and Equifax PDFs.
// Rebuilds "LABEL: value" cells from the PDF layout (values often sit on the line below their label, in the same column),
// splits the account section into one block per lender and picks labelled values. Layouts vary, so everything found is
// shown for review and stays editable. Tuned on CIBIL-style samples; other bureaus need a real report to tune.
'use strict';
const Cibil = (() => {
  const DATE = '(\\d{1,2}[-/.](?:\\d{1,2}|[A-Za-z]{3})[-/.]\\d{2,4})';
  const MONEY = '((?:rs\\.?|₹|inr)?\\s*[\\d,]+(?:\\.\\d{1,2})?)';
  const TEXT = '([^\\n]{2,60})';
  const START = /^(member\s*name|lender\s*name|lender|institution(?:\s*name)?|credit\s*grantor|subscriber\s*name|bank\s*name)\s*[:\-]/i;
  const F = {
    lender: [`member\\s*name|lender\\s*name|lender|institution(?:\\s*name)?|credit\\s*grantor|subscriber\\s*name|bank\\s*name`],
    type: [`account\\s*type|loan\\s*type|type\\s*of\\s*(?:loan|account)|type`],
    acct: [`account\\s*(?:number|no\\.?)|a/c\\s*no\\.?|loan\\s*account(?:\\s*no\\.?)?`],
    ownership: [`ownership|ownership\\s*type`],
    opened: [`date\\s*opened|opened(?:\\s*on)?|open\\s*date|date\\s*of\\s*(?:opening|disbursal|disbursement)|disbursed\\s*on|disbursal\\s*date`],
    closed: [`date\\s*closed|closed(?:\\s*on)?|closure\\s*date|date\\s*of\\s*closure`],
    reported: [`date\\s*reported|reported\\s*(?:and|&)\\s*certified|reported\\s*on|last\\s*reported|as\\s*on`],
    lastPay: [`last\\s*payment(?:\\s*date)?|date\\s*of\\s*last\\s*payment`],
    sanctioned: [`sanctioned\\s*amount|sanction\\s*amount|sanction\\s*amt|sanctioned|high(?:est)?\\s*credit|loan\\s*amount|disbursed\\s*amount|disbursed|original\\s*amount`],
    limit: [`credit\\s*limit`],
    outstanding: [`current\\s*balance|current\\s*outstanding|outstanding\\s*balance|balance\\s*outstanding|outstanding|balance`],
    overdue: [`amount\\s*overdue|overdue\\s*amount|amount\\s*past\\s*due|past\\s*due\\s*amount|overdue`],
    emi: [`emi\\s*amount|emi|instal+ment\\s*amount|monthly\\s*instal+ment`],
    tenure: [`repayment\\s*tenure|tenure`],
    rate: [`rate\\s*of\\s*interest|interest\\s*rate|roi`],
  };
  const KIND = { lender: TEXT, type: TEXT, acct: '([A-Za-z0-9*][A-Za-z0-9* -]{3,24}\\d)', ownership: TEXT, opened: DATE, closed: DATE, reported: DATE, lastPay: DATE,
    sanctioned: MONEY, limit: MONEY, outstanding: MONEY, overdue: MONEY, emi: MONEY, tenure: '(\\d{1,3})', rate: '(\\d{1,2}(?:\\.\\d{1,2})?)' };
  const isLabel = s => /:\s*$/.test(s);
  const hasLabel = s => /:/.test(s);

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
        if (START.test(s) && !hasLabel(below.s) && !/\d/.test(below.s)) { s += ' ' + below.s; below.used = true; continue; }
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

  function bureauOf(text) {
    const t = text.toLowerCase();
    const n = re => (t.match(re) || []).length;
    const counts = [['CIBIL', n(/cibil|transunion/g)], ['Experian', n(/experian/g)], ['CRIF High Mark', n(/crif|high\s?mark/g)], ['Equifax', n(/equifax/g)]];
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] ? counts[0][0] : 'CIBIL';
  }

  function read(lines) {
    const flat = lines.map(l => l.toks.map(t => t.s).join(' ')).join('\n');
    const bureau = bureauOf(flat);
    let score = null;
    const sre = /(?:cibil\s*(?:transunion\s*)?score|experian\s*(?:credit\s*)?score|perform\s*consumer[^\d\n]{0,20}score|equifax\s*risk\s*score|risk\s*score|credit\s*score|your\s*score|score)[^\d\n]{0,60}(\d{3})\b/gi;
    let sm;
    while ((sm = sre.exec(flat))) { if (+sm[1] >= 300 && +sm[1] <= 900) { score = +sm[1]; break; } }
    const rep = flat.match(/(?:report\s*date|date\s*of\s*report|generated\s*on|report\s*generated|date)\s*[:\-]?\s*(\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3})[-/.]\d{2,4})/i);

    const cs = cells(lines);
    // A line just above a block start with nothing in the lender column belongs to the new block
    // (table rows are often vertically centred, so right-hand columns sit a little higher).
    const starts = cs.filter(c => START.test(c.s));
    const blocks = starts.map(() => []);
    const firstLines = starts.map(s => (lines[s.li - 1] && !lines[s.li - 1].toks.some(t => Math.abs(t.x - s.x) < 12)) ? s.li - 1 : s.li);
    for (const c of cs) {
      let b = -1;
      for (let i = 0; i < starts.length; i++) if (c.li >= firstLines[i]) b = i;
      if (b >= 0) blocks[b].push(c.s);
    }

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
    return { bureau, score, reportDate: rep ? Parse.date(rep[1]) : null, loans };
  }
  return { read, bureauOf };
})();
