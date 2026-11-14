// ---------------- Config ----------------
const BROKER = 'wss://ieb71bf1.ala.eu-central-1.emqxsl.com:8084/mqtt';
const TOPIC  = 'office-status';                    // must equal MQTT_TOPIC in secrets.h

// Default status buttons. n = name, c = colour, t = text colour on the button and
// the big screen ('w' white / 'b' black), s = servo angle 0-180 (null = no move),
// i = 1: the small OLED shows white background. Edits are saved on the broker.
const DEFAULT_PRESETS = [
  {n:'פנוי',          c:'#1b9e4b', t:'w', s:20,  i:0},
  {n:'עובד מהבית',    c:'#6a1b9a', t:'w', s:50,  i:0},
  {n:'תכף חוזר',      c:'#f9a825', t:'b', s:80,  i:0},
  {n:'הפסקת צהריים',  c:'#00838f', t:'w', s:100, i:0},
  {n:'במעבדה',        c:'#1565c0', t:'w', s:120, i:0},
  {n:'בפגישה',        c:'#e65100', t:'w', s:145, i:1},
  {n:'עסוק',          c:'#c62828', t:'w', s:165, i:1},
  {n:'לא במשרד',      c:'#455a64', t:'w', s:0,   i:1},
];
// ----------------------------------------
const T = {
  set: TOPIC + '/set', bl: TOPIC + '/bl', online: TOPIC + '/online', tft: TOPIC + '/tft',
  servo: TOPIC + '/servo', feat: TOPIC + '/features', state: TOPIC + '/state', presets: TOPIC + '/presets'
};
const $ = id => document.getElementById(id);
const W = 128, H = 32, FONT = 'system-ui, "Noto Sans Hebrew", Arial, sans-serif';
const cv = $('cv'), ctx = cv.getContext('2d', {willReadFrequently: true});
const cv2 = $('cv2'), ctx2 = cv2.getContext('2d', {willReadFrequently: true});
const mask = document.createElement('canvas'); mask.width = mask.height = 240;
const mctx = mask.getContext('2d', {willReadFrequently: true});

// ---------------- Drawing (small 128x32 and big 240x240) ----------------
function txt(s, x, y, c) {
  c = c || ctx;
  c.direction = /[֐-׿]/.test(s) ? 'rtl' : 'ltr';
  c.fillText(s, x, y);
}
function fit(text, maxW, maxH, c, sizes) {
  c = c || ctx; sizes = sizes || [26, 22, 20, 18, 16, 14, 12, 10];
  const words = text.trim().split(/\s+/);
  for (const s of sizes) {
    c.font = `bold ${s}px ${FONT}`;
    const lines = []; let cur = '', ok = true;
    for (const w of words) {
      if (c.measureText(w).width > maxW) { ok = false; break; }
      const t = cur ? cur + ' ' + w : w;
      if (c.measureText(t).width <= maxW) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (ok && lines.length * s * 1.1 <= maxH) return {s, lines};
  }
  return {s: sizes[sizes.length - 1], lines: [text]};
}
function render(m) {
  const bg = m.inv ? '#fff' : '#000', fg = m.inv ? '#000' : '#fff';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const foot = [m.note, m.since ? 'מאז ' + m.since : ''].filter(Boolean).join(' | ');
  const bottom = foot ? 21 : 32;
  const f = fit(m.text, 124, bottom), lh = f.s * 1.1;
  ctx.font = `bold ${f.s}px ${FONT}`;
  const y0 = (bottom - f.lines.length * lh) / 2 + lh / 2;
  f.lines.forEach((l, i) => txt(l, W / 2, y0 + i * lh));
  if (foot) {
    let s = 11; ctx.font = `${s}px ${FONT}`;
    while (s > 9 && ctx.measureText(foot).width > 124) { s--; ctx.font = `${s}px ${FONT}`; }
    txt(foot, W / 2, 27);
  }
}
function bits() {
  const d = ctx.getImageData(0, 0, W, H), px = d.data, out = new Uint8Array(W * H / 8);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, on = (px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114) > 128, v = on ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
    if (on) out[(y * W + x) >> 3] |= 0x80 >> (x & 7);
  }
  ctx.putImageData(d, 0, 0);
  return out;
}
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb565 = ([r, g, b]) => ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
const lumOf = rgb => rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114;
function autoTxt(color) { return lumOf(hex2rgb(color)) > 150 ? 'b' : 'w'; }

// m.color = background colour, m.t = 'w' | 'b' text colour (default: automatic)
function renderBig(m) {
  const bg = hex2rgb(m.color || '#000000');
  const fg = (m.t || autoTxt(m.color || '#000000')) === 'b' ? [0, 0, 0] : [255, 255, 255];
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, 240, 240);
  mctx.fillStyle = '#fff'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  const rows = []; if (m.note) rows.push([m.note]); if (m.since) rows.push(['מאז ' + m.since]);
  const footH = rows.length * 32 + (rows.length ? 6 : 0), mainH = 240 - footH - 8;
  const f = fit(m.text, 224, mainH, mctx, [88, 76, 66, 56, 48, 40, 34, 28, 24, 20]);
  const lh = f.s * 1.1, y0 = 4 + (mainH - f.lines.length * lh) / 2 + lh / 2;
  mctx.font = `bold ${f.s}px ${FONT}`;
  f.lines.forEach((l, i) => txt(l, 120, y0 + i * lh, mctx));
  rows.forEach(([s], i) => {
    let sz = 26; mctx.font = `${sz}px ${FONT}`;
    while (sz > 14 && mctx.measureText(s).width > 228) { sz--; mctx.font = `${sz}px ${FONT}`; }
    txt(s, 120, 240 - footH + 16 + i * 32, mctx);
  });
  const d = mctx.getImageData(0, 0, 240, 240).data, out = new Uint8Array(240 * 240 / 8);
  const vis = ctx2.createImageData(240, 240);
  for (let p = 0; p < 240 * 240; p++) {
    const on = d[p * 4] > 128;
    if (on) out[p >> 3] |= 0x80 >> (p & 7);
    const c = on ? fg : bg;
    vis.data[p * 4] = c[0]; vis.data[p * 4 + 1] = c[1]; vis.data[p * 4 + 2] = c[2]; vis.data[p * 4 + 3] = 255;
  }
  ctx2.putImageData(vis, 0, 0);
  return {bits: out, bg: rgb565(bg), fg: rgb565(fg)};
}
function now() { const d = new Date(), p = n => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()); }

// ---------------- State ----------------
let client = null, brokerUp = false, boardUp = null, userName = '';
let feat = {small: true, big: true, servo: true};     // updated from the board (<topic>/state)
let presets = DEFAULT_PRESETS.slice();
let selName = null, editing = false, newTxt = 'w', editIdx = -1;
let lastM = null;            // the status that is on the board (used to re-send when only the note changes)
let boardIp = '';

function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function pub(topic, payload, retain, qos) {
  if (client && brokerUp) client.publish(topic, payload, {retain: !!retain, qos: qos === undefined ? 1 : qos});
}

// ---------------- UI: connection, features ----------------
function showConn() {
  const dot = $('dot'), t = $('connTxt');
  if (!brokerUp)            { dot.style.background = '#e74c3c'; t.textContent = 'אין חיבור לשרת'; }
  else if (boardUp === '1') { dot.style.background = '#2ecc71'; t.textContent = 'הלוח מחובר'; }
  else if (boardUp === '0') { dot.style.background = '#e6a417'; t.textContent = 'הלוח לא מחובר'; }
  else                      { dot.style.background = '#e6a417'; t.textContent = 'מצב הלוח לא ידוע'; }
  $('info').innerHTML = 'שרת: ' + (brokerUp ? 'מחובר' : 'לא מחובר') + '<br>לוח: ' +
    (boardUp === '1' ? 'מחובר' : boardUp === '0' ? 'לא מחובר' : 'לא ידוע') + '<br>משתמש: ';
  $('info').appendChild(document.createTextNode(userName || '-'));
  if (boardIp) $('info').appendChild(document.createTextNode(' | ' + boardIp));
}
function applyFeat() {
  $('pvSmall').classList.toggle('hide', !feat.small);
  $('pvBig').classList.toggle('hide', !feat.big);
  $('cPrev').classList.toggle('hide', !feat.small && !feat.big);
  $('cServo').classList.toggle('hide', !feat.servo);
  $('nSvRow').classList.toggle('hide', !feat.servo);
  $('blI').classList.toggle('hide', !feat.small && !feat.big);
  $('blBox').classList.toggle('hide', !feat.small && !feat.big);
  document.querySelectorAll('.ri[data-k]').forEach(b => {
    const v = feat[b.dataset.k];
    b.classList.toggle('on', v); b.setAttribute('aria-pressed', v);
    b.querySelector('.st2').textContent = v ? 'פעיל' : 'כבוי';
  });
}
document.querySelectorAll('.ri[data-k]').forEach(b => b.onclick = () => {
  if (!client || !brokerUp) { $('msg').textContent = 'אין חיבור לשרת'; return; }
  const k = b.dataset.k, next = Object.assign({}, feat, {[k]: !feat[k]});
  feat = next; applyFeat();                                   // optimistic; the board confirms on <topic>/state
  pub(T.feat, JSON.stringify({small: +next.small, big: +next.big, servo: +next.servo}), true);   // 1/0 for the board
});
$('tgl').onclick = () => {
  const o = $('rail').classList.toggle('open');
  $('tgl').querySelector('i').className = 'ti ' + (o ? 'ti-layout-sidebar-right-collapse' : 'ti-layout-sidebar-right-expand');
};
$('blI').onclick = () => { if (!$('rail').classList.contains('open')) $('tgl').click(); };
$('bl').onchange = e => pub(T.bl, String(e.target.value), true);

// ---------------- Status buttons ----------------
function drawGrid() {
  const g = $('grid'); g.innerHTML = '';
  presets.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'sb' + (p.n === selName ? ' sel' : '');
    b.style.background = p.c; b.style.color = p.t === 'b' ? '#000' : '#fff';
    b.textContent = p.n;
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; b.appendChild(x);
    b.onclick = e => {
      if (editing) {
        if (e.target === x) { presets.splice(i, 1); savePresets(); drawGrid(); }   // × = delete
        else openForm(i);                                                           // otherwise = edit
        return;
      }
      push(p.n, {color: p.c, t: p.t, inv: p.i, servo: p.s});
    };
    g.appendChild(b);
  });
  const a = document.createElement('button');
  a.className = 'sb add'; a.textContent = '+ כפתור חדש';
  a.onclick = () => openForm(-1);
  g.appendChild(a);
  g.classList.toggle('edit', editing);
}
function setTxtSeg(v) {
  newTxt = v;
  document.querySelectorAll('#nTxt button').forEach(x => x.classList.toggle('a', x.dataset.v === v));
}
// idx = -1: new button. Otherwise edit the existing button with that index.
function openForm(idx) {
  editIdx = idx;
  const p = idx >= 0 ? presets[idx] : {n: '', c: '#8e24aa', t: 'w', s: null, i: 0};
  $('nTitle').textContent = idx >= 0 ? 'עריכת כפתור' : 'כפתור חדש';
  $('saveNew').textContent = idx >= 0 ? 'עדכן כפתור' : 'שמור כפתור';
  $('nName').value = p.n; $('nCol').value = p.c; setTxtSeg(p.t);
  $('nInv').checked = !!p.i; $('nSv').value = p.s === null ? '' : p.s;
  $('cNew').classList.remove('hide'); $('nName').focus();
  $('cNew').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
function savePresets() { pub(T.presets, JSON.stringify({v: 1, list: presets}), true); }
$('editB').onclick = () => { editing = !editing; $('editB').textContent = editing ? 'סיום' : 'עריכה'; drawGrid(); };
$('cancelNew').onclick = () => { editIdx = -1; $('cNew').classList.add('hide'); };
document.querySelectorAll('#nTxt button').forEach(b => b.onclick = () => setTxtSeg(b.dataset.v));
$('saveNew').onclick = () => {
  const n = $('nName').value.trim();
  if (!n) { $('nName').style.borderColor = '#c62828'; return; }
  $('nName').style.borderColor = '';
  const s = $('nSv').value === '' ? null : Math.max(0, Math.min(180, parseInt($('nSv').value) || 0));
  const item = {n, c: $('nCol').value, t: newTxt, s, i: $('nInv').checked ? 1 : 0};
  if (editIdx >= 0 && presets[editIdx]) presets[editIdx] = item; else presets.push(item);
  savePresets(); drawGrid();
  $('nName').value = ''; $('nSv').value = ''; $('nInv').checked = false; editIdx = -1;
  $('cNew').classList.add('hide');
};
$('resetP').onclick = () => {
  if (!confirm('לשחזר את כפתורי ברירת המחדל? כפתורים שהוספת יימחקו.')) return;
  presets = DEFAULT_PRESETS.slice(); savePresets(); drawGrid();
};
$('sendCustom').onclick = () => {
  const t = $('custom').value.trim(), c = $('col').value;
  if (!t) return;
  const tc = autoTxt(c);
  push(t, {color: c, t: tc, inv: tc === 'b' ? 1 : 0});
};

// ---------------- Sending a status ----------------
function push(text, o) {
  if (!client || !brokerUp) { $('msg').textContent = 'אין חיבור לשרת'; return; }
  o = o || {};
  const m = {text, inv: o.inv ? 1 : 0, color: o.color || '#000000', t: o.t, note: $('note').value.trim(), since: now()};
  selName = text; drawGrid();
  send(m, o.servo);
}
// Sends a ready status to the board (small screen, big screen, optional servo angle).
function send(m, servo) {
  lastM = m;
  render(m);
  const hex = Array.from(bits(), b => b.toString(16).padStart(2, '0')).join('');
  const big = renderBig(m);
  $('msg').textContent = 'שולח...';
  const head = new TextEncoder().encode(JSON.stringify({bg: big.bg, fg: big.fg}) + '\n');
  const bin = new Uint8Array(head.length + big.bits.length);
  bin.set(head, 0); bin.set(big.bits, head.length);
  pub(T.tft, bin, true);
  if (feat.servo && typeof servo === 'number') svSet(servo);
  client.publish(T.set, JSON.stringify(m) + '\n' + hex, {retain: true, qos: 1}, err => {
    $('msg').textContent = err ? 'שגיאה בשליחה' : (boardUp === '1' ? 'עודכן ✓' : 'נשלח ✓ (הלוח לא מחובר כרגע)');
  });
}

// ---------------- Servo ----------------
let svLast = 0;
function svMove(v, final) {
  $('svv').textContent = v;
  if (!client || !brokerUp) return;
  const t = Date.now();
  if (!final && t - svLast < 120) return;            // live while dragging, throttled
  svLast = t;
  pub(T.servo, String(v), final, final ? 1 : 0);
}
function svSet(v) { $('sv').value = v; svMove(v, true); }
$('sv').oninput = e => svMove(e.target.value, false);
$('sv').onchange = e => svMove(e.target.value, true);
document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => svSet(+b.dataset.a));
$('svOff').onclick = () => { pub(T.servo, 'off', true); $('svv').textContent = 'כבוי'; };

// ---------------- MQTT ----------------
function connect(user, pass) {
  if (client) { try { client.end(true); } catch (e) {} }
  userName = user; brokerUp = false; boardUp = null; showConn();
  client = mqtt.connect(BROKER, {
    username: user, password: pass,
    clientId: 'ctl-' + Math.random().toString(16).slice(2, 10),
    reconnectPeriod: 3000, connectTimeout: 10000, clean: true
  });
  client.on('connect', () => {
    brokerUp = true; showConn(); $('login').classList.add('hide');
    client.subscribe([T.set, T.bl, T.online, T.state, T.presets], {qos: 1});
  });
  client.on('close', () => { brokerUp = false; showConn(); });
  client.on('error', e => {
    const m = String(e && e.message || e);
    const auth = /not authori|bad user|auth/i.test(m);
    $('msg').textContent = auth ? 'שם משתמש או סיסמה שגויים' : 'שגיאת חיבור';
    if (auth) { try { client.end(true); } catch (x) {} $('login').classList.remove('hide'); }
  });
  client.on('message', (topic, payload) => {
    const s = new TextDecoder().decode(payload);
    if (topic === T.online) { boardUp = s; showConn(); }
    else if (topic === T.bl) { $('bl').value = parseInt(s) || 160; }
    else if (topic === T.state) {
      try {
        const j = JSON.parse(s); feat = {small: !!j.small, big: !!j.big, servo: !!j.servo}; applyFeat();
        boardIp = /^[0-9.]{7,15}$/.test(j.ip || '') ? j.ip : ''; setWifiLink();
      } catch (e) {}
    }
    else if (topic === T.presets) {
      try {
        const j = JSON.parse(s);
        if (j && Array.isArray(j.list)) {
          presets = j.list.filter(p => p && typeof p.n === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.c))
            .map(p => ({n: p.n.slice(0, 20), c: p.c, t: p.t === 'b' ? 'b' : 'w',
                        s: (typeof p.s === 'number') ? Math.max(0, Math.min(180, p.s)) : null, i: p.i ? 1 : 0}));
          drawGrid();
        }
      } catch (e) {}
    }
    else if (topic === T.set) {                      // last status that is on the board
      const nl = s.indexOf('\n'); if (nl < 0) return;
      try {
        const m = JSON.parse(s.slice(0, nl)); lastM = m;
        render(m); bits(); renderBig(m);
        $('note').value = m.note || ''; selName = m.text; drawGrid();
      } catch (e) {}
    }
  });
}
// WiFi settings page of the board: by IP (from the board), because status.local often fails on phones.
function setWifiLink() {
  $('wifiL').href = boardIp ? 'http://' + boardIp + '/wifi' : 'http://status.local/wifi';
}
// Editing or clearing the note updates the screens by itself (a short pause after typing).
let noteTimer = null;
$('note').addEventListener('input', () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    if (!lastM || !client || !brokerUp) return;
    const note = $('note').value.trim();
    if (note === (lastM.note || '')) return;
    send(Object.assign({}, lastM, {note}));          // same status and time, new note; the servo is not touched
  }, 700);
});

function saveLogin() {
  const u = $('u').value.trim(), p = $('p').value;
  if (!u || !p) return;
  store('mq_u', u); store('mq_p', p); connect(u, p);
}
function logout() {
  store('mq_u', null); store('mq_p', null);
  if (client) { try { client.end(true); } catch (e) {} }
  brokerUp = false; userName = ''; showConn(); $('login').classList.remove('hide');
}
$('loginBtn').onclick = saveLogin;
$('logoutB').onclick = logout;

// ---------------- Start ----------------
render({text: '...', inv: 0, note: '', since: ''}); bits();
renderBig({text: '...', color: '#000000', note: '', since: ''});
drawGrid(); applyFeat(); showConn();
const su = load('mq_u'), sp = load('mq_p');
if (su && sp) connect(su, sp); else $('login').classList.remove('hide');
