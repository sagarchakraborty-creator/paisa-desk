// Gmail: find statement attachments and download them straight into the app.
// Uses Google Identity Services (token in memory only, read-only scope, about 1 hour) and the Gmail REST API.
// Mail and attachments go from Google to this device; nothing passes through any other server.
'use strict';
const Gmail = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  let token = null, tokenExp = 0, client = null, clientFor = null, gisReady = null;

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (!gisReady) gisReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => res(); s.onerror = () => { gisReady = null; rej(new Error('Could not load Google sign-in. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return gisReady;
  }

  async function signIn(clientId) {
    if (token && Date.now() < tokenExp - 60000) return token;
    await loadGis();
    return new Promise((res, rej) => {
      if (!client || clientFor !== clientId) {
        clientFor = clientId;
        client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
      }
      client.callback = r => {
        if (r.error) return rej(new Error(r.error === 'access_denied' ? 'Gmail access was not allowed.' : `Google sign-in failed (${r.error}).`));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return rej(new Error('Please tick "Read your email" on the Google screen so the app can find statements.'));
        token = r.access_token; tokenExp = Date.now() + (+r.expires_in || 3600) * 1000;
        res(token);
      };
      client.error_callback = e => rej(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed.' : e?.type === 'popup_failed_to_open' ? 'The Google sign-in window was blocked. Allow pop-ups for this app and try again.' : 'Google sign-in failed.'));
      client.requestAccessToken({ prompt: token ? '' : 'select_account' });
    });
  }
  function signOut() { if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {}); token = null; tokenExp = 0; }

  async function api(path) {
    const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) { token = null; throw new Error('Gmail sign-in expired. Search again to sign in.'); }
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).error?.message || ''; } catch { /* ignore */ }
      if (r.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error('The Gmail API is not switched on in your Google Cloud project (setup step 2).');
      throw new Error(`Gmail error ${r.status}${msg ? ': ' + msg : ''}`);
    }
    return r.json();
  }

  // Default search: statement-like mail with a PDF/Excel/CSV attachment.
  function query(months, extra) {
    const words = '(statement OR "e-statement" OR estatement OR "account summary" OR "credit report" OR cibil OR experian OR crif OR equifax OR paytm OR "transaction history" OR passbook)';
    const files = '(filename:pdf OR filename:xlsx OR filename:xls OR filename:csv)';
    return `has:attachment ${files} newer_than:${months}m ${extra && extra.trim() ? extra.trim() : words}`;
  }

  function parseFrom(v) {
    const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
    const email = (m ? m[2] : String(v || '')).trim().toLowerCase();
    return { name: (m && m[1].trim()) || email, email, domain: email.split('@')[1] || email };
  }
  function attachmentsOf(part, out = []) {
    if (!part) return out;
    if (part.filename && part.body?.attachmentId && /\.(pdf|xlsx|xls|csv)$/i.test(part.filename)) out.push({ name: part.filename, attId: part.body.attachmentId, size: part.body.size || 0, mime: part.mimeType });
    for (const p of part.parts || []) attachmentsOf(p, out);
    return out;
  }

  async function search(months, extra, onProgress) {
    const q = query(months, extra);
    const ids = [];
    let page = '';
    do {
      const r = await api(`/messages?maxResults=100&q=${encodeURIComponent(q)}${page ? '&pageToken=' + page : ''}`);
      for (const m of r.messages || []) ids.push(m.id);
      page = r.nextPageToken || '';
    } while (page && ids.length < 300);
    const fields = 'id,internalDate,payload(headers,filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size)))))';
    const items = [];
    for (let i = 0; i < ids.length; i += 8) {
      const batch = await Promise.all(ids.slice(i, i + 8).map(id => api(`/messages/${id}?format=full&fields=${encodeURIComponent(fields)}`)));
      for (const m of batch) {
        const h = Object.fromEntries((m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
        const from = parseFrom(h.from);
        for (const a of attachmentsOf(m.payload)) items.push({ msgId: m.id, ...a, from, subject: h.subject || '(no subject)', date: new Date(+m.internalDate).toISOString().slice(0, 10) });
      }
      onProgress && onProgress(Math.min(ids.length, i + 8), ids.length);
    }
    return { q, items };
  }

  async function download(item) {
    const r = await api(`/messages/${item.msgId}/attachments/${item.attId}`);
    const b64 = r.data.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const type = /\.pdf$/i.test(item.name) ? 'application/pdf' : /\.csv$/i.test(item.name) ? 'text/csv' : 'application/octet-stream';
    const f = new File([u8], item.name, { type });
    f.sender = item.from.domain;
    return f;
  }

  return { signIn, signOut, search, download, query, preload: loadGis, get signedIn() { return !!token && Date.now() < tokenExp; } };
})();
