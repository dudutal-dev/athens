/* אתונה שלנו – לוגיקה */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ATHENS = [37.9755, 23.7348];
  const KEY = 'athina.v1';

  // ───── state ─────
  const def = { hotel: null, flights: [], favs: [], pack: null, people: [], exps: [], rate: 3.9, start: '2026-11-18', days: 4 };
  let S = { ...def };
  try { S = { ...def, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
  // המלון של הטיול – מוגדר מראש, אפשר לשנות מעמוד הבית
  if (!S.hotel) S.hotel = { name: 'NYX Esperia Palace Hotel Athens', addr: 'Stadiou 22, בין סינטגמה לפנפיסטימיו', el: 'Σταδίου 22, Αθήνα 105 64', lat: 37.9790, lng: 23.7320, q: 'NYX Esperia Palace Hotel Athens, Stadiou 22' };
  if (!S.pack) S.pack = PACK_DEFAULT.map(t => ({ t, done: false }));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

  let me = null;                  // {lat,lng,acc}
  let ui = { cat: 'all', sort: 'rec', q: '', mapCat: 'all', day: 0 };
  const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));

  // ───── תמונות מוויקיפדיה (נטענות פעם אחת ונשמרות) ─────
  let IMG = {}; try { IMG = JSON.parse(localStorage.getItem('athina.img') || '{}'); } catch {}
  const pic = (id, cls = 'bg') => IMG[id] ? `<img class="${cls}" src="${esc(IMG[id])}" alt="" loading="lazy" crossorigin="anonymous" onerror="this.remove()">` : '';
  async function loadImages() {
    if (Object.keys(IMG).length >= Object.keys(WIKI).length * .6) return;
    try {
      const titles = [...new Set(Object.values(WIKI))], found = {};
      for (let i = 0; i < titles.length; i += 45) {
        const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=500&pilimit=50&titles=' + encodeURIComponent(titles.slice(i, i + 45).join('|'));
        const q = (await (await fetch(u)).json()).query || {}, alias = {};
        [...(q.normalized || []), ...(q.redirects || [])].forEach(r => alias[r.to] = alias[r.from] || r.from);
        Object.values(q.pages || {}).forEach(p => { if (p.thumbnail) { found[p.title] = p.thumbnail.source; let t = p.title; while (alias[t]) { t = alias[t]; found[t] = p.thumbnail.source; } } });
      }
      Object.entries(WIKI).forEach(([id, t]) => { if (found[t]) IMG[id] = found[t]; });
      localStorage.setItem('athina.img', JSON.stringify(IMG));
      renderRail(); renderHotel(); if (!$('#v-places').hidden) renderPlaces();
    } catch {}
  }

  // ───── helpers ─────
  const toast = (msg, ms = 2600) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); };
  const km = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const distTxt = d => d < 1 ? `${Math.round(d * 100) * 10} מ׳` : `${d.toFixed(1)} ק״מ`;
  const walkTxt = d => d <= 2.5 ? ` · ${Math.max(1, Math.round(d * 13))} דק׳ הליכה` : '';
  const origin = () => ui.sort === 'hotel' ? S.hotel : (me || S.hotel);
  const gDir = p => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.q || `${p.lat},${p.lng}`)}`;
  const gPlace = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.q || `${p.lat},${p.lng}`)}`;
  const dayDate = i => { const d = new Date(S.start + 'T12:00:00'); d.setDate(d.getDate() + i); return d; };
  const fmtDay = d => d.toLocaleDateString('he-IL', { weekday: 'short' });
  const fmtDate = d => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  const todayIdx = () => { const t = new Date(); t.setHours(12, 0, 0, 0); return Math.round((t - dayDate(0)) / 864e5); };

  // ───── navigation ─────
  function go(view) {
    $$('.view').forEach(v => v.hidden = v.dataset.view !== view);
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === view));
    if (view === 'map') initMap();
    if (view === 'places') renderPlaces();
    if (view === 'journal') { startGPS(false); APP.hooks.journal?.(); }
    if (view === 'map') APP.hooks.map?.();
    if (view === 'group') APP.hooks.group?.();
    if (view === 'chat') APP.hooks.chat?.();
    try { history.replaceState(null, '', '#' + view); } catch {}
  }
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
    const o = e.target.closest('[data-open]'); if (o) return openPlace(o.dataset.open);
    const a = e.target.closest('[data-act]'); if (a) return acts[a.dataset.act]?.(a);
  });

  const acts = {
    near() { ui.sort = 'me'; ui.cat = 'all'; go('places'); if (!me) startGPS(true); },
    favs() { ui.cat = 'fav'; go('places'); },
    share() {
      if (!me) { startGPS(true); return toast('מאתרת מיקום… לחצי שוב בעוד רגע'); }
      const txt = `אני כאן 📍 https://maps.google.com/?q=${me.lat.toFixed(6)},${me.lng.toFixed(6)}`;
      if (navigator.share) navigator.share({ text: txt }).catch(() => {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
    },
    fav(el) {
      const id = el.dataset.id; const i = S.favs.indexOf(id);
      i < 0 ? S.favs.push(id) : S.favs.splice(i, 1); save(); APP.hooks.fav?.(id, i < 0);
      $$(`[data-act="fav"][data-id="${id}"]`).forEach(b => { b.classList.toggle('on', i < 0); if (b.classList.contains('btn')) b.textContent = i < 0 ? '♥ ברשימה שלי' : '♡ לרשימה שלי'; else b.textContent = i < 0 ? '♥' : '♡'; });
      renderFavCount(); if (ui.cat === 'fav') renderPlaces();
    },
    showOnMap(el) { $('#sheet').close(); go('map'); focusPlace(el.dataset.id); },
    closeSheet() { $('#sheet').close(); },
  };

  // ───── home ─────
  function renderHero() {
    const a = dayDate(0), b = dayDate(S.days - 1), i = todayIdx();
    $('#heroDates').textContent = `${fmtDate(a)} – ${fmtDate(b)} · חוגגות 50 לדפנה`;
    $('#heroCount').textContent = i < 0 ? (i === -1 ? 'מחר ממריאות!' : `עוד ${-i} ימים להמראה`) : i < S.days ? `יום ${i + 1} מתוך ${S.days} – תיהני!` : 'איזה טיול זה היה';
    const d = Math.min(Math.max(i, 0), S.days - 1);
    ui.day = d; $('#todayPlan').textContent = PLAN[d].title;
    $('#cols').innerHTML = Array.from({ length: 8 }, (_, k) => `<rect x="${54 + k * 28.5}" y="68" width="13" height="38"/>`).join('');
  }
  const WX = c => c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 ? '🌧️' : c <= 77 ? '🌨️' : c <= 82 ? '🌦️' : '⛈️';
  async function renderWeather() {
    const box = $('#weather');
    try {
      const end = dayDate(S.days - 1).toISOString().slice(0, 10);
      let r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=37.98&longitude=23.73&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FAthens&start_date=${S.start}&end_date=${end}`);
      if (!r.ok) r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=37.98&longitude=23.73&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FAthens&forecast_days=4');
      const d = (await r.json()).daily;
      box.innerHTML = d.time.slice(0, 4).map((t, i) => `<div class="wx"><b>${fmtDay(new Date(t + 'T12:00'))} ${fmtDate(new Date(t + 'T12:00'))}</b><i>${WX(d.weather_code[i])}</i><span>${Math.round(d.temperature_2m_max[i])}°</span> <em>${Math.round(d.temperature_2m_min[i])}°</em></div>`).join('');
    } catch { box.innerHTML = ''; }
  }
  function renderAlert() {
    const has17 = Array.from({ length: S.days }, (_, i) => dayDate(i)).some(d => d.getMonth() === 10 && d.getDate() === 17);
    $('#alertBox').innerHTML = has17 && todayIdx() <= 0 ? `<div class="alert"><b>שימי לב: 17 בנובמבר</b>יום הזיכרון למרד הפוליטכניון. אחר הצהריים יש צעדה גדולה במרכז, תחנות מטרו (סינטגמה, פנפיסטימיו, אומוניה) עשויות להיסגר ורחובות נחסמים. ביום הזה להישאר באזור פלאקה ומונסטירקי, להתרחק מאקסרכיה ומהשגרירות האמריקאית, ולהגיע מהשדה במונית אם המטרו משובש.</div>` : '';
  }

  function renderHotel(results) {
    const c = $('#hotelCard'), h = S.hotel;
    if (h && !results) {
      const d = me ? km(me, h) : null;
      c.innerHTML = `<div class="card-head"><h2>המלון שלנו</h2><button class="link" id="hotelEdit">שינוי</button></div>
        ${IMG.hotel && /Esperia/.test(h.name) ? `<figure class="card-img">${pic('hotel', '')}<figcaption>רחוב סטדיו, הרחוב של המלון</figcaption></figure>` : ''}
        <p class="hotel-name">${esc(h.name)}</p>
        <p class="muted small">${esc(h.addr || '')}${d != null ? ` · <b>${distTxt(d)} ממך</b>` : ''}</p>
        ${h.el ? `<div class="taxi"><small>להראות לנהג המונית</small>${esc(h.el)}</div>` : ''}
        <div class="row" style="margin-top:12px">
          <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.q || `${h.lat},${h.lng}`)}">ניווט למלון</a>
          <button class="btn ghost" id="hotelMap">הצגה במפה</button>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.q || h.name + ' Athens')}">תמונות המלון</a>
        </div>`;
      $('#hotelEdit').onclick = () => renderHotel([]);
      $('#hotelMap').onclick = () => { go('map'); map.setView([h.lat, h.lng], 16); };
      return;
    }
    c.innerHTML = `<div class="card-head"><h2>המלון שלנו</h2>${h ? '<button class="link" id="hotelBack">ביטול</button>' : ''}</div>
      <p class="muted small" style="margin-bottom:10px">כתבי את שם המלון. נמצא אותו, נסמן במפה ונחשב מרחקים ממנו.</p>
      <form id="hotelForm" class="row"><input id="hotelQ" placeholder="למשל Electra Palace" autocomplete="off" enterkeyhint="search"><button class="btn sm">חיפוש</button></form>
      <div class="results" id="hotelRes">${(results || []).map((r, i) => `<button data-i="${i}"><b>${esc(r.name)}</b><small>${esc(r.addr)}</small></button>`).join('')}</div>
      <button class="link" id="hotelHere" style="margin-top:10px">אני במלון עכשיו – לשמור את המיקום הנוכחי</button>`;
    if (h) $('#hotelBack').onclick = () => renderHotel();
    $('#hotelForm').onsubmit = async e => {
      e.preventDefault(); const q = $('#hotelQ').value.trim(); if (!q) return;
      $('#hotelRes').innerHTML = '<p class="muted small">מחפשת…</p>';
      const found = await geocode(q);
      renderHotel(found); $('#hotelQ').value = q;
      if (!found.length) $('#hotelRes').innerHTML = '<p class="muted small">לא נמצא. נסי את השם באנגלית, להוסיף כתובת, או לשמור מיקום נוכחי כשתגיעי.</p>';
      $$('#hotelRes button').forEach(b => b.onclick = () => pickHotel(found[+b.dataset.i]));
    };
    $('#hotelHere').onclick = () => {
      const set = () => { S.hotel = { name: $('#hotelQ').value.trim() || 'המלון שלנו', addr: 'נשמר לפי המיקום שלך', lat: me.lat, lng: me.lng }; save(); afterHotel(); };
      if (me) set(); else { toast('מאתרת מיקום…'); startGPS(false, set); }
    };
  }
  async function geocode(q) {
    const out = [];
    try {
      const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=en&viewbox=23.3,38.35,24.2,37.55&bounded=1&q=${encodeURIComponent(q)}`;
      const j = await (await fetch(u)).json();
      j.forEach(r => out.push({ name: r.name || q, addr: r.display_name.split(',').slice(1, 4).join(',').trim(), lat: +r.lat, lng: +r.lon, osm: r.osm_type?.[0]?.toUpperCase() + r.osm_id }));
    } catch {}
    if (!out.length) try {
      const j = await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q + ' Athens')}&limit=6&lat=37.9755&lon=23.7348&lang=en`)).json();
      j.features.filter(f => f.properties.country === 'Greece').forEach(f => { const p = f.properties;
        out.push({ name: p.name || q, addr: [p.street, p.housenumber, p.district, p.city].filter(Boolean).join(' '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], osm: (p.osm_type || '') + p.osm_id }); });
    } catch {}
    return out;
  }
  async function pickHotel(r) {
    S.hotel = { name: r.name, addr: r.addr, lat: r.lat, lng: r.lng }; save(); afterHotel();
    try { // כתובת ביוונית לנהג מונית
      const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=el&zoom=18&lat=${r.lat}&lon=${r.lng}`)).json();
      const a = j.address || {}; const el = [a.road, a.house_number].filter(Boolean).join(' ') + (a.suburb || a.neighbourhood ? ', ' + (a.suburb || a.neighbourhood) : '');
      if (el.trim()) { S.hotel.el = el; save(); renderHotel(); }
    } catch {}
  }
  function afterHotel() { renderHotel(); drawHotel(); toast('המלון נשמר ומסומן במפה'); }

  // ───── flights ─────
  function renderFlights() {
    const c = $('#flightsCard');
    const fl = [...S.flights].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    c.innerHTML = `<div class="card-head"><h2>הטיסות</h2><button class="link" id="addFlight">+ הוספת טיסה</button></div>` +
      (fl.length ? fl.map(f => {
        const dt = new Date(`${f.date}T${f.time}`), diff = dt - Date.now();
        const cnt = diff > 0 ? (diff < 36e5 * 48 ? `בעוד ${Math.floor(diff / 36e5)} שע׳ ו־${Math.floor(diff % 36e5 / 6e4)} דק׳` : `בעוד ${Math.round(diff / 864e5)} ימים`) : 'המריאה';
        const at = new Date(dt - 3 * 36e5).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        return `<div class="flight"><div><div class="route">${f.dir === 'out' ? 'תל אביב ← אתונה' : 'אתונה ← תל אביב'}</div>
          <div class="muted small">${esc(f.air || '')} <b dir="ltr">${esc(f.num)}</b>${f.ref ? ` · הזמנה <b dir="ltr">${esc(f.ref)}</b>` : ''}</div>
          ${f.note ? `<div class="muted small">${esc(f.note)}</div>` : ''}</div>
          <div style="text-align:end"><div class="when"><b>${f.time}</b>${f.arr ? ` – ${f.arr}` : ''}</div><div class="muted small">${fmtDay(dt)} ${fmtDate(dt)}</div><div class="count">${cnt}</div></div>
          <div class="acts"><a target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(f.num + ' flight status')}">סטטוס טיסה</a>
          <span class="muted">להיות בשדה עד ${at}</span><button class="del" data-del="${f.id}" style="margin-inline-start:auto">מחיקה</button></div></div>`;
      }).join('') : `<p class="empty">הוסיפי את טיסות ההלוך והחזור, ותקבלי ספירה לאחור, שעת הגעה לשדה וקישור לסטטוס הטיסה.</p>`);
    $('#addFlight').onclick = () => {
      $('#flightForm').reset();
      const hasOut = S.flights.some(f => f.dir === 'out');
      $('#fDir').value = hasOut ? 'back' : 'out';
      $('#fDate').value = hasOut ? dayDate(S.days - 1).toISOString().slice(0, 10) : S.start;
      $('#flightDlg').showModal();
    };
    $$('[data-del]', c).forEach(b => b.onclick = () => { S.flights = S.flights.filter(f => f.id !== b.dataset.del); save(); renderFlights(); });
  }
  $('#fCancel').onclick = () => $('#flightDlg').close();
  $('#flightForm').onsubmit = () => {
    const v = id => $(id).value.trim();
    S.flights.push({ id: Date.now().toString(36), dir: v('#fDir'), num: v('#fNum').toUpperCase().replace(/\s+/g, ''), air: v('#fAir'), date: v('#fDate'), time: v('#fTime'), arr: v('#fArr'), ref: v('#fRef').toUpperCase(), note: v('#fNote') });
    if (v('#fDir') === 'out' && v('#fDate') && !S.flights.some(f => f.dir === 'out' && f.date < v('#fDate'))) { S.start = v('#fDate'); }
    save(); renderFlights(); renderHero(); renderDayTabs(); renderPlan(); renderAlert(); renderWeather(); toast('הטיסה נשמרה');
  };

  function renderFavCount() { $('#favCount').textContent = S.favs.length ? `${S.favs.length} מקומות שמורים` : 'סמני ♥ על מקומות'; }
  function renderRail() {
    $('#topRail').innerHTML = PLACES.filter(p => p.top).sort((a, b) => (a.cat === 'shop' ? 0 : 1) - (b.cat === 'shop' ? 0 : 1)).map(p =>
      `<button class="tile" style="--c:${CATS[p.cat].color}" data-open="${p.id}">${pic(p.id)}<i>${CATS[p.cat].emoji}</i><span><b>${esc(p.he)}</b><small>${esc(p.area)}</small></span></button>`).join('');
  }

  // ───── places ─────
  function chipsHTML(sel, withFav) {
    return `<button class="chip ${sel === 'all' ? 'on' : ''}" data-cat="all">הכול</button>` +
      (withFav ? `<button class="chip ${sel === 'fav' ? 'on' : ''}" data-cat="fav">♥ שלי</button>` : '') +
      Object.entries(CATS).map(([k, c]) => `<button class="chip ${sel === k ? 'on' : ''}" data-cat="${k}">${c.emoji} ${c.he}</button>`).join('');
  }
  function renderPlaces() {
    $('#placeChips').innerHTML = chipsHTML(ui.cat, true);
    $$('#sortbar button').forEach(b => b.classList.toggle('on', b.dataset.sort === ui.sort));
    const o = origin(), q = ui.q.toLowerCase();
    let list = PLACES.filter(p => (ui.cat === 'all' || (ui.cat === 'fav' ? S.favs.includes(p.id) : p.cat === ui.cat)) &&
      (!q || (p.he + p.desc + p.area + p.q + p.tip + CATS[p.cat].he).toLowerCase().includes(q)));
    if (ui.sort !== 'rec' && o) list.sort((a, b) => km(o, a) - km(o, b));
    else list.sort((a, b) => (b.top || 0) - (a.top || 0));
    let note = '';
    if (ui.sort === 'me' && !me) note = '<p class="muted small">מאתרת את המיקום שלך… יש לאשר גישה למיקום.</p>';
    if (ui.sort === 'hotel' && !S.hotel) note = '<p class="muted small">עוד לא הוגדר מלון. אפשר להוסיף אותו בעמוד הבית.</p>';
    $('#placeList').innerHTML = note + (list.length ? list.map(p => {
      const d = o ? km(o, p) : null, fav = S.favs.includes(p.id), gf = window.APP?.hooks.favNames?.(p.id);
      return `<div class="place" style="--c:${CATS[p.cat].color}"><button class="badge" data-open="${p.id}" aria-hidden="true" tabindex="-1">${pic(p.id, 'th') || CATS[p.cat].emoji}</button>
        <button data-open="${p.id}" style="text-align:start"><h3>${esc(p.he)}</h3><p>${esc(p.desc)}</p>
        <div class="meta">${p.top ? '<span class="star">★ מומלץ</span>' : ''}<span>${esc(p.area)}</span>${p.price ? `<span>${p.price}</span>` : ''}${d != null ? `<span class="dist">${distTxt(d)}${walkTxt(d)}</span>` : ''}${gf ? `<span class="gfav">♥ ${esc(gf)}</span>` : ''}</div></button>
        <button class="heart ${fav ? 'on' : ''}" data-act="fav" data-id="${p.id}" aria-label="שמירה">${fav ? '♥' : '♡'}</button></div>`;
    }).join('') : `<p class="empty">${ui.cat === 'fav' ? 'עוד אין מקומות שמורים. לחצי על ♡ ליד מקום כדי לשמור אותו.' : 'לא נמצאו מקומות.'}</p>`);
  }
  $('#placeChips').onclick = e => { const c = e.target.closest('.chip'); if (c) { ui.cat = c.dataset.cat; renderPlaces(); } };
  $('#sortbar').onclick = e => { const b = e.target.closest('button'); if (!b) return; ui.sort = b.dataset.sort; if (ui.sort === 'me' && !me) startGPS(false); renderPlaces(); };
  $('#search').oninput = e => { ui.q = e.target.value; renderPlaces(); };

  function openPlace(id) {
    const p = byId[id]; if (!p) return; const c = CATS[p.cat], fav = S.favs.includes(id);
    const dm = me ? km(me, p) : null, dh = S.hotel ? km(S.hotel, p) : null;
    $('#sheetBody').innerHTML = `<div class="sh-top ${IMG[id] ? 'has-img' : ''}" style="--c:${c.color}">${pic(id)}${IMG[id] ? `<span class="credit">${ILL.includes(id) ? 'אילוסטרציה · ' : ''}ויקיפדיה</span>` : ''}<button class="sh-close" data-act="closeSheet" aria-label="סגירה">×</button>
      <small>${c.emoji} ${c.he} · ${esc(p.area)}${p.price ? ' · ' + p.price : ''}</small><h2>${esc(p.he)}</h2></div>
      <div class="sh-body"><p>${esc(p.desc)}</p>
      ${p.tip ? `<div class="sh-tip"><b>טיפ:</b> ${esc(p.tip)}</div>` : ''}
      ${dm != null || dh != null ? `<div class="meta">${dm != null ? `<span class="dist">ממך: ${distTxt(dm)}${walkTxt(dm)}</span>` : ''}${dh != null ? `<span>מהמלון: ${distTxt(dh)}${walkTxt(dh)}</span>` : ''}</div>` : ''}
      <div class="sh-acts">
        <a class="btn wide" target="_blank" rel="noopener" href="${gDir(p)}">ניווט בגוגל מפות</a>
        <a class="btn ghost" target="_blank" rel="noopener" href="${gPlace(p)}">תמונות וביקורות</a>
        <button class="btn ghost" data-act="showOnMap" data-id="${id}">הצגה במפה</button>
        <button class="btn ghost wide ${fav ? 'on' : ''}" data-act="fav" data-id="${id}">${fav ? '♥ ברשימה שלי' : '♡ לרשימה שלי'}</button>
      </div></div>`;
    const s = $('#sheet'); if (!s.open) s.showModal(); s.scrollTop = 0;
  }
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ───── plan ─────
  function renderDayTabs() {
    $('#dayTabs').innerHTML = PLAN.map((_, i) => `<button class="${i === ui.day ? 'on' : ''}" data-day="${i}"><b>${i + 1}</b><small>${fmtDay(dayDate(i))} ${fmtDate(dayDate(i))}</small></button>`).join('');
  }
  function renderPlan() {
    const d = PLAN[ui.day];
    $('#planBody').innerHTML = `<h2 class="day-title">${d.title}</h2><p class="day-sub">${d.sub}</p><div class="tl">` +
      d.items.map(it => `<div class="tl-item"><div class="tl-time">${it.t}</div><h3>${it.h}</h3>${it.d ? `<p>${it.d}</p>` : ''}
        ${it.p ? `<div class="tags">${it.p.map(id => `<button class="tag" data-open="${id}">${CATS[byId[id].cat].emoji} ${esc(byId[id].he)}</button>`).join('')}</div>` : ''}</div>`).join('') + '</div>';
  }
  $('#dayTabs').onclick = e => { const b = e.target.closest('button'); if (b) { ui.day = +b.dataset.day; renderDayTabs(); renderPlan(); } };

  // ───── map ─────
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const LAYERS = {
    streets: { he: 'רחובות', sub: 'מומלצת. ברורה לקריאה, וזו המפה שנשמרת לאוף־ליין', url: ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', max: 18, attr: 'Tiles © Esri' },
    osm: { he: 'מפורטת', sub: 'הכי הרבה פרטים: חנויות, מעברים, תחנות. שמות ביוונית', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '© OpenStreetMap' },
    sat: { he: 'לוויין', sub: 'תצלום אוויר. טוב להתמצאות לפי בניינים וכיכרות', url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 18, attr: 'Tiles © Esri, Maxar' },
  };
  let tiles = null;
  function setLayer(k, quiet) {
    if (!LAYERS[k]) k = 'streets';
    if (!quiet) { S.layer = k; save(); } if (!map) return;
    if (tiles) tiles.remove();
    const c = LAYERS[k]; let bad = 0, good = 0;
    tiles = L.tileLayer(c.url, { maxZoom: 20, maxNativeZoom: c.max, crossOrigin: true, attribution: c.attr }).addTo(map);
    tiles.on('tileload', () => good++);
    tiles.on('tileerror', () => { if (++bad === 6 && !good && navigator.onLine && k !== 'osm') { toast('המפה הזו לא נטענת, עוברת למפה המפורטת'); setLayer('osm', true); } });
    if (!quiet) toast('מפה: ' + c.he);
  }
  function layerMenu() {
    $('#layerList').innerHTML = Object.entries(LAYERS).map(([k, c]) => `<button class="opt ${S.layer === k ? 'on' : ''}" data-layer="${k}"><b>${c.he}</b><small>${c.sub}</small></button>`).join('');
    $('#layerDlg').showModal();
  }
  $('#layerList').onclick = e => { const b = e.target.closest('[data-layer]'); if (b) { setLayer(b.dataset.layer); $('#layerDlg').close(); } };
  $('#btnLayers').onclick = layerMenu;
  let map, layer, meMarker, meCircle, hotelMarker, follow = false, markers = {};
  function initMap() {
    if (map) { setTimeout(() => map.invalidateSize(), 50); return; }
    if (!window.L) { $('#map').innerHTML = '<p class="empty" style="padding:80px 20px;text-align:center">המפה צריכה חיבור לאינטרנט.</p>'; return; }
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView(S.hotel ? [S.hotel.lat, S.hotel.lng] : ATHENS, 14);
    setLayer(navigator.onLine ? S.layer || 'streets' : 'streets', true);
    layer = L.layerGroup().addTo(map);
    map.on('dragstart', () => { follow = false; $('#btnLocate').classList.remove('on'); });
    $('#mapChips').innerHTML = chipsHTML(ui.mapCat, true);
    drawMarkers(); drawHotel(); drawMe(); startGPS(false);
    setTimeout(() => map.invalidateSize(), 80);
  }
  function drawMarkers() {
    if (!map) return; layer.clearLayers(); markers = {};
    PLACES.filter(p => ui.mapCat === 'all' || (ui.mapCat === 'fav' ? S.favs.includes(p.id) : p.cat === ui.mapCat)).forEach(p => {
      const icon = L.divIcon({ className: '', html: `<div class="pin" style="--c:${CATS[p.cat].color}"><i>${CATS[p.cat].emoji}</i></div>`, iconSize: [34, 34], iconAnchor: [17, 34] });
      markers[p.id] = L.marker([p.lat, p.lng], { icon, title: p.he }).addTo(layer).on('click', () => openPlace(p.id));
    });
  }
  function drawHotel() {
    if (!map) return; if (hotelMarker) hotelMarker.remove(); if (!S.hotel) return;
    const icon = L.divIcon({ className: '', html: '<div class="pin hotel"><i>🏨</i></div>', iconSize: [40, 40], iconAnchor: [20, 40] });
    hotelMarker = L.marker([S.hotel.lat, S.hotel.lng], { icon, zIndexOffset: 500 }).addTo(map).bindPopup(`<b>${esc(S.hotel.name)}</b><br>המלון שלנו`);
  }
  function drawMe() {
    if (!map || !me) return;
    if (!meMarker) {
      meMarker = L.marker([me.lat, me.lng], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 1000, interactive: false }).addTo(map);
      meCircle = L.circle([me.lat, me.lng], { radius: me.acc, color: '#1a73e8', weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
    } else { meMarker.setLatLng([me.lat, me.lng]); meCircle.setLatLng([me.lat, me.lng]).setRadius(me.acc); }
    if (follow) map.setView([me.lat, me.lng], Math.max(map.getZoom(), 16));
  }
  function focusPlace(id) { const p = byId[id]; if (!map || !p) return; if (!markers[id]) { ui.mapCat = 'all'; $('#mapChips').innerHTML = chipsHTML('all', true); drawMarkers(); } map.setView([p.lat, p.lng], 17); }
  $('#mapChips').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; ui.mapCat = c.dataset.cat; $('#mapChips').innerHTML = chipsHTML(ui.mapCat, true); drawMarkers(); };
  $('#btnLocate').onclick = () => { follow = true; $('#btnLocate').classList.add('on'); if (me) drawMe(); else gpsMsg('מאתרת מיקום…'); startGPS(true); };
  $('#btnHotel').onclick = () => { if (S.hotel) { map.setView([S.hotel.lat, S.hotel.lng], 16); hotelMarker?.openPopup(); } else { toast('עוד לא הוגדר מלון'); go('home'); } };
  function gpsMsg(t) { const s = $('#gpsStatus'); s.textContent = t; s.hidden = !t; clearTimeout(gpsMsg.t); if (t) gpsMsg.t = setTimeout(() => s.hidden = true, 5000); }

  // ───── GPS ─────
  let watchId = null, firstFix = [], askedOnce = false;
  function locDlg(mode) { // mode: ask | help
    $('#locAsk').hidden = mode !== 'ask'; $('#locHelp').hidden = mode !== 'help';
    const d = $('#locDlg'); if (!d.open) d.showModal();
  }
  $('#locOk').onclick = () => { $('#locDlg').close(); beginGPS(true); };          // לחיצה של המשתמשת – מכאן קופץ חלון האישור של הטלפון
  $('#locLater').onclick = $('#locClose').onclick = () => $('#locDlg').close();
  $('#locReload').onclick = () => location.reload();
  async function startGPS(loud, cb) {
    if (cb) { if (me) cb(); else firstFix.push(cb); }
    if (watchId != null) return;
    if (!navigator.geolocation) { if (loud) toast('המכשיר לא תומך באיתור מיקום'); return; }
    let st = 'prompt';
    try { st = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch {}
    if (st === 'granted') return beginGPS(loud);
    if (st === 'denied') { if (loud || !askedOnce) locDlg('help'); askedOnce = true; return; }
    if (loud || !askedOnce) locDlg('ask');
    askedOnce = true;
  }
  function beginGPS(loud) {
    if (watchId != null) return;
    gpsMsg('מאתרת מיקום…');
    watchId = navigator.geolocation.watchPosition(pos => {
      const first = !me;
      me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      drawMe(); gpsMsg('');
      if (first) { firstFix.splice(0).forEach(f => f()); renderHotel(); if (!$('#v-places').hidden) renderPlaces(); if (map && !$('#v-map').hidden) { follow = true; $('#btnLocate').classList.add('on'); drawMe(); } }
      else if (!$('#v-places').hidden && ui.sort === 'me' && Date.now() - (startGPS.last || 0) > 20000) { startGPS.last = Date.now(); renderPlaces(); }
    }, err => {
      navigator.geolocation.clearWatch(watchId); watchId = null; gpsMsg('');
      if (err.code === 1) locDlg('help'); else if (loud) toast('לא הצלחנו לאתר מיקום כרגע. נסי שוב במקום פתוח');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  // ───── tools ─────
  function initConv() {
    const eur = $('#eur'), ils = $('#ils'), rate = $('#rate');
    const upd = from => { const r = +rate.value || 0; if (from === 'ils') eur.value = r && ils.value ? (ils.value / r).toFixed(2) : ''; else ils.value = eur.value ? (eur.value * r).toFixed(2) : ''; };
    rate.value = S.rate; upd();
    eur.oninput = () => upd('eur'); ils.oninput = () => upd('ils');
    rate.oninput = () => { S.rate = +rate.value || S.rate; save(); $('#rateSrc').textContent = '(ידני)'; upd(); };
    fetch('https://api.frankfurter.app/latest?from=EUR&to=ILS').then(r => r.json()).then(j => {
      if (j?.rates?.ILS) { S.rate = +j.rates.ILS.toFixed(3); rate.value = S.rate; save(); $('#rateSrc').textContent = `(שער יציג, ${j.date})`; upd(); }
    }).catch(() => { $('#rateSrc').textContent = '(משוער – אפשר לעדכן)'; });
  }
  function renderPack() {
    const done = S.pack.filter(i => i.done).length;
    $('#packCount').textContent = `${done}/${S.pack.length}`;
    $('#packList').innerHTML = S.pack.map((it, i) => `<label class="${it.done ? 'done' : ''}"><input type="checkbox" id="pk${i}" data-i="${i}" ${it.done ? 'checked' : ''}><span>${esc(it.t)}</span><button type="button" class="x" data-rm="${i}" aria-label="הסרה">×</button></label>`).join('');
  }
  $('#packList').onchange = e => { const i = e.target.dataset.i; if (i != null) { S.pack[i].done = e.target.checked; save(); renderPack(); } };
  $('#packList').onclick = e => { const r = e.target.dataset.rm; if (r != null) { e.preventDefault(); S.pack.splice(+r, 1); save(); renderPack(); } };
  $('#packAdd').onsubmit = e => { e.preventDefault(); const v = $('#packNew').value.trim(); if (v) { S.pack.push({ t: v, done: false }); save(); renderPack(); $('#packNew').value = ''; } };

  function renderKupa() {
    $('#peopleTags').innerHTML = S.people.map((n, i) => `<button class="tag" data-rmp="${i}">${esc(n)}<span class="x">×</span></button>`).join('');
    $('#expPayer').innerHTML = S.people.length ? S.people.map(n => `<option>${esc(n)}</option>`).join('') : '<option value="">קודם להוסיף חברות</option>';
    $('#kupaList').innerHTML = S.exps.map((x, i) => `<div class="exp"><span>${esc(x.d)} <small>· ${esc(x.p)}</small></span><span><b>€${x.a.toFixed(2)}</b> <button data-rme="${i}" class="muted" aria-label="מחיקה">×</button></span></div>`).join('');
    const n = S.people.length, total = S.exps.reduce((s, x) => s + x.a, 0);
    if (!n || !total) { $('#kupaSum').innerHTML = ''; return; }
    const bal = Object.fromEntries(S.people.map(p => [p, -total / n]));
    S.exps.forEach(x => { if (x.p in bal) bal[x.p] += x.a; });
    const debt = Object.entries(bal).filter(e => e[1] < -0.005).map(e => [e[0], -e[1]]), cred = Object.entries(bal).filter(e => e[1] > 0.005);
    const lines = []; let i = 0, j = 0;
    while (i < debt.length && j < cred.length) { const m = Math.min(debt[i][1], cred[j][1]); lines.push(`<div><b>${esc(debt[i][0])}</b> מעבירה ל<b>${esc(cred[j][0])}</b> €${m.toFixed(2)}</div>`); debt[i][1] -= m; cred[j][1] -= m; if (debt[i][1] < .005) i++; if (cred[j][1] < .005) j++; }
    $('#kupaSum').innerHTML = `<div class="settle"><div>סה״כ €${total.toFixed(2)} · €${(total / n).toFixed(2)} לכל אחת (≈ ₪${Math.round(total / n * S.rate)})</div>${lines.join('') || '<div>הכול מאוזן</div>'}</div>`;
  }
  $('#kupaPeople').onsubmit = e => { e.preventDefault(); const v = $('#personName').value.trim(); if (v && !S.people.includes(v)) { S.people.push(v); save(); renderKupa(); } $('#personName').value = ''; };
  $('#kupaExp').onsubmit = e => { e.preventDefault(); const a = parseFloat($('#expAmt').value), p = $('#expPayer').value;
    if (!p) return toast('קודם להוסיף את שמות החברות'); if (!(a > 0)) return toast('להזין סכום');
    S.exps.push({ d: $('#expDesc').value.trim() || 'הוצאה', a, p }); save(); renderKupa(); $('#expDesc').value = ''; $('#expAmt').value = ''; };
  $('#peopleTags').onclick = e => { const b = e.target.closest('[data-rmp]'); if (b) { S.people.splice(+b.dataset.rmp, 1); save(); renderKupa(); } };
  $('#kupaList').onclick = e => { const b = e.target.closest('[data-rme]'); if (b) { S.exps.splice(+b.dataset.rme, 1); save(); renderKupa(); } };

  function renderStatic() {
    $('#tips').innerHTML = TIPS.map(g => `<div class="tipg"><h3>${g.h}</h3><ul>${g.items.map(i => `<li>${i}</li>`).join('')}</ul></div>`).join('');
    $('#phrases').innerHTML = PHRASES.map(p => `<div class="ph"><b>${p[0]}</b><span>${p[2]}</span><small>${p[1]}</small></div>`).join('');
    $('#guide').innerHTML = GUIDE.map(s => `<details class="g"><summary>${s.h}</summary>${s.p.map(x => Array.isArray(x) ? `<ol>${x.map(i => `<li>${i}</li>`).join('')}</ol>` : `<p>${x}</p>`).join('')}</details>`).join('');
    $('#emergency').innerHTML = EMERGENCY.map(e => `<a href="tel:${e[1].replace(/\s/g, '')}">${e[0]}<span>${e[1]}</span></a>`).join('');
  }

  // ───── התקנה למסך הבית ─────
  (() => {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    let hidden = false; try { hidden = localStorage.getItem('athina.installHide'); } catch {}
    if (standalone || hidden) return;
    const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), card = $('#installCard');
    $('#installTxt').innerHTML = ios
      ? (/CriOS/.test(ua) ? 'בכרום: לחיצה על כפתור השיתוף <b>בשורת הכתובת למעלה</b> ← "הוספה למסך הבית".' : 'לחיצה על כפתור השיתוף למטה ← לגלול ← <b>"הוספה למסך הבית"</b>.') + ' האפליקציה תיפתח מהאייקון במסך מלא, גם בלי קליטה.'
      : 'בתפריט הדפדפן (⋮) ← <b>"הוספה למסך הבית"</b> או "התקנת האפליקציה".';
    card.hidden = false;
    $('#installHide').onclick = () => { card.hidden = true; try { localStorage.setItem('athina.installHide', '1'); } catch {} };
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); const b = $('#installBtn'); b.hidden = false; b.onclick = async () => { e.prompt(); await e.userChoice; card.hidden = true; }; });
    addEventListener('appinstalled', () => card.hidden = true);
  })();

  // ───── עדכון אוטומטי: בודקים אם יש גרסה חדשה באתר, ואם כן טוענים אותה ─────
  const VERSION = 19;
  async function checkUpdate() {
    if (location.protocol !== 'https:' || !navigator.onLine) return;
    try {
      const v = (await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json()).v;
      if (!(v > VERSION) || sessionStorage.getItem('athina.upd') === String(v)) return;
      const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.value;
      if (document.querySelector('dialog[open]') || typing) return;        // לא קוטעים באמצע פעולה; ננסה שוב בבדיקה הבאה
      sessionStorage.setItem('athina.upd', String(v));
      toast('מתעדכנת לגרסה חדשה…');
      setTimeout(hardReload, 700);
    } catch {}
  }
  async function hardReload() {   // טוען מחדש את כל קבצי האפליקציה מהשרת
    try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
    try { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('athina-v')).map(k => caches.delete(k))); } catch {}
    location.replace(location.pathname + '?u=' + Date.now() + location.hash);
  }
  $('#verTxt').textContent = 'גרסה ' + VERSION;
  $('#updBtn').onclick = async () => {
    if (!navigator.onLine) return toast('צריך חיבור לאינטרנט');
    try { const v = (await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json()).v;
      if (v > VERSION) { toast(`מתעדכנת לגרסה ${v}…`); setTimeout(hardReload, 600); } else toast('זו הגרסה העדכנית (' + VERSION + ')'); } catch { toast('הבדיקה נכשלה, נסי שוב'); }
  };
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.go) go(e.data.go); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  setInterval(checkUpdate, 5 * 60e3); setTimeout(checkUpdate, 3000);

  // ───── boot ─────
  $$('[data-ic]').forEach(el => el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[el.dataset.ic] || ''}"/></svg>`);
  $('#taxAmt').oninput = e => { const v = +e.target.value; $('#taxOut').textContent = v >= 50 ? `\u2066€${Math.round(v * .12)}–€${Math.round(v * .15)}\u2069 · כ־₪${Math.round(v * .135 * S.rate)}` : v > 0 ? 'מתחת למינימום של €50' : '—'; };
  const APP = window.APP = { S, save, go, get me() { return me; }, km, toast, esc, dayDate, fmtDay, fmtDate, byId, startGPS, distTxt, hooks: {}, get imgs() { return Object.values(IMG); }, get map() { return map; },
    tileUrl: (z, x, y) => `${ESRI}World_Street_Map/MapServer/tile/${z}/${y}/${x}` };
  renderHero(); renderAlert(); renderHotel(); renderFlights(); renderFavCount(); renderRail();
  renderDayTabs(); renderPlan(); renderStatic(); renderPack(); renderKupa(); initConv(); renderWeather(); loadImages();
  const h = location.hash.slice(1); if (['map', 'places', 'plan', 'more', 'journal', 'group', 'chat'].includes(h)) go(h);
  setInterval(renderFlights, 60000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
