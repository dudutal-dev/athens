/* הבנות: קבוצה עם קוד משותף – צ׳אט, מיקום חי ומקומות משותפים.
   ההודעות עוברות דרך ntfy.sh כשהן מוצפנות בטלפון (AES-GCM) עם מפתח שנגזר מהקוד, כך שהשרת רואה רק ג׳יבריש. */
(() => {
  const A = window.APP, $ = s => document.querySelector(s), esc = A.esc;
  const BASE = 'https://ntfy.sh/', GK = 'athina.group';
  const te = new TextEncoder(), td = new TextDecoder();
  const blank = () => ({ code: '', name: '', id: Math.random().toString(36).slice(2, 10), share: false, msgs: [], members: {}, favs: {}, last: '' });
  let G = blank();
  try { G = { ...G, ...JSON.parse(localStorage.getItem(GK) || '{}') }; } catch {}
  const save = () => { try { localStorage.setItem(GK, JSON.stringify(G)); } catch {} };
  let key = null, topic = '', ntopic = '', es = null, retry = null, unread = 0, online = false;

  // ───── הצפנה ─────
  const norm = c => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const b64 = u8 => { let s = ''; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(code) {
    const c = norm(code);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('athina-topic:' + c)));
    topic = 'ath' + [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
    const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('athina-notify:' + c)));
    ntopic = 'athn' + [...h2.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('');
    const km = await crypto.subtle.importKey('raw', te.encode(c), 'PBKDF2', false, ['deriveKey']);
    key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: te.encode('athina-group-v1'), iterations: 100000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function enc(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
  }
  async function dec(s) { const raw = unb64(s); return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)))); }

  // ───── רשת ─────
  async function send(obj) {
    if (!key) return false;
    try {
      const r = await fetch(BASE + topic, { method: 'POST', body: await enc({ ...obj, n: G.name, d: G.id, ts: Date.now() }) });
      if (r.status === 429) { A.toast('הגענו למגבלת ההודעות של השירות. נסי שוב בעוד כמה דקות'); return false; }
      return r.ok;
    } catch { if (obj.t === 'chat') A.toast('אין חיבור – ההודעה לא נשלחה'); return false; }
  }
  // חיבור חי: WebSocket (מיידי), ואם הוא לא נפתח – SSE
  let ws = null, wsFails = 0;
  function onRaw(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.event !== 'message' || !m.message) return;
    G.last = m.id;
    dec(m.message).then(p => handle(p, m.id, m.attachment && m.attachment.url)).catch(() => {});   // הודעה שלא נפתחת עם המפתח שלנו – מתעלמים
  }
  const live = () => (ws && ws.readyState === 1) || (es && es.readyState === 1);
  function connect() {
    clearTimeout(retry); if (es) { es.close(); es = null; } if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
    if (!key) return;
    const since = encodeURIComponent(G.last || '12h');
    if (wsFails < 2 && 'WebSocket' in window) {
      let opened = false;
      try { ws = new WebSocket('wss://ntfy.sh/' + topic + '/ws?since=' + since); } catch { wsFails = 2; return connect(); }
      ws.onopen = () => { opened = true; wsFails = 0; online = true; status(); };
      ws.onmessage = ev => onRaw(ev.data);
      ws.onclose = () => { online = false; status(); if (!opened) wsFails++; retry = setTimeout(connect, opened ? 1500 : 400); };
      return;
    }
    es = new EventSource(BASE + topic + '/sse?since=' + since);
    es.onopen = () => { online = true; status(); };
    es.onmessage = ev => onRaw(ev.data);
    es.onerror = () => { online = false; status(); es.close(); retry = setTimeout(connect, 4000); };
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && key && !live()) connect(); });
  addEventListener('online', () => key && connect());

  // צליל קצר להודעה נכנסת
  let actx = null;
  function beep() { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), v = actx.createGain();
    o.frequency.value = 880; v.gain.setValueAtTime(.12, actx.currentTime); v.gain.exponentialRampToValueAtTime(.001, actx.currentTime + .25);
    o.connect(v).connect(actx.destination); o.start(); o.stop(actx.currentTime + .25); navigator.vibrate?.(80); } catch {} }

  // ───── יומן משותף: התמונה מוצפנת בטלפון ועולה כקובץ מצורף ─────
  async function encBytes(buf) { const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; }
  async function decBytes(buf) { const raw = new Uint8Array(buf); return crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)); }
  const served = {}, asked = {};
  async function shareEntry(e, withImage) {
    if (!key) return false;
    try {
      const meta = { id: e.id, ts: e.ts, type: e.type, text: e.text, place: e.place, tags: e.tags, w: e.w, h: e.h };
      const payload = await enc({ t: 'j', e: meta, n: G.name, d: G.id, ts: Date.now() });
      let r;
      if (e.type === 'photo' && e.blob && withImage) {
        const small = await A.journal.shrink(e.blob, 1280), body = await encBytes(await small.arrayBuffer());
        r = await fetch(BASE + topic + '?filename=p.bin&message=' + encodeURIComponent(payload), { method: 'POST', body });
      } else r = await fetch(BASE + topic, { method: 'POST', body: payload });
      if (r.ok) served[e.id] = Date.now();
      return r.ok;
    } catch { return false; }
  }
  A.hooks.inGroup = () => !!key;
  A.hooks.shareEntry = shareEntry;
  A.hooks.unshareEntry = id => send({ t: 'jdel', id });
  async function journalIn(p, url) {
    const J = A.journal; if (!J || p.d === G.id || !p.e || !p.e.id) return;
    let e = await J.get(p.e.id).catch(() => null); const isNew = !e;
    if (e && !e.byId) return;                                    // רשומה שלי – לא דורסים
    e = e ? { ...e, text: p.e.text, place: p.e.place, tags: p.e.tags || [] } : { ...p.e, tags: p.e.tags || [], shared: true, by: p.n, byId: p.d };
    if (e.type === 'photo' && !e.blob && url) try { e.blob = new Blob([await decBytes(await (await fetch(url)).arrayBuffer())], { type: 'image/jpeg' }); served[e.id] = Date.now(); } catch {}
    await J.put(e).catch(() => {}); J.render();
    if (e.type === 'photo' && !e.blob && !(Date.now() - (asked[e.id] || 0) < 10 * 60e3)) { asked[e.id] = Date.now(); send({ t: 'jreq', id: e.id }); }  // הקובץ פג תוקף – מבקשים ממי שיש לה
    if (isNew && Date.now() - p.ts < 10 * 60e3 && $('#v-journal').hidden) A.toast(`${p.n} הוסיפה ${e.type === 'photo' ? 'תמונה' : 'רשומה'} ליומן`, 4000);
  }
  async function journalReq(p) {   // מישהי חסרה תמונה: מי שמחזיקה אותה מעלה שוב, אחרי השהיה אקראית כדי שרק אחת תענה
    const J = A.journal; if (!J || p.d === G.id) return;
    const e = await J.get(p.id).catch(() => null); if (!e || !e.blob || !e.shared) return;
    const t0 = Date.now(); await new Promise(r => setTimeout(r, (e.byId ? 2500 : 300) + Math.random() * 3000));
    if ((served[e.id] || 0) >= t0) return;
    served[e.id] = Date.now();
    const payload = await enc({ t: 'j', e: { id: e.id, ts: e.ts, type: e.type, text: e.text, place: e.place, tags: e.tags, w: e.w, h: e.h }, n: e.by || G.name, d: e.byId || G.id, ts: Date.now() });
    try { const small = await J.shrink(e.blob, 1280); await fetch(BASE + topic + '?filename=p.bin&message=' + encodeURIComponent(payload), { method: 'POST', body: await encBytes(await small.arrayBuffer()) }); } catch {}
  }

  function handle(p, mid, att) {
    if (!p || !p.d) return;
    const mine = p.d === G.id, mem = G.members[p.d] ||= {};
    mem.n = p.n; mem.seen = Math.max(mem.seen || 0, p.ts);
    if (p.t === 'av') { if (okAv(p.av)) mem.av = p.av; else delete mem.av; }
    if (p.t === 'hi' && !mine && G.av && Date.now() - p.ts < 5 * 60e3) setTimeout(() => send({ t: 'av', av: G.av }), 1000 + Math.random() * 3000);   // חברה חדשה: שולחות לה את התמונה שלנו
    if (p.t === 'chat' || p.t === 'hi') {
      if (G.msgs.some(x => x.id === mid)) return;
      const pend = p.c && G.msgs.find(x => x.id === 'c' + p.c);
      if (pend) { pend.id = mid; delete pend.pending; save(); render(); return; }
      G.msgs.push({ id: mid, d: p.d, n: p.n, x: p.t === 'hi' ? null : String(p.x || '').slice(0, 1200), ts: p.ts, lat: p.lat, lng: p.lng });
      G.msgs.sort((a, b) => a.ts - b.ts); if (G.msgs.length > 250) G.msgs.splice(0, G.msgs.length - 250);
      if (!mine && Date.now() - p.ts < 5 * 60e3) { if (p.t === 'chat') beep(); if ($('#v-chat').hidden) { unread++; if (p.t === 'chat') A.toast(`${p.n}: ${String(p.x).slice(0, 60)}`, 4000); } }
      else if (!mine && $('#v-chat').hidden) unread++;
    }
    if (p.lat && p.lng) { mem.lat = p.lat; mem.lng = p.lng; mem.lt = p.ts; }
    if (p.t === 'fav' && p.pid) { const f = G.favs[p.pid] ||= {}; p.on ? f[p.d] = p.n : delete f[p.d]; if (!Object.keys(f).length) delete G.favs[p.pid]; }
    if (p.t === 'bye') delete G.members[p.d];
    if (p.t === 'j') { if (att && p.e) served[p.e.id] = Date.now(); journalIn(p, att); }
    if (p.t === 'jreq') journalReq(p);
    if (p.t === 'jdel' && p.d !== G.id) A.journal?.get(p.id).then(e => { if (e && e.byId === p.d) A.journal.del(p.id).then(() => A.journal.render()); }).catch(() => {});
    save(); render(); drawFriends();
  }

  // ───── מיקום חי ─────
  let lastLoc = null;
  setInterval(() => {
    const me = A.me; if (!key || !G.share || !me || document.hidden) return;
    const moved = lastLoc ? A.km(lastLoc, me) : 9, age = lastLoc ? Date.now() - lastLoc.t : 9e9;
    if ((moved > .06 && age > 90e3) || age > 6 * 60e3) { lastLoc = { ...me, t: Date.now() }; send({ t: 'loc', lat: +me.lat.toFixed(5), lng: +me.lng.toFixed(5) }); }
  }, 15000);

  // תמונת פרופיל: קטנה מאוד (72 פיקסלים), כדי שתיכנס בהודעה אחת מוצפנת
  const okAv = s => typeof s === 'string' && s.length < 4000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s);
  const face = (id, m, cls = 'friend') => { const av = id === G.id ? G.av : m && m.av;
    return `<span class="${cls}" style="--c:${color(id)}">${okAv(av) ? `<img src="${av}" alt="">` : esc(((id === G.id ? G.name : m && m.n) || '?').slice(0, 2))}</span>`; };
  async function makeAvatar(file) {
    let src; try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight, s = Math.min(w, h), c = document.createElement('canvas'); c.width = c.height = 72;
    c.getContext('2d').drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 72, 72);
    for (const q of [.72, .6, .5, .4, .3]) { const d = c.toDataURL('image/jpeg', q); if (d.length <= 2700) return d; }
    return c.toDataURL('image/jpeg', .2);
  }
  const COLORS = ['#e03177', '#0d5eaf', '#0ca678', '#f08c00', '#7048e8', '#1098ad', '#e8590c', '#c2255c'];
  const color = id => COLORS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  const ago = ts => { const m = Math.round((Date.now() - ts) / 6e4); return m < 1 ? 'עכשיו' : m < 60 ? `לפני ${m} דק׳` : m < 1440 ? `לפני ${Math.round(m / 60)} שע׳` : `לפני ${Math.round(m / 1440)} ימים`; };
  let friendLayer = null;
  function drawFriends() {
    const map = A.map; if (!map || !window.L) return;
    if (!friendLayer) friendLayer = L.layerGroup().addTo(map);
    friendLayer.clearLayers(); if (!key) return;
    Object.entries(G.members).forEach(([id, m]) => {
      if (id === G.id || !m.lat || Date.now() - m.lt > 3 * 36e5) return;
      const icon = L.divIcon({ className: '', html: face(id, m, 'friend pinf'), iconSize: [44, 44], iconAnchor: [22, 22] });
      L.marker([m.lat, m.lng], { icon, zIndexOffset: 900 }).addTo(friendLayer).bindPopup(`<b>${esc(m.n)}</b><br>${ago(m.lt)}`);
    });
  }
  A.hooks.map = drawFriends;
  A.hooks.fav = (pid, on) => { if (key) send({ t: 'fav', pid, on }); };
  A.hooks.favNames = pid => { const f = G.favs[pid]; return f ? Object.entries(f).filter(e => e[0] !== G.id).map(e => e[1]).join(', ') : ''; };

  // ───── ממשק ─────
  function status() { $('#grpStatus').textContent = !G.code ? 'צ׳אט, מיקום חי ומקומות משותפים, רק לבנות שיש להן את הקוד.' : online ? 'מחוברת · ההודעות מוצפנות' : 'מתחברת…'; }
  function render() {
    const joined = !!G.code;
    $('#grpJoin').hidden = joined; $('#grpMain').hidden = !joined; status();
    const badge = $('#grpBadge'); if (!$('#v-chat').hidden) unread = 0;
    const tb = $('#chatBadge'); tb.hidden = !unread; tb.textContent = unread;
    $('#chatEmpty').hidden = joined; $('#chatBody').hidden = !joined; $('#chatStatus').textContent = !joined ? '' : `${Object.keys({ [G.id]: 1, ...G.members }).length} בנות · ${online ? 'מחוברת' : 'מתחברת…'}`;
    badge.hidden = !unread; badge.textContent = unread;
    const ids = joined ? [G.id, ...Object.keys(G.members).filter(i => i !== G.id)] : [];
    $('#grpHint').textContent = joined ? `${ids.length} בקבוצה` : 'צ׳אט ומיקום חי';
    $('#grpFaces').innerHTML = ids.slice(0, 6).map(i => face(i, G.members[i])).join('') + (ids.length > 6 ? `<span class="friend more">+${ids.length - 6}</span>` : '');
    $('#myFace').innerHTML = joined ? face(G.id) : ''; $('#avClear').hidden = !G.av;
    if (!joined) return;
    $('#grpCode').textContent = G.code; $('#grpShare').checked = !!G.share;
    const me = A.me;
    $('#grpMembers').innerHTML = Object.entries({ [G.id]: { n: G.name, seen: Date.now() }, ...G.members }).filter((e, i, a) => a.findIndex(x => x[0] === e[0]) === i).map(([id, m]) => {
      const mine = id === G.id, fresh = m.lat && Date.now() - m.lt < 3 * 36e5;
      return `<div class="mem">${face(id, m)}<span><b>${esc(m.n || '')}${mine ? ' (אני)' : ''}</b>
        <small>${mine ? (G.share ? 'משתפת מיקום' : 'לא משתפת מיקום') : fresh ? `${ago(m.lt)}${me ? ' · ' + A.distTxt(A.km(me, m)) + ' ממך' : ''}` : m.seen ? 'נראתה ' + ago(m.seen) : ''}</small></span>
        ${!mine && fresh ? `<button class="btn ghost sm" data-see="${id}">במפה</button>` : ''}</div>`;
    }).join('');
    const box = $('#grpChat'), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.innerHTML = G.msgs.length ? G.msgs.map(m => m.x === null ? `<p class="sys">${esc(m.n)} הצטרפה לקבוצה</p>` :
      `<div class="mrow ${m.d === G.id ? 'mine' : ''}">${m.d === G.id ? '' : face(m.d, G.members[m.d], 'friend sm')}<div class="msg ${m.d === G.id ? 'mine' : ''} ${m.pending ? 'pending' : ''}" style="--c:${color(m.d)}">${m.d === G.id ? '' : `<b>${esc(m.n)}</b>`}<span>${esc(m.x)}</span>
        ${m.lat ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}">📍 ניווט לשם</a>` : ''}<small>${new Date(m.ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</small></div></div>`).join('')
      : '<p class="sys">עוד אין הודעות. כתבי משהו לבנות.</p>';
    if (atEnd) box.scrollTop = box.scrollHeight;
    const favs = Object.entries(G.favs).filter(e => A.byId[e[0]]);
    $('#grpFavs').innerHTML = favs.length ? favs.map(([pid, f]) => `<button class="tag" data-open="${pid}">${esc(A.byId[pid].he)} · ♥ ${esc(Object.values(f).join(', '))}</button>`).join('') : '<p class="muted small">כשמישהי מסמנת ♥ על מקום, הוא מופיע כאן אצל כולן.</p>';
  }

  async function join(code, name, isNew) {
    if (!window.crypto?.subtle) return A.toast('הדפדפן הזה לא תומך בהצפנה הדרושה');
    code = norm(code); if (code.length < 6) return A.toast('הקוד קצר מדי');
    if (!name) return A.toast('איך קוראים לך?');
    G = { ...blank(), id: G.id, av: G.av, name, code: code.replace(/(.{4})(?=.)/g, '$1-') }; save();
    await derive(code); connect(); render();
    setTimeout(() => send({ t: 'hi' }).then(() => G.av && send({ t: 'av', av: G.av })), 800);
    A.toast(isNew ? 'הקבוצה נוצרה. שלחי את הקוד לבנות' : 'הצטרפת לקבוצה');
  }
  $('#grpJoinForm').onsubmit = e => { e.preventDefault(); join($('#grpCodeIn').value, $('#grpName').value.trim(), false); };
  $('#grpNew').onclick = () => {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(8));
    join([...r].map(b => abc[b % abc.length]).join(''), $('#grpName').value.trim(), true);
  };
  $('#grpInvite').onclick = () => {
    const url = location.origin + location.pathname;
    const text = `הצטרפי לקבוצה שלנו באפליקציית אתונה 🇬🇷\n1. לפתוח: ${url}\n2. להוסיף למסך הבית\n3. ללחוץ "הבנות" ולהזין את הקוד: ${G.code}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => A.toast('ההזמנה הועתקה'), () => A.toast('הקוד: ' + G.code));
  };
  $('#grpShare').onchange = e => { G.share = e.target.checked; save(); lastLoc = null; if (G.share) A.startGPS(true); render(); A.toast(G.share ? 'הבנות רואות אותך על המפה' : 'שיתוף המיקום הופסק'); };
  // הודעה מופיעה מיד אצל השולחת, ומסומנת כנשלחה כשהשרת מאשר
  let lastPing = 0;
  async function say(x, loc) {
    const c = Math.random().toString(36).slice(2, 10), m = { id: 'c' + c, d: G.id, n: G.name, x, ts: Date.now(), pending: true, ...loc };
    G.msgs.push(m); render(); const box = $('#grpChat'); box.scrollTop = box.scrollHeight;
    const ok = await send({ t: 'chat', x, c, ...loc });
    if (!ok) { G.msgs = G.msgs.filter(y => y !== m); render(); return false; }
    if (PUSH_URL) fetch(PUSH_URL + '/push', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id, title: 'אתונה שלנו', body: `${G.name}: ${x.slice(0, 140)}`, site: location.origin + location.pathname }) }).catch(() => {});
    return true;
  }
  $('#grpForm').onsubmit = async e => { e.preventDefault(); const i = $('#grpText'), x = i.value.trim(); if (!x) return; i.value = ''; if (!await say(x)) i.value = x; };
  $('#grpQuick').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.here != null) { const me = A.me; if (!me) { A.startGPS(true); return A.toast('מאתרת מיקום… לחצי שוב בעוד רגע'); }
      return say('אני כאן, בואו 📍', { lat: +me.lat.toFixed(5), lng: +me.lng.toFixed(5) }); }
    say(b.textContent);
  };
  $('#grpMembers').onclick = e => { const b = e.target.closest('[data-see]'); if (!b) return; const m = G.members[b.dataset.see]; A.go('map'); setTimeout(() => { A.map?.setView([m.lat, m.lng], 16); drawFriends(); }, 150); };
  $('#grpLeave').onclick = async e => {
    const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'בטוחה? לחצי שוב ליציאה'; return; }
    await send({ t: 'bye' }); if (es) es.close(); key = null; online = false; G = { ...blank(), id: G.id, name: G.name, av: G.av }; save();
    b.dataset.sure = ''; b.textContent = 'יציאה מהקבוצה'; drawFriends(); render();
  };
  A.hooks.group = () => { render(); pushUI(); if (G.share) A.startGPS(false); };
  A.hooks.chat = () => { unread = 0; render(); const box = $('#grpChat'); box.scrollTop = box.scrollHeight; };

  // ───── התראות מובנות (Web Push דרך השרת שלנו) ─────
  const b64uToU8 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function pushUI() {
    const card = $('#pushNative'); card.hidden = !PUSH_URL; if (!PUSH_URL) return;
    let on = false; try { on = pushSupported() && Notification.permission === 'granted' && !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()); } catch {}
    $('#pushState').textContent = on ? 'פעילות' : 'כבויות'; $('#pushOn').hidden = on; $('#pushTest').hidden = !on;
    if (!pushSupported()) $('#pushTxt').textContent = 'כדי לקבל התראות באייפון צריך לפתוח את האפליקציה מהאייקון שבמסך הבית (לא מהדפדפן), ו־iOS 16.4 ומעלה.';
    else if (Notification.permission === 'denied') $('#pushTxt').textContent = 'ההתראות חסומות. לאשר בהגדרות הטלפון ← התראות ← אתונה, ואז לחזור לכאן.';
  }
  async function pushEnable() {
    if (!pushSupported()) return A.toast('צריך לפתוח את האפליקציה מהאייקון שבמסך הבית');
    try {
      if (await Notification.requestPermission() !== 'granted') { pushUI(); return A.toast('לא אושרו התראות'); }
      const reg = await navigator.serviceWorker.ready, key = (await (await fetch(PUSH_URL + '/key')).json()).key;
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(key) });
      const r = await fetch(PUSH_URL + '/sub', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id, sub: sub.toJSON() }) });
      if (!r.ok) throw 0;
      G.push = true; save(); A.toast('ההתראות פעילות'); pushUI();
    } catch { A.toast('הפעלת ההתראות נכשלה. נסי שוב'); }
  }
  $('#pushOn').onclick = pushEnable;
  $('#pushTest').onclick = async () => { try { const r = await (await fetch(PUSH_URL + '/push', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id, self: true, title: 'אתונה שלנו', body: 'התראת ניסיון 🎉', site: location.origin + location.pathname }) })).json(); A.toast(r.sent ? 'נשלחה. היא אמורה לקפוץ תוך שניות' : 'השליחה נכשלה'); } catch { A.toast('השליחה נכשלה'); } };
  // מחדשים את הרישום בשקט בכל פתיחה, למקרה שהמנוי התחלף
  async function pushRefresh() { if (!PUSH_URL || !G.push || !key || !pushSupported() || Notification.permission !== 'granted') return;
    try { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (sub) fetch(PUSH_URL + '/sub', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id, sub: sub.toJSON() }) }).catch(() => {}); } catch {} }

  $('#avIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { G.av = await makeAvatar(f); save(); render(); drawFriends(); A.toast((await send({ t: 'av', av: G.av })) ? 'התמונה נשלחה לבנות' : 'התמונה נשמרה, ותישלח כשיהיה חיבור'); } catch { A.toast('לא הצלחנו לקרוא את התמונה'); } };
  $('#avClear').onclick = () => { delete G.av; save(); render(); drawFriends(); send({ t: 'av', av: '' }); };

  // ───── התחלה ─────
  $('#grpName').value = G.name || '';
  const j = location.hash.match(/^#join-([A-Za-z0-9-]+)/); if (j && !G.code) { $('#grpCodeIn').value = j[1]; A.go('group'); }
  render();
  if (G.code) derive(G.code).then(() => { connect(); if (G.share) A.startGPS(false); pushRefresh(); render(); });
  pushUI();
  setInterval(() => { if ((!$('#v-group').hidden || !$('#v-chat').hidden) && G.code) render(); }, 60000);
})();
