// Encrypted on-device storage. The whole ledger is one JSON blob, encrypted with AES-GCM using a key
// derived from the user's passcode (PBKDF2-SHA256). Only ciphertext is written to IndexedDB or to backup files.
// All github.io apps share one browser origin, so encryption also keeps other apps on that origin out.
'use strict';
const Store = (() => {
  const DB = 'paisadesk', OS = 'kv', KEY = 'vault', ITER = 250000;
  let key = null, salt = null;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(OS);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function get(k) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction(OS).objectStore(OS).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  }
  async function put(k, v) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction(OS, 'readwrite'); t.objectStore(OS).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
  async function del(k) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction(OS, 'readwrite'); t.objectStore(OS).delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }

  async function derive(pass, saltU8) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltU8, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(obj, k = key, s = salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(obj))));
    return { app: 'paisa-desk', v: 1, iter: ITER, salt: b64(s), iv: b64(iv), ct: b64(ct), at: new Date().toISOString() };
  }
  async function open(vault, k) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, k, unb64(vault.ct));
    return JSON.parse(dec.decode(pt));
  }

  return {
    async exists() { return !!(await get(KEY)); },
    async create(pass, data) {
      salt = crypto.getRandomValues(new Uint8Array(16));
      key = await derive(pass, salt);
      await put(KEY, await seal(data));
    },
    async unlock(pass) {
      const v = await get(KEY);
      const s = unb64(v.salt);
      const k = await derive(pass, s);
      const data = await open(v, k); // throws on wrong passcode
      key = k; salt = s;
      return data;
    },
    async save(data) { if (!key) throw new Error('locked'); await put(KEY, await seal(data)); },
    async changePass(pass, data) { salt = crypto.getRandomValues(new Uint8Array(16)); key = await derive(pass, salt); await put(KEY, await seal(data)); },
    lock() { key = null; },
    get unlocked() { return !!key; },
    async backup(data) { return seal(data); },
    // Restore a backup file; tries the current key first, then asks for that file's passcode.
    async readBackup(vault, askPass) {
      if (!vault || vault.app !== 'paisa-desk' || !vault.ct) throw new Error('Not a Paisa Desk backup file.');
      if (key && salt && b64(salt) === vault.salt) { try { return await open(vault, key); } catch (e) { /* fall through */ } }
      const pass = await askPass();
      if (pass == null) throw new Error('Cancelled.');
      return open(vault, await derive(pass, unb64(vault.salt)));
    },
    async wipe() { key = null; await del(KEY); },
    // Files shared into the app from other apps (Android share sheet) wait in this cache until imported.
    async takeShared() {
      if (!('caches' in window)) return [];
      const c = await caches.open('paisadesk-share');
      const reqs = await c.keys();
      const files = [];
      for (const r of reqs) {
        const res = await c.match(r);
        const blob = await res.blob();
        const name = decodeURIComponent(res.headers.get('x-name') || 'shared-file');
        files.push(new File([blob], name, { type: blob.type }));
        await c.delete(r);
      }
      return files;
    },
  };
})();
