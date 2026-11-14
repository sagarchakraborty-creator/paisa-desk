// Categories, merchant names and auto-categorisation rules tuned for Indian bank / UPI narrations.
'use strict';
const Cat = (() => {
  // kind: exp = spending, inc = income, inv = saving/investing, xfer = moving own money (left out of income and spend)
  const LIST = [
    ['Food & dining', 'exp', '🍽️'], ['Groceries', 'exp', '🛒'], ['Shopping', 'exp', '🛍️'], ['Transport & fuel', 'exp', '⛽'],
    ['Travel', 'exp', '✈️'], ['Bills & utilities', 'exp', '💡'], ['Rent & housing', 'exp', '🏠'], ['Health', 'exp', '💊'],
    ['Education', 'exp', '🎓'], ['Entertainment', 'exp', '🎬'], ['Insurance', 'exp', '🛡️'], ['EMI & loans', 'exp', '🏦'],
    ['Cash withdrawal', 'exp', '💵'], ['Fees & charges', 'exp', '🧾'], ['Family & people', 'exp', '👪'], ['Others', 'exp', '•'],
    ['Salary', 'inc', '💼'], ['Interest & dividends', 'inc', '📈'], ['Refunds & cashback', 'inc', '↩️'], ['Other income', 'inc', '➕'],
    ['Investments', 'inv', '📊'],
    ['Self transfer', 'xfer', '🔁'], ['Credit card bill', 'xfer', '💳'], ['Wallet top-up', 'xfer', '👛'],
  ];
  const KIND = Object.fromEntries(LIST.map(([n, k]) => [n, k]));
  const ICON = Object.fromEntries(LIST.map(([n, , i]) => [n, i]));

  const KW = {
    'Credit card bill': ['credit card', 'cc payment', 'card payment', 'cred club', 'cred', 'ccbill', 'cc bill', 'card bill', 'autopay si', 'bbps cc'],
    'Wallet top-up': ['add money', 'added to wallet', 'wallet topup', 'wallet top up', 'wallet load', 'load money', 'paytm wallet', 'amazon pay balance'],
    'Self transfer': ['self transfer', 'to self', 'own account', 'own a/c', 'sweep', 'self a/c'],
    'Salary': ['salary', 'sal cr', 'sal for', 'payroll', 'wages', 'stipend'],
    'Interest & dividends': ['interest', 'int pd', 'int.pd', 'int cr', 'int.cr', 'dividend', 'ach c', 'achcr'],
    'Refunds & cashback': ['refund', 'cashback', 'cash back', 'reversal', 'rev-', 'chargeback'],
    'Investments': ['zerodha', 'groww', 'kuvera', 'mutual fund', 'sip', 'bse star', 'nse clearing', 'indian clearing', 'iccl', 'ppf', 'nps', 'sukanya', 'rd inst', 'recurring deposit', 'fd booking', 'fixed deposit', 'smallcase', 'upstox', 'angel one', 'angelone', 'paytm money', 'coin by', 'icici sec', 'hdfc sec', 'kotak sec', 'motilal', 'etmoney', 'scripbox', 'gold bond', 'sgb'],
    'EMI & loans': ['emi', 'loan', 'nach', 'ach d', 'ach-d', 'achdr', 'ecs', 'bajaj finance', 'bajaj finserv', 'home credit', 'tata capital', 'hdb financial', 'hdbfs', 'idfc first loan', 'lendingkart', 'moneyview', 'kreditbee', 'navi', 'cashe', 'muthoot', 'manappuram', 'housing finance', 'lic hfl', 'pnb housing'],
    'Insurance': ['insurance', 'lic of india', 'licindia', 'policybazaar', 'hdfc life', 'icici pru', 'sbi life', 'max life', 'star health', 'care health', 'niva bupa', 'acko', 'go digit', 'bajaj allianz', 'tata aia', 'premium'],
    'Food & dining': ['swiggy', 'zomato', 'eatsure', 'eatfit', 'dominos', 'domino', 'mcdonald', 'kfc', 'pizza', 'restaurant', 'cafe', 'starbucks', 'chaayos', 'haldiram', 'burger', 'biryani', 'dineout', 'barbeque', 'subway', 'bakery', 'sweets', 'dhaba', 'food'],
    'Groceries': ['blinkit', 'zepto', 'bigbasket', 'big basket', 'instamart', 'dmart', 'avenue supermarts', 'jiomart', 'grofers', 'reliance fresh', 'reliance retail', 'more retail', 'spencer', 'nature s basket', 'milkbasket', 'country delight', 'licious', 'freshtohome', 'kirana', 'supermarket', 'grocery', 'vegetable', 'dairy', 'swiggy instamart', 'flipkart minutes'],
    'Shopping': ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'tata cliq', 'croma', 'reliance digital', 'decathlon', 'lifestyle', 'westside', 'pantaloons', 'ikea', 'lenskart', 'firstcry', 'shoppers stop', 'h&m', 'zara', 'uniqlo', 'snapdeal', 'pepperfry', 'urban ladder'],
    'Transport & fuel': ['uber', 'ola', 'rapido', 'petrol', 'fuel', 'hpcl', 'bpcl', 'iocl', 'indian oil', 'bharat petroleum', 'hindustan petroleum', 'shell', 'fastag', 'metro', 'parking', 'toll', 'namma yatri', 'blusmart', 'service station', 'filling station'],
    'Travel': ['irctc', 'makemytrip', 'goibibo', 'cleartrip', 'yatra', 'indigo', 'interglobe', 'air india', 'vistara', 'akasa', 'spicejet', 'redbus', 'oyo', 'airbnb', 'booking com', 'agoda', 'ixigo', 'easemytrip', 'hotel', 'resort'],
    'Bills & utilities': ['electricity', 'bescom', 'cesc', 'wbsedcl', 'tata power', 'adani elec', 'msedcl', 'mseb', 'tneb', 'tangedco', 'bses', 'torrent power', 'airtel', 'jio', 'vodafone', 'vi', 'bsnl', 'act fibernet', 'hathway', 'broadband', 'dth', 'tata play', 'tatasky', 'indane', 'hp gas', 'bharatgas', 'bharat gas', 'mahanagar gas', 'igl', 'water bill', 'bbps', 'recharge', 'postpaid', 'prepaid', 'municipal', 'property tax'],
    'Rent & housing': ['rent', 'nobroker', 'maintenance', 'society', 'housing com', 'apartment', 'landlord'],
    'Health': ['apollo', 'pharmeasy', '1mg', 'tata 1mg', 'netmeds', 'medplus', 'hospital', 'clinic', 'pharmacy', 'medical', 'medicos', 'chemist', 'diagnostic', 'lal path', 'thyrocare', 'practo', 'dental', 'healthcare'],
    'Education': ['school', 'college', 'university', 'tuition', 'byju', 'unacademy', 'udemy', 'coursera', 'vedantu', 'physics wallah', 'exam fee', 'icai', 'books'],
    'Entertainment': ['netflix', 'hotstar', 'disney', 'spotify', 'prime video', 'amazon prime', 'youtube', 'google play', 'apple com', 'bookmyshow', 'pvr', 'inox', 'zee5', 'sonyliv', 'jiocinema', 'cult fit', 'cultfit', 'gaana', 'audible', 'steam', 'playstation'],
    'Cash withdrawal': ['atm', 'cash wdl', 'nwd', 'cash withdrawal', 'atw', 'cwdr', 'self chq', 'cash paid'],
    'Fees & charges': ['charges', 'chrg', 'chgs', 'annual fee', 'sms alert', 'min bal', 'minimum balance', 'penalty', 'late payment', 'gst on', 'service charge', 'processing fee', 'debit card fee', 'amc'],
  };
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  KW['Insurance'] = KW['Insurance'].filter(w => w !== 'premium');
  // Groceries before Food so "Swiggy Instamart" is not read as a food order.
  const order = ['Groceries', ...Object.keys(KW).filter(k => k !== 'Groceries')];
  const RULES = order.map(c => [c, KW[c]]).map(([cat, words]) => [cat, new RegExp(`(^|[^a-z0-9])(${words.map(esc).join('|')})([^a-z0-9]|$)`)]);

  const STOP = new Set(['UPI', 'DR', 'CR', 'NEFT', 'IMPS', 'RTGS', 'POS', 'ECOM', 'ACH', 'NACH', 'ECS', 'MB', 'IB', 'INB', 'BIL', 'ONL', 'TPT', 'TO', 'FROM', 'TRF', 'TRANSFER',
    'REF', 'NO', 'PAYMENT', 'TXN', 'P2M', 'P2A', 'PAY', 'PAYTM', 'YBL', 'OKAXIS', 'OKHDFCBANK', 'OKICICI', 'OKSBI', 'IBL', 'AXL', 'APL', 'BANK', 'LTD', 'LIMITED', 'PVT',
    'PRIVATE', 'INDIA', 'SENT', 'USING', 'VIA', 'THE', 'AND', 'OF', 'MMT', 'IN', 'NA', 'VPS', 'IPS', 'BY', 'FOR', 'A', 'C', 'AC', 'MOB', 'NETBANK', 'BRN', 'CLG',
    'NWD', 'TILL', 'WDL', 'ORDER', 'BILL', 'SUB']);
  // Drop reference codes (any word with a digit), masks like XX1234, and banking jargon; keep up to 3 name words.
  const tidy = s => String(s).split(/[\s\/|:;,_-]+/).filter(w => !/\d/.test(w) && !/^x+$/i.test(w)).map(w => w.replace(/[^A-Za-z&]/g, ''))
    .filter(w => w.length > 1 && !STOP.has(w.toUpperCase())).slice(0, 3).join(' ');
  const title = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

  function merchant(desc) {
    const s = String(desc || '');
    let m;
    if ((m = s.match(/^(?:paid to|sent to|money sent to|received from|money received from|transferred to|payment to|paid for)\s+([^·|,\/]{2,40})/i))) return title(tidy(m[1]) || m[1].trim());
    // UPI/DR/412345678901/SWIGGY LTD/YESB/swiggy@ybl/... and UPI/412345678901/Paid to x/...
    if ((m = s.match(/UPI[\/:-](?:(?:DR|CR|P2M|P2A)[\/:-])?\d{6,}[\/:-]([^\/:]{2,40})/i))) { const t = tidy(m[1]); if (t) return title(t); }
    // HDFC: UPI-SWIGGY LTD-swiggy@ybl-YESB0000001-412345678901-Payment
    if ((m = s.match(/^UPI-([^-]{2,40})-/i))) { const t = tidy(m[1]); if (t) return title(t); }
    // POS 4321XXXXXX1234 AMAZON PAY / ECOM PUR / ATM WDL
    if ((m = s.match(/(?:POS|ECOM|PUR)\s*(?:\d[\dX*]{6,}\s*)?([A-Za-z][A-Za-z .&]{2,40})/i))) { const t = tidy(m[1]); if (t) return title(t); }
    if ((m = s.match(/(?:NEFT|IMPS|RTGS)[\/:-]+(?:[A-Z0-9]{6,}[\/:-]+)?([A-Za-z][A-Za-z .&]{2,40})/i))) { const t = tidy(m[1]); if (t) return title(t); }
    if ((m = s.match(/([A-Za-z0-9._-]{2,})@[a-z]{2,}/i))) { const t = tidy(m[1].replace(/[._-]/g, ' ')); if (t) return title(t); }
    return title(tidy(s) || s.slice(0, 24));
  }
  const key = m => String(m || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // Auto category (manual choices and remembered rules are applied by the app before this).
  function guess(desc, amt, tags) {
    const t = ' ' + String(desc || '').toLowerCase().replace(/[._\/@-]/g, ' ') + ' ' + String(tags || '').toLowerCase().replace(/#/g, ' ') + ' ';
    for (const [cat, re] of RULES) {
      if (!re.test(t)) continue;
      const k = KIND[cat];
      if (amt > 0 && k === 'exp') return 'Refunds & cashback';
      if (amt < 0 && k === 'inc') continue;
      return cat;
    }
    if (amt > 0) return 'Other income';
    return 'Others';
  }
  return { LIST, KIND, ICON, merchant, key, guess, names: LIST.map(x => x[0]) };
})();
