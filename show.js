/* מצגת הטיול: נבנית מהיומן (האישי והמשותף) לפי סדר הצילום, מוצגת במסך מלא, ונשמרת כ־PDF או כתמונות לשיתוף */
(() => {
  const A = window.APP, $ = s => document.querySelector(s);
  const FONT = { d: '"Frank Ruhl Libre", serif', h: '"Gveret Levin", "Assistant", cursive', b: 'Assistant, system-ui, sans-serif' };
  const BLUE1 = '#0a3d7a', BLUE2 = '#1479de', PINK = '#ff7aa8', GOLD = '#f5b942';
  const placeName = id => id === 'hotel' ? (A.S.hotel?.name || 'המלון') : A.byId[id]?.he || '';
  const hm = ts => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const longDate = d => d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  // ───── כלי ציור ─────
  const loadImg = blob => new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(blob); i.onload = () => { res(i); setTimeout(() => URL.revokeObjectURL(u), 3000); }; i.onerror = rej; i.src = u; });
  function cover(c, img, x, y, w, h) { const k = Math.max(w / img.width, h / img.height), sw = w / k, sh = h / k; c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function wrap(c, text, maxW, maxLines) {
    const out = []; for (const para of String(text).split('\n')) { let line = '';
      for (const w of para.split(/\s+/)) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
      if (line) out.push(line); }
    if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return out;
  }
  function lines(c, arr, x, y, lh) { arr.forEach((l, i) => c.fillText(l, x, y + i * lh)); return y + arr.length * lh; }
  function meander(c, x, y, w, color, s = 2) {   // פס מפתח יווני
    c.save(); c.strokeStyle = color; c.lineWidth = 1.7 * s; c.beginPath();
    for (let px = x; px < x + w - 24 * s + 1; px += 24 * s) { const p = (dx, dy) => [px + dx * s, y + dy * s];
      c.moveTo(...p(0, 10.5)); c.lineTo(...p(4, 10.5)); c.lineTo(...p(4, 2)); c.lineTo(...p(20, 2)); c.lineTo(...p(20, 10.5)); c.lineTo(...p(9, 10.5)); c.lineTo(...p(9, 6)); c.lineTo(...p(15, 6)); c.moveTo(...p(20, 10.5)); c.lineTo(...p(24, 10.5)); }
    c.stroke(); c.restore();
  }
  function temple(c, cx, by, s, color) {
    c.save(); c.fillStyle = color; c.beginPath(); c.moveTo(cx - 144 * s, by - 184 * s); c.lineTo(cx, by - 252 * s); c.lineTo(cx + 144 * s, by - 184 * s); c.lineTo(cx + 144 * s, by - 168 * s); c.lineTo(cx - 144 * s, by - 168 * s); c.fill();
    c.fillRect(cx - 132 * s, by - 158 * s, 264 * s, 13 * s);
    for (let i = 0; i < 5; i++) c.fillRect(cx - 118 * s + i * 52.5 * s, by - 136 * s, 26 * s, 92 * s);
    c.fillRect(cx - 140 * s, by - 36 * s, 280 * s, 14 * s); c.fillRect(cx - 156 * s, by - 16 * s, 312 * s, 16 * s); c.restore();
  }
  function blurBg(c, img, W, H, dark = .5) {   // רקע מטושטש בלי filter (לא נתמך בספארי): מקטינים מאוד ומגדילים חזרה
    const t = document.createElement('canvas'); t.width = 36; t.height = Math.round(36 * H / W); cover(t.getContext('2d'), img, 0, 0, t.width, t.height);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(t, 0, 0, W, H);
    c.fillStyle = `rgba(8, 20, 45, ${dark})`; c.fillRect(0, 0, W, H);
  }
  function sea(c, W, H) { const g = c.createLinearGradient(0, 0, W * .6, H); g.addColorStop(0, BLUE2); g.addColorStop(1, BLUE1); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  function sun(c, x, y, r) { const g = c.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r); g.addColorStop(0, '#ffe9a3'); g.addColorStop(1, '#f59f00'); c.save(); c.shadowColor = 'rgba(255,196,77,.5)'; c.shadowBlur = r; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.restore(); }
  function footer(c, W, H, light) { const u = W / 1080; c.font = `600 ${Math.round(26 * Math.min(u, 1.2))}px ${FONT.b}`; c.fillStyle = light ? 'rgba(255,255,255,.7)' : 'rgba(10,61,122,.6)'; c.textAlign = 'center'; c.fillText('אתונה · דפנה חוגגת 50', W / 2, H - 34 * Math.min(u, 1.2)); }
  const mk = (W, H) => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'); c.direction = 'rtl'; c.textBaseline = 'alphabetic'; return [cv, c]; };

  // ───── שקפים ─────
  function sCover(W, H, st) {
    const [cv, c] = mk(W, H), P = H > W, u = P ? W / 1080 : H / 900;
    sea(c, W, H); sun(c, P ? W * .22 : W * .14, P ? H * .16 : H * .22, 74 * u);
    temple(c, W / 2, P ? H * .47 : H * .5, (P ? 2.2 : 1.25) * u, 'rgba(255,255,255,.16)');
    c.textAlign = 'center'; c.fillStyle = '#fff';
    c.font = `900 ${Math.round((P ? 250 : 190) * u)}px ${FONT.d}`; c.fillText('אתונה', W / 2, P ? H * .62 : H * .6);
    c.font = `400 ${Math.round((P ? 92 : 70) * u)}px ${FONT.h}`; c.fillStyle = '#ffd6e4'; c.fillText('דפנה חוגגת 50', W / 2, P ? H * .69 : H * .72);
    c.font = `600 ${Math.round(38 * u)}px ${FONT.b}`; c.fillStyle = 'rgba(255,255,255,.9)';
    c.fillText(`${st.from.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })} – ${st.to.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}`, W / 2, P ? H * .745 : H * .8);
    if (st.names.length) { c.font = `500 ${Math.round(32 * u)}px ${FONT.b}`; c.fillStyle = 'rgba(255,255,255,.75)'; lines(c, wrap(c, st.names.join(' · '), W * .8, 2), W / 2, P ? H * .785 : H * .86, 42 * u); }
    meander(c, W * .1, H - (P ? 150 : 90) * u, W * .8, 'rgba(255,255,255,.55)', 2.4 * u);
    return cv;
  }
  function sDay(W, H, d) {
    const [cv, c] = mk(W, H), P = H > W, u = P ? W / 1080 : H / 900;
    c.fillStyle = '#f4f7fc'; c.fillRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, 0, H * .5); g.addColorStop(0, 'rgba(20,121,222,.14)'); g.addColorStop(1, 'rgba(20,121,222,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H * .5);
    c.textAlign = 'center';
    c.font = `700 ${Math.round(40 * u)}px ${FONT.b}`; c.fillStyle = '#d6336c'; c.fillText(longDate(d.date), W / 2, P ? H * .2 : H * .2);
    c.font = `900 ${Math.round((P ? 250 : 200) * u)}px ${FONT.d}`; c.fillStyle = BLUE1; c.fillText(d.label, W / 2, P ? H * .36 : H * .47);
    if (d.title) { c.font = `400 ${Math.round((P ? 78 : 64) * u)}px ${FONT.h}`; c.fillStyle = '#14213d'; lines(c, wrap(c, d.title, W * .8, 2), W / 2, P ? H * .44 : H * .6, 86 * u); }
    meander(c, W * .3, P ? H * .49 : H * .66, W * .4, BLUE2, 2.2 * u);
    const th = d.imgs.slice(0, 3), n = th.length;
    if (n) { const s = (P ? 280 : 190) * u, gap = 26 * u, x0 = (W - (n * s + (n - 1) * gap)) / 2, y = P ? H * .58 : H * .715;
      th.forEach((im, i) => { const x = x0 + i * (s + gap); c.save(); c.shadowColor = 'rgba(10,40,90,.25)'; c.shadowBlur = 30 * u; c.shadowOffsetY = 10 * u; c.fillStyle = '#fff'; rr(c, x - 8 * u, y - 8 * u, s + 16 * u, s + 16 * u, 22 * u); c.fill(); c.restore();
        c.save(); rr(c, x, y, s, s, 16 * u); c.clip(); cover(c, im, x, y, s, s); c.restore(); }); }
    c.font = `600 ${Math.round(34 * u)}px ${FONT.b}`; c.fillStyle = '#5c6884'; c.fillText(`${d.count} רגעים`, W / 2, P ? H * .82 : H * .965 - 40 * u);
    if (P) footer(c, W, H, false);
    return cv;
  }
  function metaText(e) { return [e.place ? '📍 ' + placeName(e.place) : '', hm(e.ts), e.by || ''].filter(Boolean).join('  ·  '); }
  function sPhoto(W, H, e, img, dayLabel) {
    const [cv, c] = mk(W, H), P = H > W, u = P ? W / 1080 : H / 900;
    blurBg(c, img, W, H, .52);
    const box = P ? { x: 64 * u, y: 150 * u, w: W - 128 * u, h: H * (e.text ? .56 : .68) } : { x: 70 * u, y: 70 * u, w: W * (e.text ? .58 : .9) - 70 * u, h: H - 190 * u };
    if (!P && !e.text) box.x = W * .05;
    const k = Math.min(box.w / img.width, box.h / img.height), w = img.width * k, h = img.height * k, x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2, b = 14 * u;
    c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 50 * u; c.shadowOffsetY = 18 * u; c.fillStyle = '#fff'; rr(c, x - b, y - b, w + 2 * b, h + 2 * b, 10 * u); c.fill(); c.restore();
    c.drawImage(img, x, y, w, h);
    c.font = `700 ${Math.round(30 * u)}px ${FONT.b}`; c.fillStyle = 'rgba(255,255,255,.85)'; c.textAlign = 'center'; c.fillText(dayLabel, W / 2, 86 * u * (P ? 1 : .55));
    const tags = (e.tags || []).map(t => '#' + t).join('  ');
    if (P) {
      let ty = y + h + b + 110 * u; c.textAlign = 'center';
      if (e.text) { c.font = `400 ${Math.round(74 * u)}px ${FONT.h}`; c.fillStyle = '#fff'; ty = lines(c, wrap(c, e.text, W * .86, 4), W / 2, ty, 86 * u) + 6 * u; }
      c.font = `600 ${Math.round(36 * u)}px ${FONT.b}`; c.fillStyle = 'rgba(255,255,255,.88)'; ty = lines(c, wrap(c, metaText(e), W * .86, 2), W / 2, ty, 48 * u);
      if (tags) { c.font = `700 ${Math.round(32 * u)}px ${FONT.b}`; c.fillStyle = PINK; c.fillText(tags, W / 2, ty + 8 * u); }
      footer(c, W, H, true);
    } else {
      c.textAlign = e.text ? 'right' : 'center'; const tx = e.text ? W - 70 * u : W / 2, tw = e.text ? W * .34 : W * .8; let ty = e.text ? H * .3 : H - 86 * u;
      if (e.text) { c.font = `400 ${Math.round(66 * u)}px ${FONT.h}`; c.fillStyle = '#fff'; ty = lines(c, wrap(c, e.text, tw, 6), tx, ty, 78 * u) + 20 * u; meander(c, tx - 190 * u, ty - 30 * u, 190 * u, GOLD, 1.6 * u); ty += 44 * u; }
      c.font = `600 ${Math.round(30 * u)}px ${FONT.b}`; c.fillStyle = 'rgba(255,255,255,.88)'; ty = lines(c, wrap(c, metaText(e), tw, 3), tx, ty, 42 * u);
      if (tags) { c.font = `700 ${Math.round(28 * u)}px ${FONT.b}`; c.fillStyle = PINK; c.fillText(tags, tx, ty + 6 * u); }
    }
    return cv;
  }
  function sNote(W, H, e, dayLabel) {
    const [cv, c] = mk(W, H), P = H > W, u = P ? W / 1080 : H / 900;
    c.fillStyle = '#fbf6ec'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#e9dfcb'; c.lineWidth = 2 * u; for (let y = 120 * u; y < H; y += 64 * u) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.textAlign = 'center'; c.font = `900 ${Math.round(300 * u)}px ${FONT.d}`; c.fillStyle = 'rgba(214,51,108,.18)'; c.fillText('”', W / 2, H * (P ? .3 : .36));
    c.font = `400 ${Math.round((P ? 88 : 74) * u)}px ${FONT.h}`; c.fillStyle = '#14213d';
    const ls = wrap(c, e.text || '', W * .8, P ? 9 : 6), lh = (P ? 104 : 88) * u; let ty = H / 2 - (ls.length * lh) / 2 + lh * .7; ty = lines(c, ls, W / 2, ty, lh);
    meander(c, W * .38, ty - 10 * u, W * .24, '#d6336c', 2 * u);
    c.font = `600 ${Math.round(34 * u)}px ${FONT.b}`; c.fillStyle = '#5c6884'; c.fillText([dayLabel, metaText(e)].join('  ·  '), W / 2, ty + 84 * u);
    return cv;
  }
  function sEnd(W, H, st) {
    const [cv, c] = mk(W, H), P = H > W, u = P ? W / 1080 : H / 900;
    sea(c, W, H); sun(c, W * .82, H * (P ? .14 : .2), 64 * u);
    c.textAlign = 'center'; c.fillStyle = '#ffd6e4'; c.font = `400 ${Math.round((P ? 120 : 100) * u)}px ${FONT.h}`; c.fillText('חרוניה פולה, דפנה', W / 2, H * (P ? .4 : .42));
    c.fillStyle = '#fff'; c.font = `600 ${Math.round(40 * u)}px ${FONT.b}`; c.fillText('Χρόνια πολλά · עד 120', W / 2, H * (P ? .46 : .53));
    meander(c, W * .3, H * (P ? .5 : .6), W * .4, 'rgba(255,255,255,.6)', 2.2 * u);
    c.font = `700 ${Math.round(46 * u)}px ${FONT.b}`; c.fillStyle = '#fff';
    c.fillText([`${st.photos} תמונות`, st.places ? `${st.places} מקומות` : '', `${st.days} ימים`].filter(Boolean).join('  ·  '), W / 2, H * (P ? .6 : .76));
    c.font = `900 ${Math.round(70 * u)}px ${FONT.d}`; c.fillText('אתונה 2026', W / 2, H * (P ? .7 : .9));
    return cv;
  }

  // ───── בניית המצגת ─────
  let slides = [], idx = 0, timer = null, fmt = 'p', building = false;
  async function build() {
    if (building) return; building = true;
    const us = A.journal.tab() === 'us';   // ביומן המשותף: רק מה שמשותף. ביומן האישי: כל הטיול שלך, אישי ומשותף
    const all = (await A.journal.all().catch(() => [])).filter(e => (!us || A.journal.inUs(e)) && ((e.type === 'photo' && e.blob) || (e.type === 'note' && e.text))).sort((a, b) => a.ts - b.ts);
    if (!all.length) { building = false; return A.toast('היומן עוד ריק. אחרי כמה תמונות תהיה כאן מצגת'); }
    const [W, H] = fmt === 'p' ? [1080, 1920] : [1600, 900];
    open(); status(`מכינה את המצגת… 0/${all.length}`);
    await Promise.all([`900 80px ${FONT.d}`, `400 60px ${FONT.h}`, `600 30px ${FONT.b}`, `700 30px ${FONT.b}`].map(f => document.fonts.load(f, 'אב').catch(() => {})));
    const t0 = A.dayDate(0); t0.setHours(0, 0, 0, 0);
    const dayOf = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d; };
    const groups = []; for (const e of all) { const d = dayOf(e.ts), g = groups[groups.length - 1]; if (g && +g.date === +d) g.items.push(e); else groups.push({ date: d, items: [e] }); }
    const names = (() => { try { const G = JSON.parse(localStorage.getItem('athina.group') || '{}'); return [...new Set([G.name, ...Object.values(G.members || {}).map(m => m.n)].filter(Boolean))]; } catch { return []; } })();
    const st = { from: groups[0].date, to: groups[groups.length - 1].date, names, photos: all.filter(e => e.type === 'photo').length, places: new Set(all.map(e => e.place).filter(Boolean)).size, days: groups.length };
    const out = [], push = async cv => out.push(await new Promise(r => cv.toBlob(r, 'image/jpeg', .88)));
    await push(sCover(W, H, st)); let done = 0;
    for (const g of groups) {
      const n = Math.round((g.date - t0) / 864e5) + 1, inTrip = n >= 1 && n <= A.S.days;
      const label = inTrip ? `יום ${n}` : g.date.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
      const imgs = []; for (const e of g.items) { if (e.type === 'photo') try { e._img = await loadImg(e.blob); imgs.push(e._img); } catch {} }
      await push(sDay(W, H, { date: g.date, label, title: inTrip ? PLAN[n - 1]?.title : '', imgs, count: g.items.length }));
      for (const e of g.items) { if (e.type === 'note') await push(sNote(W, H, e, label)); else if (e._img) await push(sPhoto(W, H, e, e._img, label)); delete e._img; status(`מכינה את המצגת… ${++done}/${all.length}`); await new Promise(r => setTimeout(r)); }
    }
    await push(sEnd(W, H, st));
    slides.forEach(s => URL.revokeObjectURL(s.url)); slides = out.filter(Boolean).map(b => ({ blob: b, url: URL.createObjectURL(b), W, H }));
    building = false; status(''); idx = 0; bars(); show(0); play(true);
  }

  // ───── נגן ─────
  const el = $('#show');
  function open() { el.hidden = false; document.body.style.overflow = 'hidden'; }
  function close() { el.hidden = true; play(false); document.body.style.overflow = ''; }
  function status(t) { $('#showStatus').textContent = t; $('#showStatus').hidden = !t; }
  function bars() { $('#showBars').innerHTML = slides.map(() => '<i></i>').join(''); }
  function show(i) {
    if (!slides.length) return; idx = Math.max(0, Math.min(slides.length - 1, i));
    const img = $('#showImg'); img.classList.remove('in'); img.src = slides[idx].url; requestAnimationFrame(() => img.classList.add('in'));
    [...$('#showBars').children].forEach((b, k) => b.className = k < idx ? 'done' : k === idx ? 'cur' : '');
    if (timer) { clearTimeout(timer); timer = setTimeout(() => idx < slides.length - 1 ? show(idx + 1) : play(false), 4500); }
  }
  function play(on) { clearTimeout(timer); timer = on ? setTimeout(() => idx < slides.length - 1 ? show(idx + 1) : play(false), 4500) : null; $('#showPlay').textContent = on ? 'השהיה' : 'הפעלה'; el.classList.toggle('playing', !!on); }
  $('#showClose').onclick = close;
  $('#showPlay').onclick = () => { if (!timer && idx === slides.length - 1) show(0); play(!timer); };
  $('#showFmt').onclick = () => { fmt = fmt === 'p' ? 'l' : 'p'; $('#showFmt').textContent = fmt === 'p' ? 'לרוחב' : 'לאורך'; play(false); build(); };
  let sx = null;
  $('#showStage').addEventListener('pointerdown', e => sx = e.clientX);
  $('#showStage').addEventListener('pointerup', e => { if (sx == null || !slides.length) return; const dx = e.clientX - sx, w = el.clientWidth; sx = null;
    if (Math.abs(dx) > 40) show(idx + (dx > 0 ? 1 : -1));            // החלקה (ימין = הבא, כמו דפדוף בעברית)
    else show(idx + (e.clientX < w / 2 ? 1 : -1)); });                // הקשה: צד שמאל = הבא
  document.addEventListener('keydown', e => { if (el.hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(idx + 1); if (e.key === 'ArrowRight') show(idx - 1); });

  // ───── שיתוף ─────
  async function pdf() {   // PDF פשוט: כל עמוד הוא תמונת JPEG אחת
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const add = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
    const obj = (n, body) => { offs[n] = len; add(`${n} 0 obj\n`); body(); add('\nendobj\n'); };
    add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/[\x80-\xff]/g, '?'));
    const N = slides.length, kids = slides.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => add(`<< /Type /Pages /Count ${N} /Kids [${kids}] >>`));
    for (let i = 0; i < N; i++) {
      const s = slides[i], jpg = new Uint8Array(await s.blob.arrayBuffer()), pw = s.W / 2, ph = s.H / 2, p = 3 + i * 3, content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
      obj(p, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
      obj(p + 1, () => add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
      obj(p + 2, () => { add(`<< /Type /XObject /Subtype /Image /Width ${s.W} /Height ${s.H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); add(jpg); add('\nendstream'); });
    }
    const xref = len, total = 3 + N * 3;
    add(`xref\n0 ${total}\n0000000000 65535 f \n` + Array.from({ length: total - 1 }, (_, k) => String(offs[k + 1]).padStart(10, '0') + ' 00000 n \n').join(''));
    add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  async function shareFiles(files, title) {
    if (navigator.canShare?.({ files })) { try { await navigator.share({ files, title }); } catch {} return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(files[0]); a.download = files[0].name; document.body.append(a); a.click(); a.remove();   // בדפדפן בלי שיתוף: הורדה
    A.toast(files.length > 1 ? 'הדפדפן הזה לא תומך בשיתוף כמה קבצים. נסי את ה־PDF' : 'הקובץ ירד למכשיר');
  }
  $('#showPdf').onclick = async () => { if (!slides.length) return; play(false); status('מכינה PDF…'); const f = new File([await pdf()], 'אתונה-דפנה-50.pdf', { type: 'application/pdf' }); status(''); shareFiles([f], 'אתונה · דפנה חוגגת 50'); };
  $('#showImgs').onclick = () => { if (!slides.length) return; play(false); shareFiles(slides.slice(0, 30).map((s, i) => new File([s.blob], `athens-${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' })), 'אתונה · דפנה חוגגת 50'); if (slides.length > 30) A.toast('משתפת את 30 השקפים הראשונים. למצגת המלאה עדיף PDF', 5000); };

  $('#jrShow').onclick = build;
  A.show = { build, pdf, get n() { return slides.length; } };
})();
