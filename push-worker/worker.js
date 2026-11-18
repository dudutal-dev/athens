// שרת התראות קטן (Cloudflare Worker) לאפליקציית אתונה.
// שומר לכל קבוצה את מנויי ה-Web Push של הטלפונים, ושולח התראה לכולן כשמגיעה הודעה.
// אין כאן סודות: מפתחות ה-VAPID נוצרים בהפעלה הראשונה ונשמרים ב-KV (binding בשם SUBS).
import { lic } from './lic.js';
const te = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });

async function vapid(env) {
  let v = await env.SUBS.get('vapid', 'json');
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    v = { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
    await env.SUBS.put('vapid', JSON.stringify(v));
  }
  return v;
}
async function vapidHeader(v, endpoint, subject) {
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
}
// הצפנת התוכן לפי RFC 8291 (aes128gcm)
export async function encrypt(sub, payload, fixed) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = fixed?.keys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256);
  const hkdf = async (salt, ikm, info, len) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info },
    await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));
  const ikm = await hkdf(auth, secret, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = fixed?.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']), cat(te.encode(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);
}
async function push(env, sub, payload, subject) {
  const v = await vapid(env);
  return fetch(sub.endpoint, { method: 'POST', body: await encrypt(sub, payload),
    headers: { authorization: await vapidHeader(v, sub.endpoint, subject), ttl: '43200', urgency: 'high', 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream' } });
}
const okEndpoint = u => { try { const h = new URL(u).host; return /(^|\.)push\.apple\.com$|(^|\.)googleapis\.com$|(^|\.)mozilla\.com$|(^|\.)windows\.com$/.test(h); } catch { return false; } };

// חדר של קבוצה (Durable Object): שומר את ההודעות המוצפנות של שלושת הימים האחרונים ומעביר כל הודעה חדשה מיד לכל הטלפונים המחוברים.
// הפורמט זהה לזה של ntfy, כדי שהאפליקציה תקרא את שני המקורות באותה דרך.
export class Room {
  constructor(state) {
    this.state = state; this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS m (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, b TEXT)');
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('upgrade') === 'websocket') {
      const pair = new WebSocketPair(), since = parseInt(url.searchParams.get('since'), 10) || 0;
      this.state.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ event: 'open' }));
      for (const r of this.sql.exec('SELECT id, t, b FROM m WHERE id > ? ORDER BY id', since)) pair[1].send(JSON.stringify({ id: String(r.id), time: r.t, event: 'message', message: r.b }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (req.method === 'POST') {
      const b = await req.text(); if (!b || b.length > 16000) return json({ error: 'bad message' }, 413);
      const t = Math.floor(Date.now() / 1000), id = this.sql.exec('INSERT INTO m (t, b) VALUES (?, ?) RETURNING id', t, b).one().id;
      this.sql.exec('DELETE FROM m WHERE t < ? OR id <= ?', t - 3 * 86400, id - 3000);
      const msg = JSON.stringify({ id: String(id), time: t, event: 'message', message: b });
      for (const ws of this.state.getWebSockets()) try { ws.send(msg); } catch { /* נסגר */ }
      return json({ id: String(id), time: t, event: 'message' });
    }
    return json({ error: 'method' }, 405);
  }
  webSocketMessage() { /* הטלפונים רק מקשיבים; ping נענה אוטומטית */ }
  webSocketClose(ws) { try { ws.close(); } catch { /* כבר סגור */ } }
  webSocketError(ws) { try { ws.close(); } catch { /* כבר סגור */ } }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      if (url.pathname.startsWith('/lic/')) return await lic(req, env, url, json);
      // העברת הזמנה מהדפדפן של האייפון לאפליקציה שבמסך הבית (שני אחסונים נפרדים באותו טלפון).
      // הדפדפן משאיר כאן את קוד הקבוצה לרבע שעה, לפי כתובת הרשת וסוג המכשיר, והאפליקציה אוספת אותו בפתיחה הראשונה.
      if (url.pathname === '/h/put' || url.pathname === '/h/get') {
        if (req.method !== 'POST') return json({ error: 'method' }, 405);
        const hb = await req.json(), app = String(hb.app || '');
        if (!/^[a-z]{3,12}$/.test(app)) return json({ error: 'bad app' }, 400);
        // ההתאמה לפי תיאור המכשיר שהאפליקציה שולחת (מסך, שפה, אזור זמן): הוא זהה בדפדפן ובאפליקציה שבמסך הבית, גם כשכתובת הרשת שונה
        const fp = String(hb.fp || '').slice(0, 160), who = app + '|' + (fp || (req.headers.get('cf-connecting-ip') || 'local'));
        const hk = 'h:' + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(who))))).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
        if (url.pathname === '/h/put') {
          if (!/^[A-Za-z0-9-]{6,20}$/.test(String(hb.j || ''))) return json({ error: 'bad code' }, 400);
          await env.SUBS.put(hk, JSON.stringify({ j: hb.j, k: /^[PI]\.[a-z0-9]{6,12}\.[A-Za-z0-9_-]{22}$/.test(String(hb.k || '')) ? hb.k : '', t: Date.now() }), { expirationTtl: 900 });
          return json({ ok: true });
        }
        const hv = await env.SUBS.get(hk, 'json'); if (!hv || Date.now() - hv.t > 900e3) return json({ ok: true });
        await env.SUBS.delete(hk); return json({ ok: true, j: hv.j, k: hv.k });
      }   // רישיונות (lic.js)
      const rm = url.pathname.match(/^\/r\/([a-z0-9]{10,40})(\/ws)?$/);
      if (rm) { if (!env.ROOMS) return json({ error: 'no rooms' }, 503); return env.ROOMS.get(env.ROOMS.idFromName(rm[1])).fetch(req); }
      // קבצים גדולים של הקבוצה (סרטונים): נשמרים ב-R2 (binding בשם FILES) כשהם כבר מוצפנים בטלפון. נמחקים לבד אחרי 30 יום
      const fm = url.pathname.match(/^\/f\/([a-z0-9]{10,40})\/([a-z0-9]{4,32})$/);
      if (fm) {
        if (!env.FILES) return json({ error: 'no storage' }, 503);
        const k = fm[1] + '/' + fm[2];
        if (req.method === 'PUT') {
          const len = +req.headers.get('content-length') || 0;
          if (!len || len > 99e6) return json({ error: 'too big' }, 413);
          await env.FILES.put(k, req.body); return json({ ok: true });
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const o = await env.FILES.get(k); if (!o) return json({ error: 'gone' }, 404);
          return new Response(req.method === 'HEAD' ? null : o.body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(o.size), 'cache-control': 'private, max-age=86400', ...CORS } });
        }
        return json({ error: 'method' }, 405);
      }
      if (url.pathname === '/fx') {   // שער אירו–שקל: שער שוק עדכני, נשמר ל־10 דקות; אם המקור לא עונה – השער היומי של הבנק המרכזי האירופי
        const c = await env.SUBS.get('fx:eurils', 'json'); if (c && Date.now() - c.t < 600e3) return json(c);
        let o = null;
        try { const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/EURILS=X?interval=1d&range=1d', { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
          const m = (await r.json()).chart.result[0].meta, v = +m.regularMarketPrice;
          if (v > 2 && v < 8) o = { rate: +v.toFixed(3), at: (+m.regularMarketTime || 0) * 1000, live: 1 }; } catch {}
        if (!o) try { const j = await (await fetch('https://api.frankfurter.app/latest?from=EUR&to=ILS')).json(); if (j.rates && j.rates.ILS) o = { rate: +(+j.rates.ILS).toFixed(3), date: j.date }; } catch {}
        if (!o) return c ? json(c) : json({ error: 'no rate' }, 502);
        o.t = Date.now(); await env.SUBS.put('fx:eurils', JSON.stringify(o)); return json(o);
      }
      if (url.pathname === '/key') return json({ key: (await vapid(env)).pub });
      if (req.method !== 'POST') return json({ ok: true, service: 'athens-push' });
      const b = await req.json(), g = String(b.g || '');
      if (!/^[a-z0-9]{10,40}$/.test(g)) return json({ error: 'bad group' }, 400);
      const k = 'g:' + g; let list = (await env.SUBS.get(k, 'json')) || [];
      if (url.pathname === '/sub') {
        if (!b.sub?.endpoint || !b.sub?.keys?.p256dh || !b.sub?.keys?.auth || !okEndpoint(b.sub.endpoint)) return json({ error: 'bad subscription' }, 400);
        list = list.filter(x => x.d !== b.d && x.sub.endpoint !== b.sub.endpoint); list.push({ d: String(b.d || '').slice(0, 20), sub: b.sub });
        if (list.length > 30) list = list.slice(-30);
        await env.SUBS.put(k, JSON.stringify(list)); return json({ ok: true, n: list.length });
      }
      if (url.pathname === '/unsub') { await env.SUBS.put(k, JSON.stringify(list.filter(x => x.d !== b.d))); return json({ ok: true }); }
      if (url.pathname === '/push') {
        const payload = JSON.stringify({ title: String(b.title || '').slice(0, 80), body: String(b.body || '').slice(0, 300) });
        const subject = String(b.site || 'https://example.com/').slice(0, 200);
        const res = await Promise.all(list.filter(x => x.d !== b.d || b.self).map(async x => { try { const r = await push(env, x.sub, payload, subject); return { d: x.d, s: r.status, t: r.ok ? '' : (await r.text()).slice(0, 200) }; } catch (e) { return { d: x.d, s: 0, t: String(e).slice(0, 200) }; } }));
        const dead = res.filter(r => r.s === 404 || r.s === 410).map(r => r.d);
        if (dead.length) await env.SUBS.put(k, JSON.stringify(list.filter(x => !dead.includes(x.d))));
        return json({ ok: true, sent: res.filter(r => r.s >= 200 && r.s < 300).length, results: res });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: String(e).slice(0, 300) }, 500); }
  },
};
