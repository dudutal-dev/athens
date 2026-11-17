// שרת התראות קטן (Cloudflare Worker) לאפליקציית אתונה.
// שומר לכל קבוצה את מנויי ה-Web Push של הטלפונים, ושולח התראה לכולן כשמגיעה הודעה.
// אין כאן סודות: מפתחות ה-VAPID נוצרים בהפעלה הראשונה ונשמרים ב-KV (binding בשם SUBS).
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
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
