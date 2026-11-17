// רישיונות: קישורי כניסה חתומים, ספירת הפעלות, מקומות לקבוצה, ומתג "אכיפה" לכל אפליקציה.
// הכול נשמר ב-KV (binding בשם SUBS) תחת המפתחות lic:*.
//   lic:key            מפתח ההנפקה הראשי (HMAC). נוצר בשרת ולא יוצא ממנו.
//   lic:admin          סיסמת הניהול, כגיבוב עם מלח. נקבעת בכניסה הראשונה למסך הניהול.
//   lic:cfg:<app>      { enforce }  האם האפליקציה דורשת רישיון.
//   lic:p:<id>         רישיון: { id, app, name, exp, seats, created, revoked, devs:[{dev,t,seen,gid}], used:[{dev,gid,n,t,seen}], rejects, lastReject }
// קישור אישי:  P.<id>.<חתימה>     קישור הזמנה לקבוצה (מקום מתוך הרישיון של המנהל):  I.<id>.<חתימה>
const te = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const DAY = 86400e3, STALE = 30 * DAY, MAX_DEV = 1;
const APPS = ['athens', 'lisbon'];

async function hmacKey(env) {
  let k = await env.SUBS.get('lic:key');
  if (!k) { k = b64u(crypto.getRandomValues(new Uint8Array(32))); await env.SUBS.put('lic:key', k); }
  return crypto.subtle.importKey('raw', te.encode(k), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function sign(env, kind, id) { return b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), te.encode(kind + '.' + id))).slice(0, 22); }
const token = async (env, kind, id) => `${kind}.${id}.${await sign(env, kind, id)}`;
async function parse(env, tok) {   // מחזיר { kind, id } רק אם החתימה נכונה
  const m = /^([PI])\.([a-z0-9]{6,12})\.([A-Za-z0-9_-]{22})$/.exec(String(tok || '').trim());
  if (!m) return null;
  return (await sign(env, m[1], m[2])) === m[3] ? { kind: m[1], id: m[2] } : null;
}
const getPass = (env, id) => env.SUBS.get('lic:p:' + id, 'json');
const putPass = (env, p) => env.SUBS.put('lic:p:' + p.id, JSON.stringify(p));
const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const okDev = d => /^[a-z0-9]{8,24}$/.test(String(d || ''));
const live = (list, now) => (list || []).filter(x => now - (x.seen || x.t) < STALE);   // הפעלה שלא נפתחה 30 יום מתפנה לבד

async function pwHash(pw, salt) {
  const km = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: te.encode(salt), iterations: 60000, hash: 'SHA-256' }, km, 256));
}
async function admin(env, pw) { const a = await env.SUBS.get('lic:admin', 'json'); return !!a && typeof pw === 'string' && pw.length >= 6 && (await pwHash(pw, a.salt)) === a.hash; }

async function view(env, p, kind, now) {   // מה שהאפליקציה מקבלת על הרישיון שלה
  const used = live(p.used, now).length, owner = kind === 'P';
  return { ok: true, id: p.id, kind: owner ? 'pass' : 'seat', name: owner ? p.name : '', exp: p.exp, seats: owner ? p.seats : 0, used: owner ? used : 0,
    invite: owner && p.seats > 0 ? await token(env, 'I', p.id) : '' };
}

export async function lic(req, env, url, json) {
  const path = url.pathname.slice(5), now = Date.now();
  if (path === 'cfg') { const app = url.searchParams.get('app'); if (!APPS.includes(app)) return json({ error: 'bad app' }, 400);
    return json({ enforce: !!((await env.SUBS.get('lic:cfg:' + app, 'json')) || {}).enforce }); }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  if (path === 'activate') {   // הפעלת קישור על טלפון
    const t = await parse(env, b.token); if (!t || !okDev(b.dev)) return json({ ok: false, why: 'bad' });
    const p = await getPass(env, t.id); if (!p || p.app !== b.app) return json({ ok: false, why: 'bad' });
    if (p.revoked) return json({ ok: false, why: 'revoked' });
    if (p.exp < now) return json({ ok: false, why: 'expired' });
    const key = t.kind === 'P' ? 'devs' : 'used', cap = t.kind === 'P' ? MAX_DEV : p.seats;
    const list = p[key] = live(p[key], now); let me = list.find(x => x.dev === b.dev);
    if (!me) {
      if (list.length >= cap) { p.rejects = (p.rejects || 0) + 1; p.lastReject = now; await putPass(env, p); return json({ ok: false, why: t.kind === 'P' ? 'used' : 'full' }); }
      me = { dev: b.dev, t: now }; list.push(me);
    }
    me.seen = now; if (b.gid) me.gid = String(b.gid).slice(0, 20); if (b.n) me.n = String(b.n).slice(0, 20);
    await putPass(env, p);
    return json(await view(env, p, t.kind, now));
  }
  if (path === 'check') {      // בדיקה תקופתית: האם הרישיון עדיין בתוקף לטלפון הזה
    const p = await getPass(env, String(b.id || '')); if (!p || !okDev(b.dev)) return json({ ok: false, why: 'bad' });
    if (p.revoked) return json({ ok: false, why: 'revoked' });
    if (p.exp < now) return json({ ok: false, why: 'expired' });
    const own = (p.devs || []).find(x => x.dev === b.dev), seat = (p.used || []).find(x => x.dev === b.dev), me = own || seat;
    if (!me) return json({ ok: false, why: 'gone' });
    const stale = now - (me.seen || 0) > 6 * 3600e3, gid = b.gid && String(b.gid).slice(0, 20), n = b.n && String(b.n).slice(0, 20);
    if (stale || (gid && me.gid !== gid) || (n && me.n !== n)) { me.seen = now; if (gid) me.gid = gid; if (n) me.n = n; await putPass(env, p); }
    return json(await view(env, p, own ? 'P' : 'I', now));
  }
  if (path === 'unseat') {     // בעל הרישיון מפנה מקום של משתתף שהוסר מהקבוצה
    const p = await getPass(env, String(b.id || '')); if (!p || !(p.devs || []).some(x => x.dev === b.dev)) return json({ ok: false, why: 'bad' });
    const n = (p.used || []).length; p.used = (p.used || []).filter(x => x.gid !== String(b.gid || ''));
    if (p.used.length !== n) await putPass(env, p);
    return json({ ok: true, freed: n - p.used.length });
  }
  if (path === 'admin') {      // מסך הניהול
    if (b.op === 'state') return json({ claimed: !!(await env.SUBS.get('lic:admin')) });
    if (b.op === 'claim') {    // קביעת הסיסמה, פעם אחת בלבד
      if (await env.SUBS.get('lic:admin')) return json({ ok: false, why: 'claimed' });
      if (typeof b.pw !== 'string' || b.pw.length < 8) return json({ ok: false, why: 'short' });
      const salt = b64u(crypto.getRandomValues(new Uint8Array(12))); await env.SUBS.put('lic:admin', JSON.stringify({ salt, hash: await pwHash(b.pw, salt) }));
      return json({ ok: true });
    }
    if (!(await admin(env, b.pw))) return json({ ok: false, why: 'auth' }, 401);
    if (b.op === 'login') return json({ ok: true });
    if (b.op === 'cfg') { if (!APPS.includes(b.app)) return json({ ok: false, why: 'bad' }); await env.SUBS.put('lic:cfg:' + b.app, JSON.stringify({ enforce: !!b.enforce })); return json({ ok: true, enforce: !!b.enforce }); }
    if (b.op === 'create') {
      if (!APPS.includes(b.app)) return json({ ok: false, why: 'bad' });
      const p = { id: newId(), app: b.app, name: String(b.name || '').slice(0, 40), exp: now + Math.max(1, Math.min(3650, +b.days || 14)) * DAY, seats: Math.max(0, Math.min(200, Math.floor(+b.seats || 0))), created: now, revoked: false, devs: [], used: [], rejects: 0 };
      await putPass(env, p); return json({ ok: true, id: p.id, token: await token(env, 'P', p.id) });
    }
    if (b.op === 'list') {
      const cfg = {}; for (const a of APPS) cfg[a] = !!((await env.SUBS.get('lic:cfg:' + a, 'json')) || {}).enforce;
      const out = []; let cursor;
      do { const r = await env.SUBS.list({ prefix: 'lic:p:', cursor }); cursor = r.list_complete ? null : r.cursor;
        for (const k of r.keys) { const p = await env.SUBS.get(k.name, 'json'); if (p) out.push({ ...p, token: await token(env, 'P', p.id), devs: live(p.devs, now), used: live(p.used, now) }); } } while (cursor);
      out.sort((x, y) => y.created - x.created);
      return json({ ok: true, cfg, passes: out, now });
    }
    const p = await getPass(env, String(b.id || '')); if (!p) return json({ ok: false, why: 'none' });
    if (b.op === 'revoke') p.revoked = b.on !== false;
    else if (b.op === 'extend') p.exp = Math.max(p.exp, now) + Math.max(1, Math.min(3650, +b.days || 14)) * DAY;
    else if (b.op === 'reset') p.devs = [];                                   // לבודק שהחליף טלפון
    else if (b.op === 'seats') p.seats = Math.max(0, Math.min(200, Math.floor(+b.seats || 0)));
    else if (b.op === 'unseat') p.used = (p.used || []).filter(x => x.dev !== b.dev);
    else if (b.op === 'delete') { await env.SUBS.delete('lic:p:' + p.id); return json({ ok: true }); }
    else return json({ ok: false, why: 'op' });
    await putPass(env, p); return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}
