/* Ajandamız — iki kişilik ortak yapılacaklar, takvim, market listesi ve sohbet.
 * Derleme gerektirmez. config.js'te firebase ayarı yoksa Demo modunda
 * (localStorage) çalışır; varsa Firebase Auth + Firestore ile senkronlanır.
 * Hava durumu Open-Meteo'dan (ücretsiz, anahtarsız) gelir. */
(function () {
  'use strict';

  const CFG = window.CIFT_AJANDA_CONFIG || {};
  const DEF = {
    a: { name: 'Kişi 1', color: '#3b82f6', markLabel: 'Nöbet', markIcon: '🩺' },
    b: { name: 'Kişi 2', color: '#ec4899', markLabel: 'Etkinlik', markIcon: '🎉' },
  };
  const cm = CFG.members || {};
  const MEMBERS = { a: { ...DEF.a, ...cm.a }, b: { ...DEF.b, ...cm.b } };
  const CONFIG_NAMES = { a: MEMBERS.a.name, b: MEMBERS.b.name };
  const BOTH = 'both';
  const COLORS = { a: MEMBERS.a.color, b: MEMBERS.b.color, both: CFG.bothColor || '#a855f7' };
  const FIREBASE_VER = '10.14.1';
  // Döngü (regl) takibi config'te "cycle: true" olan kişi içindir
  const CYCLE_OWNER = Object.keys(MEMBERS).find((k) => MEMBERS[k].cycle) || null;
  const CYCLE_COL = CYCLE_OWNER ? `cycle/${CYCLE_OWNER}/days` : null;
  const SYMPTOMS = ['Kramp', 'Baş ağrısı', 'Yorgunluk', 'Şişkinlik', 'Hassasiyet', 'Keyifsiz', 'Aşerme', 'Enerjik'];
  const FLOWS = [['az', 'Az'], ['orta', 'Orta'], ['yogun', 'Yoğun']];

  // ---------------------------------------------------------------- tarih
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const fmtLong = (s) => parseYmd(s).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = (s) => parseYmd(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const weekday = (s) => parseYmd(s).toLocaleDateString('tr-TR', { weekday: 'long' });
  const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function relDay(s) {
    const t = today();
    if (s === t) return 'Bugün';
    if (s === addDays(t, 1)) return 'Yarın';
    if (s === addDays(t, -1)) return 'Dün';
    return fmtShort(s);
  }
  const toMs = (v) => (typeof v === 'number' ? v : v && v.toMillis ? v.toMillis() : 0);
  const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isHm = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
  const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const avg = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;

  // ---------------------------------------------------------------- yardımcılar
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Yüklenemedi: ' + src));
      document.head.appendChild(s);
    });
  }
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* yok say */ } };
  // Basit, güvenli metin biçimlendirme (önce kaçış, sonra **kalın**, liste ve bağlantı)
  function richText(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^\s*[-*•]\s+/gm, '• ')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  // Yapay zekâ yokken kullanılan günün sözleri (atasözleri)
  const QUOTES = [
    'Birlikten kuvvet doğar.', 'Bir elin nesi var, iki elin sesi var.', 'Damlaya damlaya göl olur.',
    'Tatlı dil yılanı deliğinden çıkarır.', 'Gönül ne kahve ister ne kahvehane, gönül sohbet ister kahve bahane.',
    'Yuvayı dişi kuş yapar.', 'Sabreden derviş muradına ermiş.', 'Bugünün işini yarına bırakma.',
    'İşleyen demir ışıldar.', 'Az olsun, öz olsun.', 'Dost kara günde belli olur.', 'Her işte bir hayır vardır.',
    'Ak akçe kara gün içindir.', 'Komşu komşunun külüne muhtaçtır.', 'Gülme komşuna, gelir başına.',
    'Ağaç yaşken eğilir.', 'Bin bilsen de bir bilene danış.', 'Akıl akıldan üstündür.',
    'Emek olmadan yemek olmaz.', 'Söz gümüşse sükût altındır.', 'Bir kahvenin kırk yıl hatırı vardır.',
  ];
  const builtinQuote = (d) => {
    const n = Math.floor(parseYmd(d).getTime() / 864e5);
    return { text: QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length], author: 'Atasözü' };
  };

  // ---------------------------------------------------------------- durum
  const state = {
    me: 'a',
    view: 'today',          // today | all | calendar | lists | budget | chat
    filter: 'all',          // all | mine | other | both
    calMonth: null,
    selDay: today(),
    showDone: false,
    markMode: false,        // false | 'mark' (nöbet/etkinlik) | 'period' (regl)
    cycle: { settings: null, days: [], layer: lsGet('cift-ajanda:cycleLayer') !== '0' },
    editingId: null,
    shopUrgent: false,
    tasks: [], shopping: [], messages: [], marks: [],
    listTab: ['market', 'watch', 'wish', 'trip'].includes(lsGet('cift-ajanda:listTab')) ? lsGet('cift-ajanda:listTab') : 'market',
    board: [], boardPick: null,
    expenses: [], budgetMonth: today().slice(0, 7), budgetLimit: 0,
    notifyPrefs: null,
    weather: null,          // { loc, data, at }
    weatherBusy: false,
    chatSeen: Number(lsGet('cift-ajanda:chatSeen')) || 0,
  };
  let store = null;
  const other = () => (state.me === 'a' ? 'b' : 'a');
  const nameOf = (k) => (k === state.me ? 'Ben' : MEMBERS[k] ? MEMBERS[k].name : '?');
  const ownerLabel = (o) => (o === BOTH ? 'Ortak' : nameOf(o));
  const ownerColor = (o) => COLORS[o] || COLORS.both;

  // ---------------------------------------------------------------- açılış
  function showGate(msg, { login = false, logout = false } = {}) {
    $('#gate').hidden = false;
    $('#app').hidden = true;
    $('#gate-msg').textContent = msg;
    $('#btn-login').hidden = !login;
    $('#btn-logout-gate').hidden = !logout;
  }

  let renderQueued = false;
  const scheduleRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  };

  function startApp() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    $('#demo-banner').hidden = store.mode !== 'demo';
    store.watch('tasks', (d) => { state.tasks = d; scheduleRender(); });
    store.watch('shopping', (d) => { state.shopping = d; scheduleRender(); });
    store.watch('marks', (d) => { state.marks = d; scheduleRender(); });
    store.watch('messages', (d) => {
      const grew = d.length > state.messages.length;
      state.messages = d;
      scheduleRender();
      if (grew && state.view === 'chat') requestAnimationFrame(() => scrollChat(true));
    }, { latest: 300 });
    // Uygulama içinden değiştirilen isimler config.js'tekilerin önüne geçer
    store.watchDoc('settings', 'profile', (d) => {
      const names = (d && d.names) || {};
      for (const k of ['a', 'b']) MEMBERS[k].name = (names[k] || '').trim() || CONFIG_NAMES[k];
      scheduleRender();
    });
    if (CYCLE_OWNER) {
      store.watchDoc('cycleSettings', CYCLE_OWNER, (d) => { state.cycle.settings = d; syncCycleWatch(); scheduleRender(); });
    }
    store.watch('board', (d) => { state.board = d; scheduleRender(); });
    store.watch('expenses', (d) => { state.expenses = d; scheduleRender(); });
    store.watchDoc('settings', 'budget', (d) => { state.budgetLimit = (d && Number(d.limit)) || 0; scheduleRender(); });
    watchPrefs();
    initWeather();
    initPush();
    render();
  }

  async function boot() {
    bindUi();
    window.addEventListener('ca-error', (e) => toast('Senkron hatası: ' + (e.detail.code || e.detail.message)));

    if (!CFG.firebase) {
      state.me = lsGet('cift-ajanda:me') === 'b' ? 'b' : 'a';
      store = window.CA_STORE.local();
      startApp();
      return;
    }

    try {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}/`;
      await loadScript(base + 'firebase-app-compat.js');
      await Promise.all([loadScript(base + 'firebase-auth-compat.js'), loadScript(base + 'firebase-firestore-compat.js')]);
    } catch (e) {
      showGate('Bağlantı kurulamadı. İnternetinizi kontrol edip sayfayı yenileyin.');
      return;
    }

    firebase.initializeApp(CFG.firebase);
    const auth = firebase.auth();
    const db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* destek yoksa çevrimiçi devam */ });

    $('#btn-login').onclick = async () => {
      const provider = new firebase.auth.GoogleAuthProvider();
      try { await auth.signInWithPopup(provider); }
      catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          auth.signInWithRedirect(provider);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          toast('Giriş başarısız: ' + (e.code || e.message));
        }
      }
    };
    const signOut = () => auth.signOut().then(() => location.reload());
    $('#btn-logout-gate').onclick = signOut;
    state.signOut = signOut;

    let started = false;
    auth.onAuthStateChanged((user) => {
      if (!user) { showGate('İkimize özel ajandaya hoş geldin.', { login: true }); return; }
      const email = (user.email || '').toLowerCase();
      const key = Object.keys(MEMBERS).find((k) => (MEMBERS[k].email || '').toLowerCase() === email);
      if (!key) { showGate(`${user.email} bu ajandaya erişemiyor.`, { logout: true }); return; }
      state.me = key;
      if (!started) { started = true; store = window.CA_STORE.firebase(db); startApp(); }
    });
  }

  // ---------------------------------------------------------------- filtre / sıralama
  function passFilter(t) {
    switch (state.filter) {
      case 'mine': return t.owner === state.me || t.owner === BOTH;
      case 'other': return t.owner === other() || t.owner === BOTH;
      case 'both': return t.owner === BOTH;
      default: return true;
    }
  }
  function cmpTasks(x, y) {
    if (!!x.done !== !!y.done) return x.done ? 1 : -1;
    const dx = x.date || '9999', dy = y.date || '9999';
    if (dx !== dy) return dx < dy ? -1 : 1;
    const tx = x.time || '99', ty = y.time || '99';
    if (tx !== ty) return tx < ty ? -1 : 1;
    return toMs(x.createdAt) - toMs(y.createdAt);
  }
  const visibleTasks = () => state.tasks.filter(passFilter).sort(cmpTasks);
  const marksOn = (d) => state.marks.filter((m) => m.date === d).sort((x, y) => (x.owner < y.owner ? -1 : 1));
  const markId = (date, owner) => `${date}_${owner}`;

  // ---------------------------------------------------------------- Döngü (regl) takibi
  // Gizlilik: kayıtları sadece döngü sahibi girer; eş ancak "paylaş" açıksa görür
  // (Firestore kuralı da bunu zorlar).
  const cycleIsMine = () => !!CYCLE_OWNER && state.me === CYCLE_OWNER;
  const cycleCanSee = () => !!CYCLE_OWNER && (cycleIsMine() || !!(state.cycle.settings && state.cycle.settings.share));
  const cycleLayerOn = () => cycleCanSee() && state.cycle.layer;
  let unCycle = null;
  function syncCycleWatch() {
    const want = cycleCanSee();
    if (want && !unCycle) {
      unCycle = store.watch(CYCLE_COL, (d) => { state.cycle.days = d; scheduleRender(); }, { silent: true });
    } else if (!want && unCycle) {
      unCycle(); unCycle = null; state.cycle.days = [];
    }
  }

  function computeCycle() {
    const logged = state.cycle.days.filter((d) => d.period).map((d) => d.date).sort();
    const s = state.cycle.settings || {};
    const eps = []; // regl dönemleri: art arda (≤2 gün boşluklu) günler
    for (const d of logged) {
      const l = eps[eps.length - 1];
      if (l && diffDays(l.end, d) <= 2) l.end = d; else eps.push({ start: d, end: d });
    }
    const lens = [];
    for (let i = 1; i < eps.length; i++) {
      const L = diffDays(eps[i - 1].start, eps[i].start);
      if (L >= 15 && L <= 60) lens.push(L);
    }
    const recent = lens.slice(-6);
    const finished = eps.slice(0, -1).slice(-6).map((e) => diffDays(e.start, e.end) + 1).filter((n) => n >= 2);
    return {
      logged, eps,
      last: eps[eps.length - 1] || null,
      cycleLen: recent.length ? Math.round(avg(recent)) : clamp(Number(s.cycleLen) || 28, 20, 45),
      periodLen: finished.length ? clamp(Math.round(avg(finished)), 2, 10) : clamp(Number(s.periodLen) || 5, 2, 10),
      learned: recent.length,
    };
  }

  // Takvim için gün bilgisi: kayıtlı regl + (bugünden itibaren) tahminler
  function cycleMap() {
    const c = computeCycle();
    const t = today();
    const map = {};
    const put = (d, k) => { (map[d] = map[d] || {})[k] = true; };
    for (const d of c.logged) put(d, 'period');
    if (c.last) {
      for (let k = 1; k <= 14; k++) {
        const ps = addDays(c.last.start, k * c.cycleLen);
        if (diffDays(t, ps) > 200) break;
        const ov = addDays(ps, -14);
        for (let i = -5; i <= 1; i++) { const d = addDays(ov, i); if (d >= t && !(map[d] && map[d].period)) put(d, 'fertile'); }
        if (ov >= t) put(ov, 'ovu');
        for (let i = 0; i < c.periodLen; i++) {
          const d = addDays(ps, i);
          if (d >= t && d > c.last.end && !(map[d] && map[d].period)) put(d, 'pred');
        }
      }
    }
    return { map, c };
  }

  function cycleStatus() {
    const c = computeCycle();
    if (!c.last) return { c, empty: true };
    const t = today();
    const day = diffDays(c.last.start, t) + 1;
    const next = addDays(c.last.start, c.cycleLen);
    const until = diffDays(t, next);
    const todayDoc = state.cycle.days.find((d) => d.date === t);
    const loggedToday = !!(todayDoc && todayDoc.period);
    const inPeriod = loggedToday || (c.last.end === addDays(t, -1) && day <= c.periodLen);
    const ov = addDays(next, -14);
    const k = diffDays(ov, t);
    return { c, day, next, until, inPeriod, loggedToday, todayDoc, fertile: k >= -5 && k <= 1, ovuToday: k === 0, stale: day > c.cycleLen * 2 };
  }

  async function setCycleDay(date, patch) {
    const cur = state.cycle.days.find((d) => d.date === date) || {};
    const next = { date, owner: CYCLE_OWNER, period: !!cur.period, flow: cur.flow || null, symptoms: cur.symptoms || [], ...patch };
    if (!next.period) next.flow = null;
    if (!next.period && !next.symptoms.length) await store.remove(CYCLE_COL, date);
    else await store.set(CYCLE_COL, date, next);
  }

  function cycleCardHtml() {
    if (!cycleCanSee()) return '';
    const st = cycleStatus();
    const nm = MEMBERS[CYCLE_OWNER].name;
    if (cycleIsMine()) {
      if (st.empty) {
        return `<div class="cycle-card"><div class="cy-h">🌸 Döngü takibi</div>
          <p>Regl günlerini işaretle; sonraki dönemini, doğurgan günlerini ve yumurtlamayı tahmin edeyim.</p>
          <button class="btn cy-btn" data-cy="today">🩸 Bugün regl başladı</button></div>`;
      }
      let sub;
      if (st.stale) sub = 'Uzun süredir kayıt yok — son regl gününü takvimden işaretle.';
      else if (st.inPeriod) {
        const f = st.todayDoc && FLOWS.find(([k]) => k === st.todayDoc.flow);
        sub = 'Regl dönemi' + (f ? ' · ' + f[1] : '') + (st.loggedToday ? '' : ' · bugünü işaretlemeyi unutma');
      } else if (st.until < 0) sub = `Regl ${-st.until} gün gecikti`;
      else if (st.until === 0) sub = 'Reglin bugün bekleniyor';
      else sub = `Sonraki regl ~${st.until} gün sonra (${fmtShort(st.next)})`;
      if (!st.inPeriod && !st.stale) sub += st.ovuToday ? ' · tahmini yumurtlama günü' : st.fertile ? ' · doğurgan dönem' : '';
      const btn = st.loggedToday
        ? '<button class="btn cy-btn ghost" data-goto="calendar">✓ Bugün kaydedildi · belirti ekle</button>'
        : '<button class="btn cy-btn" data-cy="today">🩸 Bugün regl</button>';
      return `<div class="cycle-card"><div class="cy-h">🌸 ${st.stale ? 'Döngü' : `Döngünün ${st.day}. günü`}</div><p>${esc(sub)}</p>${btn}</div>`;
    }
    // eşin görünümü (yalnızca paylaşım açıksa) — sadece yakın/aktif dönemde nazik bir not
    if (st.empty || st.stale) return '';
    let msg = '';
    if (st.inPeriod) msg = `${nm}: regl döneminde — bugün ona biraz daha iyi bak 💕`;
    else if (st.until === 0) msg = `${nm}: reglin bugün başlaması bekleniyor 💕`;
    else if (st.until > 0 && st.until <= 3) msg = `${nm}: regl dönemi ~${st.until} gün sonra 💕`;
    return msg ? `<div class="cycle-card"><div class="cy-h">🌸 ${esc(msg)}</div></div>` : '';
  }

  function cycleDayHtml(d) {
    if (!cycleLayerOn()) return '';
    const { map } = cycleMap();
    const info = map[d] || {};
    const doc = state.cycle.days.find((x) => x.date === d);
    const sym = (doc && doc.symptoms) || [];
    const tags = [];
    if (!info.period && info.pred) tags.push('Tahmini regl');
    if (info.ovu) tags.push('Tahmini yumurtlama');
    else if (info.fertile) tags.push('Doğurgan dönem (tahmini)');
    const tagHtml = tags.map((x) => `<span class="cy-tag">${esc(x)}</span>`).join('');
    if (!cycleIsMine() || d > today()) {
      const parts = (info.period ? '<span class="cy-tag on">🩸 Regl günü</span>' : '') + tagHtml
        + (sym.length ? `<span class="mark-hint">${esc(sym.join(', '))}</span>` : '');
      return parts ? section('🌸 Döngü', `<div class="cy-body"><div class="cy-row">${parts}</div></div>`) : '';
    }
    const flow = doc && doc.period
      ? `<div class="seg">${FLOWS.map(([k, l]) => `<button class="${doc.flow === k ? 'on' : ''}" data-cy="flow" data-v="${k}" data-d="${d}">${l}</button>`).join('')}</div>` : '';
    return section('🌸 Döngü', `<div class="cy-body">
      <div class="cy-row"><button class="chip${doc && doc.period ? ' on cy-on' : ''}" data-cy="period" data-d="${d}">🩸 Regl günü</button>${tagHtml}</div>
      ${flow}
      <div class="chips">${SYMPTOMS.map((s) => `<button class="chip sm${sym.includes(s) ? ' on' : ''}" data-cy="sym" data-v="${esc(s)}" data-d="${d}">${esc(s)}</button>`).join('')}</div>
    </div>`);
  }

  // ---------------------------------------------------------------- ortak çizim parçaları
  function taskHtml(t, { showDate = true } = {}) {
    const c = ownerColor(t.owner);
    const late = !t.done && t.date && t.date < today();
    const meta = [];
    if (showDate && t.date) meta.push(`<span class="${late ? 'late' : ''}">${esc(relDay(t.date))}</span>`);
    if (t.time) meta.push(`<span>🕑 ${esc(t.time)}</span>`);
    meta.push(`<span class="owner-tag"><i class="dot" style="background:${c}"></i>${esc(ownerLabel(t.owner))}</span>`);
    if (t.note) meta.push('<span title="Not var">📝</span>');
    if (t.done && t.doneBy && MEMBERS[t.doneBy]) meta.push(`<span>✓ ${esc(t.doneBy === state.me ? 'sen' : MEMBERS[t.doneBy].name)}</span>`);
    return `<div class="task${t.done ? ' done' : ''}" data-id="${esc(t.id)}" style="--c:${c}">
      <button class="check" data-act="toggle" aria-label="${t.done ? 'Geri al' : 'Tamamla'}">${t.done ? '✓' : ''}</button>
      <button class="task-body" data-act="edit">
        <span class="task-title">${esc(t.title)}</span>
        <span class="task-meta">${meta.join('')}</span>
      </button>
    </div>`;
  }
  function section(title, rowsHtml, opts = {}) {
    if (!rowsHtml && !opts.keepEmpty) return '';
    const right = opts.right ? `<span>${opts.right}</span>` : '';
    const body = rowsHtml
      ? `<div class="card">${rowsHtml}</div>`
      : `<div class="card"><div class="empty">${opts.emptyText || 'Boş'}</div></div>`;
    return `<div class="section"><div class="section-head${opts.late ? ' late' : ''}"><span>${title}</span>${right}</div>${opts.pre || ''}${body}</div>`;
  }
  const taskSection = (title, tasks, opts = {}) => section(title, tasks.map((t) => taskHtml(t, opts)).join(''), opts);

  function renderFilters() {
    const o = other();
    const items = [
      ['all', 'Hepsi', null],
      ['mine', 'Benim', COLORS[state.me]],
      ['other', MEMBERS[o].name, COLORS[o]],
      ['both', 'Ortak', COLORS.both],
    ];
    $('#filters').innerHTML = items.map(([k, label, c]) =>
      `<button class="chip${state.filter === k ? ' on' : ''}" data-filter="${k}">${c ? `<i class="dot" style="background:${c}"></i>` : ''}${esc(label)}</button>`
    ).join('');
  }

  function renderMe() {
    const m = MEMBERS[state.me];
    $('#me-badge').innerHTML = `<span class="avatar" style="background:${COLORS[state.me]}">${esc((m.name || '?').charAt(0).toUpperCase())}</span>${esc(m.name)}${store && store.mode === 'demo' ? ' ⇄' : ''}`;
  }

  // ---------------------------------------------------------------- Bugün
  function renderToday() {
    const t = today();
    const weekEnd = addDays(t, 7);
    const all = visibleTasks();
    const late = all.filter((x) => !x.done && x.date && x.date < t);
    const todays = all.filter((x) => x.date === t);
    const week = all.filter((x) => !x.done && x.date && x.date > t && x.date <= weekEnd);
    const undated = all.filter((x) => !x.done && !x.date);
    const doneN = todays.filter((x) => x.done).length;
    const pct = todays.length ? Math.round((doneN / todays.length) * 100) : 0;

    $('#view-title').textContent = 'Bugün';
    $('#view-sub').textContent = fmtLong(t);

    const q = builtinQuote(t);
    let html = weatherCardHtml();
    html += `<div class="quote"><div class="q-label">Günün sözü</div>
      <blockquote>“${esc(q.text)}”</blockquote><div class="q-author">— ${esc(q.author || 'Anonim')}</div></div>`;
    html += cycleCardHtml();

    // bugün / yarın nöbet-etkinlik bilgisi + acil market
    const pills = [];
    for (const [d, lbl] of [[t, 'Bugün'], [addDays(t, 1), 'Yarın']]) {
      for (const m of marksOn(d)) {
        const mem = MEMBERS[m.owner]; if (!mem) continue;
        pills.push(`<span class="mark-pill" style="--c:${COLORS[m.owner]}">${esc(mem.markIcon)} ${lbl} · ${esc(mem.markLabel)} (${esc(nameOf(m.owner))})</span>`);
      }
    }
    const urgentN = state.shopping.filter((s) => !s.bought && s.urgent).length;
    if (urgentN) pills.push(`<button class="mark-pill" style="--c:${COLORS.both}" data-goto="market">⚡ ${urgentN} ürün hemen alınacak</button>`);
    if (pills.length) html += `<div class="notice-row">${pills.join('')}</div>`;

    html += taskSection('Gecikenler', late, { late: true });
    html += taskSection('Bugün', todays, {
      keepEmpty: true, showDate: false, emptyText: 'Bugün için plan yok. + ile ekleyin.',
      right: todays.length ? `${doneN}/${todays.length}` : '',
      pre: todays.length ? `<div class="progress"><i style="width:${pct}%"></i></div>` : '',
    });
    html += taskSection('Önümüzdeki 7 gün', week);
    html += taskSection('Tarihsiz', undated);
    html += `<div class="toggle-row"><span></span><button class="link-btn" data-goto="all">Tüm görevler →</button></div>`;
    $('#main').innerHTML = html;
  }

  // ---------------------------------------------------------------- Tümü
  function renderAll() {
    const all = visibleTasks().filter((x) => state.showDone || !x.done);
    const groups = new Map();
    for (const x of all) {
      const k = x.date || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    const keys = [...groups.keys()].filter(Boolean).sort();
    if (groups.has('')) keys.push('');
    const t = today();
    $('#view-title').textContent = 'Tüm görevler';
    const openN = state.tasks.filter((x) => !x.done && passFilter(x)).length;
    $('#view-sub').textContent = `${openN} açık görev`;
    let html = `<div class="toggle-row"><button class="link-btn" data-goto="today">← Bugün</button>
      <button class="chip${state.showDone ? ' on' : ''}" data-act="showdone">✓ Tamamlananlar</button></div>`;
    if (!keys.length) html += '<div class="empty">Henüz görev yok.</div>';
    for (const k of keys) {
      const title = k ? `${relDay(k)}${[t, addDays(t, 1), addDays(t, -1)].includes(k) ? ' · ' + fmtShort(k) : ''}` : 'Tarihsiz';
      html += taskSection(esc(title), groups.get(k), { showDate: false, late: k && k < t });
    }
    $('#main').innerHTML = html;
  }

  // ---------------------------------------------------------------- Takvim
  function dayStyle(owners) {
    if (!owners.length) return '';
    if (owners.length === 1) return `background:color-mix(in srgb, ${COLORS[owners[0]]} 24%, var(--surface))`;
    return `background:linear-gradient(135deg, color-mix(in srgb, ${COLORS.a} 28%, var(--surface)) 50%, color-mix(in srgb, ${COLORS.b} 28%, var(--surface)) 50%)`;
  }

  function renderCalendar() {
    const t = today();
    if (!state.calMonth) state.calMonth = t.slice(0, 8) + '01';
    const first = parseYmd(state.calMonth);
    const monthName = first.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    const startOffset = (first.getDay() + 6) % 7; // Pazartesi başlangıç
    const gridStart = addDays(state.calMonth, -startOffset);
    const byDay = {};
    for (const x of visibleTasks()) if (x.date) (byDay[x.date] = byDay[x.date] || []).push(x);
    const markByDay = {};
    for (const m of state.marks) if (MEMBERS[m.owner]) (markByDay[m.date] = markByDay[m.date] || []).push(m.owner);

    const cyc = cycleLayerOn() ? cycleMap().map : {};
    const wds = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => `<div class="wd">${d}</div>`).join('');
    let cells = '';
    let myMarksThisMonth = 0;
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const inMonth = d.slice(0, 7) === state.calMonth.slice(0, 7);
      const items = (byDay[d] || []).filter((x) => !x.done);
      const owners = (markByDay[d] || []).slice().sort();
      if (inMonth && owners.includes(state.me)) myMarksThisMonth++;
      const dots = items.slice(0, 4).map((x) => `<i class="dot" style="background:${ownerColor(x.owner)}"></i>`).join('')
        + (items.length > 4 ? '<span class="more">+</span>' : '');
      const icons = owners.map((o) => MEMBERS[o].markIcon).join('');
      const cy = cyc[d] || {};
      const cyCls = cy.period ? 'cy-period' : cy.pred ? 'cy-pred' : cy.ovu ? 'cy-ovu' : cy.fertile ? 'cy-fertile' : '';
      const cyLbl = { 'cy-period': 'regl', 'cy-pred': 'tahmini regl', 'cy-ovu': 'tahmini yumurtlama', 'cy-fertile': 'doğurgan dönem' }[cyCls];
      const cls = ['day', inMonth ? '' : 'out', d === t ? 'today' : '', d === state.selDay && !state.markMode ? 'sel' : '', cyCls].join(' ');
      const label = `${fmtLong(d)}, ${items.length} görev${owners.length ? ', ' + owners.map((o) => MEMBERS[o].markLabel).join(' ve ') : ''}${cyLbl ? ', ' + cyLbl : ''}`;
      const wx = d >= t ? weatherOn(d) : null;
      cells += `<button class="${cls}" data-day="${d}" style="${dayStyle(owners)}" aria-label="${esc(label)}${wx ? ', ' + esc(wmo(wx.code)[1]) + ' ' + deg(wx.max) : ''}">${wx ? `<span class="wx">${wmo(wx.code)[0]}</span>` : ''}${icons ? `<span class="mk">${icons}</span>` : ''}<span class="n">${parseYmd(d).getDate()}</span><span class="dots">${dots}</span></button>`;
    }

    const me = MEMBERS[state.me];
    $('#view-title').textContent = 'Takvim';
    $('#view-sub').textContent = state.markMode ? `${me.markLabel} işaretleme modu` : '';

    let markBar;
    if (state.markMode) {
      const hint = state.markMode === 'period'
        ? '🩸 Regl günlerine dokunarak ekle/kaldır'
        : `${esc(me.markIcon)} Günlere dokunarak ekle/kaldır · bu ay ${myMarksThisMonth} gün`;
      markBar = `<div class="mark-bar"><button class="chip on" data-act="markdone">✓ Bitti</button><span class="mark-hint">${hint}</span></div>`;
    } else {
      markBar = `<div class="mark-bar">
        <button class="chip" data-act="markmode">${esc(me.markIcon)} ${esc(me.markLabel)} günlerimi işaretle</button>
        ${cycleIsMine() ? '<button class="chip" data-act="periodmode">🩸 Regl günleri</button>' : ''}
        ${cycleCanSee() ? `<button class="chip${state.cycle.layer ? ' on' : ''}" data-act="cyclelayer">🌸 Döngü</button>` : ''}
      </div>`;
    }
    const legend = `<div class="legend">
      <span><i class="sw" style="background:${COLORS.a}"></i>${esc(MEMBERS.a.markIcon)} ${esc(MEMBERS.a.markLabel)} (${esc(nameOf('a'))})</span>
      <span><i class="sw" style="background:${COLORS.b}"></i>${esc(MEMBERS.b.markIcon)} ${esc(MEMBERS.b.markLabel)} (${esc(nameOf('b'))})</span>
      ${cycleLayerOn() ? `<span><i class="lg cy-period"></i>Regl</span><span><i class="lg cy-pred"></i>Tahmini regl</span>
        <span><i class="lg cy-fertile"></i>Doğurgan</span><span><i class="lg cy-ovu"></i>Yumurtlama</span>` : ''}
    </div>`;

    // seçili gün detayı: işaretler + görevler
    const dayMarks = marksOn(state.selDay);
    let markRows = dayMarks.filter((m) => MEMBERS[m.owner]).map((m) => {
      const mem = MEMBERS[m.owner];
      return `<div class="mark-row" style="--c:${COLORS[m.owner]}"><span class="ico">${esc(mem.markIcon)}</span>
        <span class="grow"><b>${esc(mem.markLabel)}</b> · ${esc(nameOf(m.owner))}</span>
        <button class="link-btn" data-unmark="${esc(m.id)}">Kaldır</button></div>`;
    }).join('');
    if (!dayMarks.some((m) => m.owner === state.me)) {
      markRows += `<div class="mark-row" style="--c:${COLORS[state.me]}"><span class="ico">${esc(me.markIcon)}</span>
        <span class="grow" style="color:var(--muted)">Bu gün ${esc(me.markLabel.toLocaleLowerCase('tr-TR'))} yok</span>
        <button class="link-btn" data-mark="${state.selDay}">+ ${esc(me.markLabel)} ekle</button></div>`;
    }
    const dayTasks = (byDay[state.selDay] || []);
    const selWx = weatherOn(state.selDay);

    $('#main').innerHTML = `
      <div class="cal-head">
        <button class="icon-btn" data-cal="-1" aria-label="Önceki ay">‹</button>
        <h2>${esc(monthName)}</h2>
        <button class="chip" data-cal="today">Bugün</button>
        <button class="icon-btn" data-cal="1" aria-label="Sonraki ay">›</button>
      </div>
      ${markBar}
      <div class="cal${state.markMode ? ' marking' : ''}">${wds}${cells}</div>
      ${legend}
      <div class="section"><div class="section-head"><span>${esc(fmtLong(state.selDay))}</span>${selWx ? `<span class="wx-head">${wmo(selWx.code)[0]} ${deg(selWx.max)} / ${deg(selWx.min)}${selWx.rain != null ? ` · 💧%${selWx.rain}` : ''}</span>` : ''}</div><div class="card">${markRows}</div></div>
      ${cycleDayHtml(state.selDay)}
      ${taskSection('Görevler', dayTasks, { keepEmpty: true, showDate: false, emptyText: 'Bu güne görev yok.' })}`;
  }

  async function toggleMark(date, owner = state.me) {
    const id = markId(date, owner);
    const exists = state.marks.some((m) => m.id === id);
    try {
      if (exists) await store.remove('marks', id);
      else await store.set('marks', id, { date, owner, label: MEMBERS[owner].markLabel });
    } catch (e) { toast('İşaretlenemedi: ' + (e.code || e.message)); }
  }

  // ---------------------------------------------------------------- Market
  function shopRow(s) {
    const c = ownerColor(s.addedBy);
    const meta = [];
    if (s.qty) meta.push(`<span>${esc(s.qty)}</span>`);
    meta.push(`<span class="owner-tag"><i class="dot" style="background:${c}"></i>${esc(nameOf(s.addedBy))} ekledi</span>`);
    if (s.bought && s.boughtBy && MEMBERS[s.boughtBy]) meta.push(`<span>✓ ${esc(s.boughtBy === state.me ? 'sen aldın' : MEMBERS[s.boughtBy].name + ' aldı')}</span>`);
    return `<div class="task${s.bought ? ' done' : ''}" data-sid="${esc(s.id)}" style="--c:${c}">
      <button class="check" data-sact="buy" aria-label="${s.bought ? 'Listeye geri al' : 'Alındı'}">${s.bought ? '✓' : ''}</button>
      <div class="task-body"><span class="task-title">${esc(s.name)}</span><span class="task-meta">${meta.join('')}</span></div>
      ${s.bought ? '' : `<button class="mini${s.urgent ? ' on' : ''}" data-sact="urgent" title="${s.urgent ? 'Normal listeye taşı' : 'Hemen alınacaklara taşı'}">⚡</button>`}
      <button class="mini" data-sact="del" aria-label="Sil">✕</button>
    </div>`;
  }

  function marketHtml() {
    const open = state.shopping.filter((s) => !s.bought).sort((x, y) => toMs(x.createdAt) - toMs(y.createdAt));
    const urgent = open.filter((s) => s.urgent);
    const normal = open.filter((s) => !s.urgent);
    const bought = state.shopping.filter((s) => s.bought).sort((x, y) => (y.boughtAt || 0) - (x.boughtAt || 0)).slice(0, 20);

    $('#view-title').textContent = 'Market';
    $('#view-sub').textContent = open.length ? `${open.length} ürün alınacak` : 'Liste boş';

    let html = `<form id="shop-add" class="shop-add" autocomplete="off">
      <input id="shop-name" class="input" placeholder="Ne alınacak? (ör. 2 ekmek)" maxlength="120" enterkeyhint="done">
      <input id="shop-qty" class="input" placeholder="Miktar" maxlength="20">
      <button type="button" id="shop-urgent" class="urgent-toggle${state.shopUrgent ? ' on' : ''}" aria-pressed="${state.shopUrgent}">⚡ Hemen</button>
      <button type="submit" class="btn primary">Ekle</button>
    </form>`;
    html += section(`⚡ Hemen alınacaklar <span class="count">${urgent.length}</span>`, urgent.map(shopRow).join(''), { keepEmpty: true, emptyText: 'Acil bir şey yok 🎉' });
    html += section(`🛒 Alınması gerekenler <span class="count">${normal.length}</span>`, normal.map(shopRow).join(''), { keepEmpty: true, emptyText: 'Liste boş. Yukarıdan ekleyin.' });
    if (bought.length) {
      html += section('✓ Alındı', bought.map(shopRow).join(''), { right: '<button class="link-btn" data-act="clearbought">Temizle</button>' });
    }
    return html;
  }

  async function addShopping(rawName, qty, urgent) {
    let name = rawName.trim();
    if (!name) return;
    if (!qty) {
      const m = name.match(/^(\d+(?:[.,]\d+)?\s*(?:kg|g|gr|lt|l|ml|adet|paket|kutu|şişe)?)\s+(.+)$/i);
      if (m) { qty = m[1]; name = m[2]; }
    }
    await store.add('shopping', { name, qty: qty || '', urgent: !!urgent, bought: false, boughtBy: null, boughtAt: null, addedBy: state.me });
  }

  // ---------------------------------------------------------------- Sohbet
  function msgHtml(m) {
    const kind = m.from === 'ai' ? 'ai' : m.from === state.me ? 'me' : 'them';
    const who = kind === 'ai' ? `✨ Asistan${m.askedBy && MEMBERS[m.askedBy] ? ' · ' + esc(nameOf(m.askedBy)) + ' sordu' : ''}` : kind === 'them' ? esc(MEMBERS[m.from]?.name || '?') : '';
    const acts = (m.actions || []).length ? `<div class="acts">${m.actions.map((a) => `<span class="act">${esc(a)}</span>`).join('')}</div>` : '';
    const srcs = (m.sources || []).length ? `<div class="sources">${m.sources.slice(0, 6).map((s) => `<a href="${esc(safeUrl(s.uri))}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join('')}</div>` : '';
    const ms = toMs(m.createdAt);
    return `<div class="msg ${kind}" style="--c:${COLORS[m.from] || COLORS.both}">
      ${who ? `<span class="who-l">${who}</span>` : ''}
      <div class="bubble">${richText(m.text)}${acts}${srcs}</div>
      ${ms ? `<span class="time">${hhmm(ms)}</span>` : ''}
    </div>`;
  }

  function renderChat() {
    const o = other();
    $('#view-title').textContent = 'Sohbet';
    $('#view-sub').textContent = `Sen & ${MEMBERS[o].name}`;
    const msgs = state.messages;
    let html = '<div class="chat">';
    if (!msgs.length) {
      html += '<div class="empty">Henüz mesaj yok. İlk mesajı yaz 💌</div>';
    }
    let lastDay = '';
    for (const m of msgs) {
      const ms = toMs(m.createdAt);
      const d = ms ? ymd(new Date(ms)) : '';
      if (d && d !== lastDay) { html += `<span class="day-sep">${esc(relDay(d))}</span>`; lastDay = d; }
      html += msgHtml(m);
    }
    html += '</div>';
    $('#main').innerHTML = html;
    markChatSeen();
  }

  function markChatSeen() {
    const last = state.messages.reduce((mx, m) => Math.max(mx, toMs(m.createdAt)), 0);
    if (last > state.chatSeen) { state.chatSeen = last; lsSet('cift-ajanda:chatSeen', String(last)); }
  }
  function scrollChat(force) {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 220;
    if (force || nearBottom) window.scrollTo(0, document.body.scrollHeight);
  }
  function updateBadges() {
    const unread = state.view === 'chat' ? 0 : state.messages.filter((m) => m.from !== state.me && toMs(m.createdAt) > state.chatSeen).length;
    const bc = $('#badge-chat');
    bc.hidden = !unread; bc.textContent = unread > 9 ? '9+' : String(unread);
    const urgent = state.shopping.filter((s) => !s.bought && s.urgent).length;
    const bm = $('#badge-market');
    bm.hidden = !urgent; bm.textContent = String(urgent);
  }

  async function sendChat() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = ''; autoGrow();
    try { await store.add('messages', { text, from: state.me }); }
    catch (e) { toast('Gönderilemedi: ' + (e.code || e.message)); input.value = text; return; }
    scrollChat(true);
  }
  function autoGrow() {
    const el = $('#chat-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // ---------------------------------------------------------------- Hava durumu (Open-Meteo)
  // Ücretsiz, anahtarsız. Konum her cihazda ayrı saklanır (ikiniz farklı yerde olabilirsiniz).
  const WX_KEY = 'cift-ajanda:weather';
  const WX_TTL = 30 * 60 * 1000;
  const WMO = {
    0: ['☀️', 'Açık'], 1: ['🌤️', 'Az bulutlu'], 2: ['⛅', 'Parçalı bulutlu'], 3: ['☁️', 'Kapalı'],
    45: ['🌫️', 'Sisli'], 48: ['🌫️', 'Kırağılı sis'],
    51: ['🌦️', 'Hafif çisenti'], 53: ['🌦️', 'Çisenti'], 55: ['🌦️', 'Yoğun çisenti'],
    56: ['🌧️', 'Donan çisenti'], 57: ['🌧️', 'Donan çisenti'],
    61: ['🌧️', 'Hafif yağmur'], 63: ['🌧️', 'Yağmurlu'], 65: ['🌧️', 'Şiddetli yağmur'],
    66: ['🌧️', 'Donan yağmur'], 67: ['🌧️', 'Donan yağmur'],
    71: ['🌨️', 'Hafif kar'], 73: ['🌨️', 'Karlı'], 75: ['❄️', 'Yoğun kar'], 77: ['🌨️', 'Kar taneleri'],
    80: ['🌦️', 'Hafif sağanak'], 81: ['🌦️', 'Sağanak'], 82: ['⛈️', 'Şiddetli sağanak'],
    85: ['🌨️', 'Kar sağanağı'], 86: ['🌨️', 'Yoğun kar sağanağı'],
    95: ['⛈️', 'Gök gürültülü fırtına'], 96: ['⛈️', 'Dolulu fırtına'], 99: ['⛈️', 'Dolulu fırtına'],
  };
  const wmo = (c, night) => {
    const w = WMO[c] || ['🌡️', ''];
    if (night && (c === 0 || c === 1)) return [c === 0 ? '🌙' : '☁️', w[1]];
    return w;
  };
  const deg = (n) => (n == null || isNaN(n) ? '–' : `${Math.round(n)}°`);

  function loadWeatherCache() {
    try { state.weather = JSON.parse(lsGet(WX_KEY)) || null; } catch { state.weather = null; }
  }
  const saveWeatherCache = () => lsSet(WX_KEY, JSON.stringify(state.weather));

  async function fetchWeather(force = false) {
    const w = state.weather;
    if (!w || !w.loc || state.weatherBusy) return;
    if (!force && w.data && Date.now() - w.at < WX_TTL) return;
    state.weatherBusy = true;
    try {
      const q = new URLSearchParams({
        latitude: w.loc.lat, longitude: w.loc.lon, timezone: 'auto', forecast_days: '16',
        current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset',
      });
      const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const dl = d.daily || {};
      const days = {};
      (dl.time || []).forEach((t, i) => {
        days[t] = {
          code: dl.weather_code[i], max: dl.temperature_2m_max[i], min: dl.temperature_2m_min[i],
          rain: dl.precipitation_probability_max ? dl.precipitation_probability_max[i] : null,
          sunset: ((dl.sunset && dl.sunset[i]) || '').slice(11, 16),
        };
      });
      const c = d.current || {};
      state.weather = {
        loc: w.loc, at: Date.now(),
        data: { now: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, day: c.is_day !== 0, wind: c.wind_speed_10m }, days },
      };
      saveWeatherCache();
    } catch (e) {
      console.warn('Hava durumu alınamadı:', e.message);
      if (force) toast('Hava durumu alınamadı');
    } finally {
      state.weatherBusy = false;
      scheduleRender();
    }
  }

  async function setWeatherCity(name) {
    const q = new URLSearchParams({ name: name.trim(), count: '1', language: 'tr', format: 'json' });
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + q);
    const j = await r.json();
    const g = j.results && j.results[0];
    if (!g) return false;
    const label = g.name + (g.admin1 && g.admin1 !== g.name ? ', ' + g.admin1 : '');
    state.weather = { loc: { name: label, lat: g.latitude, lon: g.longitude }, data: null, at: 0 };
    saveWeatherCache();
    await fetchWeather(true);
    return true;
  }

  function useMyLocation() {
    if (!navigator.geolocation) { toast('Bu cihaz konum vermiyor; şehir seçin'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.weather = { loc: { name: 'Konumum', lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), gps: true }, data: null, at: 0 };
        saveWeatherCache();
        if ($('#settings').open) $('#w-status').textContent = '✓ Konumun kullanılıyor';
        fetchWeather(true);
      },
      () => toast('Konum izni verilmedi; Ayarlar\'dan şehir seçebilirsiniz'),
      { timeout: 10000, maximumAge: 3600000 }
    );
  }

  function initWeather() {
    loadWeatherCache();
    if (!state.weather && CFG.weatherCity) setWeatherCity(CFG.weatherCity).catch(() => {});
    else fetchWeather();
  }

  const weatherOn = (d) => (state.weather && state.weather.data && state.weather.data.days[d]) || null;

  function weatherCardHtml() {
    const w = state.weather;
    if (!w || !w.loc) {
      return `<div class="wx-card wx-empty"><b>🌤️ Hava durumu</b><p>Bulunduğun yerin havasını görmek için konum ver ya da şehir seç.</p>
        <div class="row"><button class="btn primary" data-act="wx-gps">📍 Konumumu kullan</button><button class="btn ghost" data-act="settings">🏙️ Şehir seç</button></div></div>`;
    }
    if (!w.data || !w.data.now) {
      return `<div class="wx-card"><p class="mark-hint">${state.weatherBusy ? 'Hava durumu yükleniyor…' : 'Hava durumu alınamadı. İnternet bağlantısını kontrol edin.'}</p></div>`;
    }
    const t = today();
    const n = w.data.now;
    const td = w.data.days[t] || {};
    const [ico, desc] = wmo(n.code, !n.day);
    let tip = '';
    if ((td.rain || 0) >= 50) tip = '☂️ Yağış ihtimali yüksek, şemsiye almayı unutmayın';
    else if (td.max >= 32) tip = '🥵 Çok sıcak, bol su için';
    else if (td.min <= 0) tip = '🧣 Ayaz var, sıkı giyinin';
    let strip = '';
    for (let i = 1; i <= 6; i++) {
      const d = addDays(t, i);
      const x = w.data.days[d];
      if (!x) continue;
      strip += `<div class="wx-day"><span>${esc(parseYmd(d).toLocaleDateString('tr-TR', { weekday: 'short' }))}</span><span class="wx-i">${wmo(x.code)[0]}</span><b>${deg(x.max)}</b><small>${deg(x.min)}</small></div>`;
    }
    return `<div class="wx-card">
      <div class="wx-now">
        <span class="wx-big">${ico}</span>
        <div class="grow"><div class="wx-temp">${deg(n.temp)}</div><div class="wx-desc">${esc(desc)} · Hissedilen ${deg(n.feels)}</div></div>
        <div class="wx-side"><button class="link-btn" data-act="settings">📍 ${esc(w.loc.name)}</button>
          <div>↑${deg(td.max)} ↓${deg(td.min)}${td.rain != null ? ` · 💧%${td.rain}` : ''}</div>
          <div class="mark-hint">💨 ${Math.round(n.wind || 0)} km/s${td.sunset ? ` · 🌇 ${td.sunset}` : ''}</div></div>
      </div>
      ${tip ? `<div class="wx-tip">${tip}</div>` : ''}
      <div class="wx-strip">${strip}</div>
    </div>`;
  }

  // ---------------------------------------------------------------- Ayarlar
  function setStatus(msg, cls = '') { const el = $('#s-status'); el.textContent = msg; el.className = 'hint ' + cls; }

  function openSettings() {
    setStatus('');
    renderNotifySettings();
    $('#b-limit').value = state.budgetLimit || '';
    const loc = state.weather && state.weather.loc;
    $('#w-city').value = loc && !loc.gps ? loc.name.split(',')[0] : '';
    $('#w-status').textContent = loc ? `Şu an: ${loc.name}` : 'Konum seçilmedi';
    $('#n-a').value = MEMBERS.a.name;
    $('#n-b').value = MEMBERS.b.name;
    $('#n-a-lbl').textContent = `${MEMBERS.a.markIcon} ${MEMBERS.a.email || 'Kişi 1'}`;
    $('#n-b-lbl').textContent = `${MEMBERS.b.markIcon} ${MEMBERS.b.email || 'Kişi 2'}`;
    $('#cycle-set').hidden = !cycleIsMine();
    if (cycleIsMine()) {
      const s = state.cycle.settings || {};
      const c = computeCycle();
      $('#c-share').checked = !!s.share;
      $('#c-len').value = s.cycleLen || 28;
      $('#c-plen').value = s.periodLen || 5;
      $('#c-learn').textContent = c.learned
        ? `Kayıtlarından hesaplanan: döngü ${c.cycleLen} gün, regl ${c.periodLen} gün (son ${c.learned} döngü). Tahminlerde bunlar kullanılır.`
        : 'En az iki regl başlangıcı kaydedince süreler kayıtlarından otomatik hesaplanır.';
    }
    $('#settings').showModal();
  }
  async function searchCity() {
    const name = $('#w-city').value;
    if (!name.trim()) { $('#w-city').focus(); return; }
    $('#w-status').textContent = 'Aranıyor…';
    try {
      const ok = await setWeatherCity(name);
      $('#w-status').textContent = ok ? `✓ ${state.weather.loc.name}` : 'Şehir bulunamadı, farklı yazmayı deneyin';
    } catch { $('#w-status').textContent = 'Bağlantı hatası'; }
  }
  async function saveSettings() {
    try {
      if (cycleIsMine()) {
        await store.set('cycleSettings', CYCLE_OWNER, {
          share: $('#c-share').checked,
          cycleLen: clamp(Number($('#c-len').value) || 28, 20, 45),
          periodLen: clamp(Number($('#c-plen').value) || 5, 2, 10),
        });
      }
      const lim = Math.max(0, Math.round(Number($('#b-limit').value) || 0));
      if (lim !== (Number(state.budgetLimit) || 0)) await store.set('settings', 'budget', { limit: lim });
      const na = $('#n-a').value.trim().slice(0, 30);
      const nb = $('#n-b').value.trim().slice(0, 30);
      if (na !== MEMBERS.a.name || nb !== MEMBERS.b.name) {
        await store.set('settings', 'profile', { names: { a: na || CONFIG_NAMES.a, b: nb || CONFIG_NAMES.b } });
      }
      $('#settings').close();
      toast('Kaydedildi');
    } catch (e) { setStatus('Kaydedilemedi: ' + (e.code || e.message), 'err'); }
  }

  // ---------------------------------------------------------------- Listeler sekmesi (Market + Pano)
  const LIST_TABS = [['market', '🛒', 'Market'], ['watch', '🎬', 'İzlenecek'], ['wish', '🎁', 'İstek'], ['trip', '✈️', 'Tatil']];
  const BOARD = {
    watch: { icon: '🎬', title: 'İzlenecekler', add: 'Ne izleyelim? (film, dizi…)', done: 'İzledik', doneTitle: 'İzlediklerimiz',
      tags: ['Film', 'Dizi', 'Belgesel', 'Animasyon'], price: false, defOwner: 'both', empty: 'Birlikte izlemek istediğiniz film ve dizileri ekleyin 🍿' },
    wish: { icon: '🎁', title: 'İstek listesi', add: 'Ne istiyorsun?', done: 'Alındı', doneTitle: 'Gerçekleşenler',
      tags: ['Ev', 'Giyim', 'Teknoloji', 'Kitap', 'Deneyim', 'Diğer'], price: true, defOwner: 'me', empty: 'İstediklerinizi ekleyin; hediye fikri arayan için hazine 🎁' },
    trip: { icon: '✈️', title: 'Tatil hayalleri', add: 'Nereye gidelim?', done: 'Gittik', doneTitle: 'Gittiğimiz yerler',
      tags: ['Yurt içi', 'Yurt dışı', 'Hafta sonu', 'Doğa', 'Şehir'], price: true, defOwner: 'both', empty: 'Hayal ettiğiniz yerleri ekleyin ✈️' },
  };

  function listSegHtml() {
    const openShop = state.shopping.filter((s) => !s.bought).length;
    return `<div class="list-seg">${LIST_TABS.map(([k, ic, label]) => {
      const n = k === 'market' ? openShop : state.board.filter((b) => b.type === k && !b.done).length;
      return `<button class="${state.listTab === k ? 'on' : ''}" data-list="${k}"><span>${ic}</span>${label}${n ? `<i>${n}</i>` : ''}</button>`;
    }).join('')}</div>`;
  }

  function renderLists() {
    let body;
    if (state.listTab === 'market') body = marketHtml();
    else body = boardHtml(state.listTab);
    $('#main').innerHTML = listSegHtml() + body;
  }

  function boardRow(b) {
    const cfg = BOARD[b.type];
    const owner = b.owner || BOTH;
    const c = ownerColor(owner);
    const meta = [];
    if (b.tag) meta.push(`<span>${esc(b.tag)}</span>`);
    meta.push(`<span class="owner-tag"><i class="dot" style="background:${c}"></i>${esc(b.type === 'wish' && owner !== BOTH ? nameOf(owner) + (owner === state.me ? ' istiyorum' : ' istiyor') : ownerLabel(owner))}</span>`);
    if (b.price) meta.push(`<span>${esc(money(b.price))}</span>`);
    if (b.note) meta.push('<span title="Not var">📝</span>');
    if (b.done) meta.push(`<span>✓ ${esc(cfg.done)}${b.doneAt ? ' · ' + esc(new Date(b.doneAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })) : ''}</span>`);
    return `<div class="task${b.done ? ' done' : ''}${state.boardPick === b.id ? ' pick' : ''}" data-bid="${esc(b.id)}" style="--c:${c}">
      <button class="check" data-bact="done" aria-label="${b.done ? 'Geri al' : esc(cfg.done)}">${b.done ? '✓' : ''}</button>
      <button class="task-body" data-bact="edit"><span class="task-title">${esc(b.title)}</span><span class="task-meta">${meta.join('')}</span></button>
      ${b.link ? `<a class="mini" href="${esc(safeUrl(b.link))}" target="_blank" rel="noopener" aria-label="Bağlantıyı aç">🔗</a>` : ''}
    </div>`;
  }

  function boardHtml(type) {
    const cfg = BOARD[type];
    const items = state.board.filter((b) => b.type === type);
    const open = items.filter((b) => !b.done).sort((x, y) => toMs(y.createdAt) - toMs(x.createdAt));
    const done = items.filter((b) => b.done).sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0));
    $('#view-title').textContent = cfg.title;
    $('#view-sub').textContent = open.length ? `${open.length} kayıt` : '';
    let html = `<form id="board-add" class="shop-add" autocomplete="off">
      <input id="board-title" class="input" placeholder="${esc(cfg.add)}" maxlength="200" enterkeyhint="done">
      <select id="board-tag" class="input tagsel" aria-label="Tür"><option value="">Tür</option>${cfg.tags.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
      <button type="submit" class="btn primary">Ekle</button>
    </form>`;
    if (type === 'watch' && open.length > 1) html += '<div class="toggle-row"><span></span><button class="chip" data-act="pick">🎲 Bu akşam ne izlesek?</button></div>';
    let right = '';
    if (cfg.price) {
      const sum = open.reduce((s, b) => s + (Number(b.price) || 0), 0);
      if (sum) right = `≈ ${esc(money(sum))}`;
    }
    html += section(`${cfg.icon} ${cfg.title} <span class="count">${open.length}</span>`, open.map(boardRow).join(''), { keepEmpty: true, emptyText: cfg.empty, right });
    if (done.length) html += section(`✓ ${cfg.doneTitle}`, done.map(boardRow).join(''));
    return html;
  }

  async function addBoard(type, title, tag) {
    const cfg = BOARD[type];
    await store.add('board', {
      type, title: title.trim().slice(0, 200), tag: tag || '', owner: cfg.defOwner === 'me' ? state.me : BOTH,
      note: '', link: '', price: null, done: false, doneAt: null, addedBy: state.me,
    });
  }

  // Pano düzenleme formu
  let boardForm = { id: null, owner: BOTH, tag: '' };
  function renderBoardSeg() {
    const o = other();
    $('#bf-owner').innerHTML = [[state.me, 'Ben'], [o, MEMBERS[o].name], [BOTH, 'İkimiz']].map(([k, l]) =>
      `<button type="button" class="${boardForm.owner === k ? 'on' : ''}" data-bowner="${k}"><i class="dot" style="background:${ownerColor(k)}"></i>${esc(l)}</button>`).join('');
    const cfg = BOARD[boardForm.type];
    $('#bf-tags').innerHTML = cfg.tags.map((t) => `<button type="button" class="chip${boardForm.tag === t ? ' on' : ''}" data-btag="${esc(t)}">${esc(t)}</button>`).join('');
  }
  function openBoardSheet(b) {
    const cfg = BOARD[b.type];
    boardForm = { id: b.id, type: b.type, owner: b.owner || BOTH, tag: b.tag || '' };
    $('#bf-head').textContent = `${cfg.icon} ${cfg.title}`;
    $('#bf-title').value = b.title;
    $('#bf-price-wrap').hidden = !cfg.price;
    $('#bf-price').value = b.price || '';
    $('#bf-link').value = b.link || '';
    $('#bf-note').value = b.note || '';
    $('#bf-owner-lbl').textContent = b.type === 'wish' ? 'Kimin isteği?' : 'Kimin için?';
    renderBoardSeg();
    $('#board-sheet').showModal();
  }
  async function saveBoardSheet() {
    const title = $('#bf-title').value.trim();
    if (!title) { $('#bf-title').focus(); return; }
    const price = parseMoney($('#bf-price').value);
    const link = $('#bf-link').value.trim();
    const data = {
      title: title.slice(0, 200), tag: boardForm.tag, owner: boardForm.owner, note: $('#bf-note').value.trim().slice(0, 2000),
      link: link && !/^https?:\/\//i.test(link) ? 'https://' + link : link, price: price || null,
    };
    $('#board-sheet').close();
    try { await store.update('board', boardForm.id, data); toast('Kaydedildi'); }
    catch (e) { toast('Kaydedilemedi: ' + (e.code || e.message)); }
  }

  // ---------------------------------------------------------------- Bütçe
  const CATS = [
    ['market', '🛒', 'Market'], ['fatura', '💡', 'Fatura'], ['kira', '🏠', 'Kira / aidat'], ['ulasim', '🚗', 'Ulaşım'],
    ['disari', '🍽️', 'Dışarıda yemek'], ['saglik', '💊', 'Sağlık'], ['giyim', '👕', 'Giyim'], ['eglence', '🎬', 'Eğlence'],
    ['ev', '🛋️', 'Ev'], ['hediye', '🎁', 'Hediye'], ['tatil', '✈️', 'Tatil'], ['diger', '📦', 'Diğer'],
  ];
  const catOf = (id) => CATS.find((c) => c[0] === id) || CATS[CATS.length - 1];
  function money(n) {
    n = Number(n) || 0;
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  }
  function parseMoney(v) {
    const s = String(v || '').trim().replace(/\s|₺|tl/gi, '');
    if (!s) return 0;
    // Türkçe biçim: "1.250,50" → 1250.50 · "4.500" → 4500 · "1,5" → 1.5 · "12.5" → 12.5
    let norm;
    if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, '');
    else norm = s;
    const n = Math.round(parseFloat(norm) * 100) / 100;
    return isFinite(n) && n > 0 ? n : 0;
  }
  const isSettle = (x) => x.kind === 'settle';

  // > 0 ise b, a'ya borçlu; < 0 ise a, b'ye borçlu
  function balance() {
    let net = 0;
    for (const x of state.expenses) {
      const A = Number(x.amount) || 0;
      const p = x.paidBy;
      if (p !== 'a' && p !== 'b') continue;
      let credit = 0;
      if (isSettle(x) || x.split === (p === 'a' ? 'b' : 'a')) credit = A;
      else if (x.split === BOTH) credit = A / 2;
      net += p === 'a' ? credit : -credit;
    }
    return Math.round(net * 100) / 100;
  }

  function expRow(x) {
    const c = ownerColor(x.paidBy);
    if (isSettle(x)) {
      return `<div class="task exp" data-eid="${esc(x.id)}" style="--c:${c}"><span class="cat-ico">🤝</span>
        <button class="task-body" data-eact="edit"><span class="task-title">Hesaplaşma</span><span class="task-meta"><span>${esc(nameOf(x.paidBy))} → ${esc(nameOf(x.split))}</span></span></button>
        <span class="amt muted">${esc(money(x.amount))}</span></div>`;
    }
    const [, ic, label] = catOf(x.category);
    const split = x.split === BOTH ? 'ortak' : x.split === x.paidBy ? 'kişisel' : `${nameOf(x.split)} için`;
    return `<div class="task exp" data-eid="${esc(x.id)}" style="--c:${c}"><span class="cat-ico">${ic}</span>
      <button class="task-body" data-eact="edit"><span class="task-title">${esc(x.note || label)}</span>
        <span class="task-meta"><span class="owner-tag"><i class="dot" style="background:${c}"></i>${esc(nameOf(x.paidBy))} ödedi</span><span>${esc(split)}</span>${x.note ? `<span>${esc(label)}</span>` : ''}</span></button>
      <span class="amt">${esc(money(x.amount))}</span></div>`;
  }

  function renderBudget() {
    const m = state.budgetMonth;
    const monthName = parseYmd(m + '-01').toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    const all = state.expenses.filter((x) => (x.date || '').startsWith(m)).sort((x, y) => (y.date || '').localeCompare(x.date || '') || toMs(y.createdAt) - toMs(x.createdAt));
    const spend = all.filter((x) => !isSettle(x));
    const total = spend.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const byCat = {};
    const byPayer = { a: 0, b: 0 };
    for (const x of spend) {
      byCat[x.category] = (byCat[x.category] || 0) + (Number(x.amount) || 0);
      if (byPayer[x.paidBy] != null) byPayer[x.paidBy] += Number(x.amount) || 0;
    }
    const limit = Number(state.budgetLimit) || 0;
    const isThisMonth = m === today().slice(0, 7);
    const daysIn = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
    const dayNo = isThisMonth ? +today().slice(8, 10) : daysIn;

    $('#view-title').textContent = 'Bütçe';
    $('#view-sub').textContent = `${monthName} · ${spend.length} harcama`;

    let html = `<div class="cal-head">
      <button class="icon-btn" data-bm="-1" aria-label="Önceki ay">‹</button>
      <h2>${esc(monthName)}</h2>
      ${isThisMonth ? '' : '<button class="chip" data-bm="0">Bu ay</button>'}
      <button class="icon-btn" data-bm="1" aria-label="Sonraki ay">›</button>
    </div>`;

    // özet
    let limitHtml = '';
    if (limit) {
      const pct = Math.min(100, Math.round((total / limit) * 100));
      const left = limit - total;
      const expected = isThisMonth ? (limit * dayNo) / daysIn : limit;
      const warn = total > limit ? 'over' : total > expected * 1.1 ? 'warn' : '';
      limitHtml = `<div class="bd-limit ${warn}"><div class="progress"><i style="width:${pct}%"></i></div>
        <span>${left >= 0 ? `Limitten ${esc(money(left))} kaldı` : `Limit ${esc(money(-left))} aşıldı`} · %${pct}</span></div>`;
    }
    html += `<div class="bd-card">
      <div class="bd-total"><small>Toplam harcama</small><b>${esc(money(total))}</b>${limit ? `<small>/ ${esc(money(limit))}</small>` : ''}</div>
      ${limitHtml}
      <div class="bd-row">
        <span><i class="dot" style="background:${COLORS.a}"></i>${esc(nameOf('a'))}: ${esc(money(byPayer.a))}</span>
        <span><i class="dot" style="background:${COLORS.b}"></i>${esc(nameOf('b'))}: ${esc(money(byPayer.b))}</span>
        ${spend.length ? `<span>Günlük ort. ${esc(money(Math.round(total / Math.max(1, dayNo))))}</span>` : ''}
      </div>
    </div>`;

    // hesap durumu (tüm zamanlar)
    const net = balance();
    if (Math.abs(net) < 1) {
      html += '<div class="bd-balance ok">🤝 Hesaplar denk</div>';
    } else {
      const debtor = net > 0 ? 'b' : 'a';
      const creditor = debtor === 'a' ? 'b' : 'a';
      html += `<div class="bd-balance">
        <div><small>Hesap durumu</small><div><b>${esc(nameOf(debtor))}</b> → <b>${esc(nameOf(creditor))}</b> <span class="amt">${esc(money(Math.abs(net)))}</span></div>
        <small>Ortak harcamalar yarı yarıya bölünür</small></div>
        <button class="btn ghost" data-act="settle" data-debtor="${debtor}" data-amt="${Math.abs(net)}">🤝 Hesaplaştık</button>
      </div>`;
    }

    // kategoriler
    const cats = Object.entries(byCat).sort((x, y) => y[1] - x[1]);
    if (cats.length) {
      const max = cats[0][1];
      html += section('Kategoriler', `<div class="bd-cats">${cats.map(([k, v]) => {
        const [, ic, label] = catOf(k);
        return `<div class="bd-cat"><span>${ic} ${esc(label)}</span><div class="bar"><i style="width:${Math.max(3, Math.round((v / max) * 100))}%"></i></div><b>${esc(money(v))}</b><small>%${total ? Math.round((v / total) * 100) : 0}</small></div>`;
      }).join('')}</div>`);
    }

    // harcamalar
    if (!all.length) {
      html += section('Harcamalar', '', { keepEmpty: true, emptyText: 'Bu ay harcama yok. + ile ekleyin.' });
    } else {
      const groups = new Map();
      for (const x of all) { if (!groups.has(x.date)) groups.set(x.date, []); groups.get(x.date).push(x); }
      for (const [d, xs] of groups) {
        const sum = xs.filter((x) => !isSettle(x)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
        html += section(esc(`${relDay(d)}${[today(), addDays(today(), -1)].includes(d) ? ' · ' + fmtShort(d) : ''}`), xs.map(expRow).join(''), { right: sum ? esc(money(sum)) : '' });
      }
    }
    $('#main').innerHTML = html;
  }

  // Harcama formu
  let expForm = { id: null, cat: 'market', paidBy: 'a', split: BOTH };
  function renderExpSegs() {
    const o = other();
    $('#ef-cats').innerHTML = CATS.map(([k, ic, l]) => `<button type="button" class="cat-chip${expForm.cat === k ? ' on' : ''}" data-ecat="${k}"><span>${ic}</span>${esc(l)}</button>`).join('');
    $('#ef-paid').innerHTML = [[state.me, 'Ben'], [o, MEMBERS[o].name]].map(([k, l]) =>
      `<button type="button" class="${expForm.paidBy === k ? 'on' : ''}" data-epaid="${k}"><i class="dot" style="background:${ownerColor(k)}"></i>${esc(l)}</button>`).join('');
    $('#ef-split').innerHTML = [[BOTH, 'Ortak'], [state.me, 'Benim için'], [o, `${MEMBERS[o].name} için`]].map(([k, l]) =>
      `<button type="button" class="${expForm.split === k ? 'on' : ''}" data-esplit="${k}">${esc(l)}</button>`).join('');
  }
  function openExpense(x) {
    if (x && isSettle(x)) {
      if (confirm(`Bu hesaplaşma kaydı (${money(x.amount)}) silinsin mi?`)) store.remove('expenses', x.id).catch((e) => toast(e.message));
      return;
    }
    expForm = { id: x ? x.id : null, cat: x ? x.category : 'market', paidBy: x ? x.paidBy : state.me, split: x ? x.split : BOTH };
    $('#ef-head').textContent = x ? 'Harcamayı düzenle' : 'Yeni harcama';
    $('#ef-amount').value = x ? String(x.amount).replace('.', ',') : '';
    $('#ef-date').value = x ? x.date : (state.budgetMonth === today().slice(0, 7) ? today() : state.budgetMonth + '-01');
    $('#ef-note').value = x ? x.note || '' : '';
    $('#ef-delete').hidden = !x;
    renderExpSegs();
    $('#exp-sheet').showModal();
    if (!x) setTimeout(() => $('#ef-amount').focus(), 50);
  }
  async function saveExpense() {
    const amount = parseMoney($('#ef-amount').value);
    if (!amount) { toast('Tutarı girin'); $('#ef-amount').focus(); return; }
    const date = $('#ef-date').value || today();
    const data = { amount, category: expForm.cat, date, paidBy: expForm.paidBy, split: expForm.split, note: $('#ef-note').value.trim().slice(0, 200) };
    const id = expForm.id;
    $('#exp-sheet').close();
    try {
      if (id) await store.update('expenses', id, data);
      else await store.add('expenses', { ...data, kind: 'expense', addedBy: state.me });
      state.budgetMonth = date.slice(0, 7);
      toast(id ? 'Güncellendi' : `${money(amount)} eklendi`);
    } catch (e) { toast('Kaydedilemedi: ' + (e.code || e.message)); }
  }

  // ---------------------------------------------------------------- Bildirimler (Firebase Cloud Messaging)
  const NOTIFY_DEFAULTS = { chat: true, tasks: true, reminders: true, morning: true, shopping: true, board: true, expenses: false };
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let messaging = null;
  let swReg = null;

  let unPrefs = null;
  function watchPrefs() {
    if (unPrefs) unPrefs();
    unPrefs = store.watchDoc('notifyPrefs', state.me, (d) => {
      state.notifyPrefs = { ...NOTIFY_DEFAULTS, ...(d || {}) };
      if ($('#settings').open) renderNotifySettings();
    });
  }

  async function ensureMessaging() {
    if (messaging) return messaging;
    await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_VER}/firebase-messaging-compat.js`);
    swReg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
    messaging = firebase.messaging();
    messaging.onMessage((p) => {
      const n = p.notification || {};
      if (n.title) toast(`🔔 ${n.title}${n.body ? ' — ' + n.body : ''}`);
    });
    return messaging;
  }
  async function registerToken() {
    const m = await ensureMessaging();
    const token = await m.getToken({ vapidKey: CFG.vapidKey, serviceWorkerRegistration: swReg });
    if (!token) throw new Error('Bildirim anahtarı alınamadı');
    const prev = lsGet('cift-ajanda:pushToken');
    if (prev && prev !== token) store.remove('pushTokens', prev).catch(() => {});
    lsSet('cift-ajanda:pushToken', token);
    await store.set('pushTokens', token, { owner: state.me, device: navigator.userAgent.slice(0, 160) });
  }
  function pushState() {
    if (store.mode !== 'cloud') return { ok: false, msg: 'Bildirimler sadece Google ile giriş yapılmış modda çalışır.' };
    if (!CFG.vapidKey) return { ok: false, msg: 'Kurulum eksik: config.js içine vapidKey eklenmeli (KURULUM.md).' };
    if (isIOS() && !isStandalone()) return { ok: false, msg: '📱 iPhone\'da bildirim için önce Safari\'de Paylaş → Ana Ekrana Ekle deyip uygulamayı ana ekrandaki ikondan açın.' };
    if (!pushSupported()) return { ok: false, msg: 'Bu tarayıcı bildirim desteklemiyor.' };
    if (Notification.permission === 'denied') return { ok: false, msg: 'Bildirim izni reddedilmiş. Telefon/tarayıcı ayarlarından bu site için bildirimlere izin verin.' };
    const on = lsGet('cift-ajanda:push') === '1' && Notification.permission === 'granted';
    return { ok: true, on, msg: on ? '✓ Bu cihazda bildirimler açık' : 'Bu cihazda bildirimler kapalı' };
  }
  async function enablePush() {
    const st = pushState();
    if (!st.ok) { toast(st.msg); return; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Bildirim izni verilmedi'); renderNotifySettings(); return; }
      $('#push-status').textContent = 'Açılıyor…';
      await registerToken();
      lsSet('cift-ajanda:push', '1');
      toast('🔔 Bildirimler açıldı');
    } catch (e) {
      console.error(e);
      toast('Bildirimler açılamadı: ' + (e.code || e.message));
    }
    renderNotifySettings();
  }
  async function disablePush() {
    const t = lsGet('cift-ajanda:pushToken');
    try {
      if (t) await store.remove('pushTokens', t);
      if (messaging) await messaging.deleteToken();
    } catch (e) { console.warn(e); }
    lsSet('cift-ajanda:push', '0');
    lsSet('cift-ajanda:pushToken', '');
    toast('Bu cihazda bildirimler kapatıldı');
    renderNotifySettings();
  }
  function initPush() {
    // izin daha önce verildiyse anahtarı tazele (tarayıcı zamanla yeniler)
    const st = pushState();
    if (st.ok && st.on) registerToken().catch((e) => console.warn('Bildirim anahtarı yenilenemedi', e));
  }
  function renderNotifySettings() {
    const st = pushState();
    $('#push-status').textContent = st.msg;
    $('#push-status').className = 'hint' + (st.ok && st.on ? ' ok' : '');
    $('#push-btn').hidden = !st.ok;
    $('#push-btn').textContent = st.on ? 'Bu cihazda kapat' : '🔔 Bildirimleri aç';
    const p = state.notifyPrefs || NOTIFY_DEFAULTS;
    $$('#np-list input[data-np]').forEach((el) => { el.checked = !!p[el.dataset.np]; });
  }

  // ---------------------------------------------------------------- ana çizim
  function preserveFocus(fn) {
    const a = document.activeElement;
    const id = a && a.id && $('#main').contains(a) ? a.id : null;
    const val = id ? a.value : null;
    const sel = id && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    const vals = {};
    $$('#main input[id]').forEach((el) => { vals[el.id] = el.value; });
    fn();
    for (const [k, v] of Object.entries(vals)) { const el = document.getElementById(k); if (el) el.value = v; }
    if (id) {
      const el = document.getElementById(id);
      if (el) { el.focus(); el.value = val; if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* yok say */ } }
    }
  }

  function render() {
    if (!store) return;
    renderMe();
    const taskViews = ['today', 'all', 'calendar'];
    $('#filters').hidden = !taskViews.includes(state.view);
    if (!$('#filters').hidden) renderFilters();
    const tab = state.view === 'all' ? 'today' : state.view;
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === tab));
    $('#fab').hidden = !(taskViews.includes(state.view) || state.view === 'budget') || state.markMode;
    $('#fab').setAttribute('aria-label', state.view === 'budget' ? 'Harcama ekle' : 'Görev ekle');
    $('#chat-bar').hidden = state.view !== 'chat';
    document.body.classList.toggle('in-chat', state.view === 'chat');
    preserveFocus(() => {
      if (state.view === 'calendar') renderCalendar();
      else if (state.view === 'all') renderAll();
      else if (state.view === 'lists') renderLists();
      else if (state.view === 'budget') renderBudget();
      else if (state.view === 'chat') renderChat();
      else renderToday();
    });
    updateBadges();
  }

  function go(view) {
    if (view === 'market') { view = 'lists'; state.listTab = 'market'; }
    state.view = view;
    if (view === 'calendar') { state.selDay = today(); state.calMonth = null; state.markMode = false; }
    render();
    if (view === 'chat') requestAnimationFrame(() => scrollChat(true));
    else window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- görev formu
  const sheet = () => $('#sheet');
  let formOwner = 'a';

  function renderOwnerSeg() {
    const o = other();
    const opts = [[state.me, 'Ben'], [o, MEMBERS[o].name], [BOTH, 'Ortak']];
    $('#owner-seg').innerHTML = opts.map(([k, label]) =>
      `<button type="button" class="${formOwner === k ? 'on' : ''}" data-owner="${k}"><i class="dot" style="background:${ownerColor(k)}"></i>${esc(label)}</button>`
    ).join('');
  }
  function syncDateChips() {
    const v = $('#f-date').value;
    const t = today();
    $$('#date-chips .chip').forEach((c) => {
      const q = c.dataset.quick;
      c.classList.toggle('on', (q === 'today' && v === t) || (q === 'tomorrow' && v === addDays(t, 1)) || (q === 'none' && !v));
    });
    $('#f-time').disabled = !v;
  }
  function openSheet(task) {
    state.editingId = task ? task.id : null;
    $('#sheet-title').textContent = task ? 'Görevi düzenle' : 'Yeni görev';
    $('#btn-delete').hidden = !task;
    $('#f-title').value = task ? task.title : '';
    $('#f-note').value = task ? task.note || '' : '';
    let defDate = today();
    if (state.view === 'calendar') defDate = state.selDay;
    else if (state.view === 'all') defDate = '';
    $('#f-date').value = task ? task.date || '' : defDate;
    $('#f-time').value = task ? task.time || '' : '';
    formOwner = task ? task.owner : state.filter === 'both' ? BOTH : state.filter === 'other' ? other() : state.me;
    renderOwnerSeg();
    syncDateChips();
    sheet().showModal();
    if (!task) setTimeout(() => $('#f-title').focus(), 50);
  }
  async function saveSheet() {
    const title = $('#f-title').value.trim();
    if (!title) { $('#f-title').focus(); return; }
    const date = $('#f-date').value || null;
    const data = { title, note: $('#f-note').value.trim(), date, time: date ? $('#f-time').value || null : null, owner: formOwner };
    const id = state.editingId;
    sheet().close();
    try {
      if (id) await store.update('tasks', id, { ...data, remindedAt: null });
      else await store.add('tasks', { ...data, done: false, doneBy: null, createdBy: state.me });
      if (date && state.view === 'calendar') state.selDay = date;
      toast(id ? 'Güncellendi' : 'Eklendi');
    } catch (e) { toast('Kaydedilemedi: ' + (e.code || e.message)); }
  }

  // ---------------------------------------------------------------- olaylar
  function bindUi() {
    $('#fab').onclick = () => (state.view === 'budget' ? openExpense(null) : openSheet(null));
    $('#btn-settings').onclick = openSettings;

    $('.tabbar').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (b) go(b.dataset.view);
    });
    $('#filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (b) { state.filter = b.dataset.filter; render(); }
    });
    $('#me-badge').onclick = () => {
      if (store.mode === 'demo') {
        state.me = other();
        lsSet('cift-ajanda:me', state.me);
        if (state.filter === 'mine' || state.filter === 'other') state.filter = state.filter === 'mine' ? 'other' : 'mine';
        state.markMode = false;
        syncCycleWatch();
        watchPrefs();
        toast(`Artık ${MEMBERS[state.me].name} olarak görüyorsun`);
        render();
      } else if (confirm('Çıkış yapılsın mı?')) {
        state.signOut();
      }
    };

    $('#main').addEventListener('submit', async (e) => {
      if (e.target.id === 'board-add') {
        e.preventDefault();
        const t = $('#board-title').value;
        if (!t.trim()) { $('#board-title').focus(); return; }
        const tag = $('#board-tag').value;
        $('#board-title').value = ''; $('#board-tag').value = '';
        try { await addBoard(state.listTab, t, tag); } catch (err) { toast('Eklenemedi: ' + (err.code || err.message)); }
        $('#board-title').focus();
        return;
      }
      if (e.target.id !== 'shop-add') return;
      e.preventDefault();
      const name = $('#shop-name').value;
      if (!name.trim()) { $('#shop-name').focus(); return; }
      const qty = $('#shop-qty').value.trim();
      $('#shop-name').value = ''; $('#shop-qty').value = '';
      try { await addShopping(name, qty, state.shopUrgent); }
      catch (err) { toast('Eklenemedi: ' + (err.code || err.message)); }
      $('#shop-name').focus();
    });

    $('#main').addEventListener('click', async (e) => {
      const goto = e.target.closest('[data-goto]');
      if (goto) { go(goto.dataset.goto); return; }

      const dayBtn = e.target.closest('[data-day]');
      if (dayBtn) {
        const d = dayBtn.dataset.day;
        if (state.markMode === 'period') {
          if (d > today()) { toast('Gelecek günler tahminle gösterilir'); return; }
          const doc = state.cycle.days.find((x) => x.date === d);
          try { await setCycleDay(d, { period: !(doc && doc.period) }); } catch (err) { toast('Kaydedilemedi: ' + (err.code || err.message)); }
          return;
        }
        if (state.markMode) { toggleMark(d); return; }
        state.selDay = d;
        if (d.slice(0, 7) !== state.calMonth.slice(0, 7)) state.calMonth = d.slice(0, 8) + '01';
        render();
        return;
      }
      const cal = e.target.closest('[data-cal]');
      if (cal) {
        const v = cal.dataset.cal;
        if (v === 'today') { state.calMonth = null; state.selDay = today(); }
        else { const d = parseYmd(state.calMonth); d.setMonth(d.getMonth() + Number(v)); state.calMonth = ymd(d); }
        render();
        return;
      }
      const mk = e.target.closest('[data-mark]');
      if (mk) { toggleMark(mk.dataset.mark); return; }
      const um = e.target.closest('[data-unmark]');
      if (um) { try { await store.remove('marks', um.dataset.unmark); } catch (err) { toast(err.message); } return; }

      const cyb = e.target.closest('[data-cy]');
      if (cyb && cycleIsMine()) {
        const a = cyb.dataset.cy;
        const d = cyb.dataset.d || today();
        const doc = state.cycle.days.find((x) => x.date === d) || {};
        try {
          if (a === 'today') { await setCycleDay(d, { period: true }); toast('🩸 Kaydedildi'); }
          else if (a === 'period') await setCycleDay(d, { period: !doc.period });
          else if (a === 'flow') await setCycleDay(d, { flow: doc.flow === cyb.dataset.v ? null : cyb.dataset.v });
          else if (a === 'sym') {
            const s = new Set(doc.symptoms || []);
            if (s.has(cyb.dataset.v)) s.delete(cyb.dataset.v); else s.add(cyb.dataset.v);
            await setCycleDay(d, { symptoms: [...s] });
          }
        } catch (err) { toast('Kaydedilemedi: ' + (err.code || err.message)); }
        return;
      }

      const lt = e.target.closest('[data-list]');
      if (lt) { state.listTab = lt.dataset.list; lsSet('cift-ajanda:listTab', state.listTab); state.boardPick = null; render(); return; }

      const bact = e.target.closest('[data-bact]');
      if (bact) {
        const b = state.board.find((x) => x.id === bact.closest('[data-bid]')?.dataset.bid);
        if (!b) return;
        if (bact.dataset.bact === 'edit') { openBoardSheet(b); return; }
        try { await store.update('board', b.id, { done: !b.done, doneAt: b.done ? null : Date.now() }); }
        catch (err) { toast('Güncellenemedi: ' + (err.code || err.message)); }
        return;
      }

      const bm = e.target.closest('[data-bm]');
      if (bm) {
        if (bm.dataset.bm === '0') state.budgetMonth = today().slice(0, 7);
        else { const d = parseYmd(state.budgetMonth + '-01'); d.setMonth(d.getMonth() + Number(bm.dataset.bm)); state.budgetMonth = ymd(d).slice(0, 7); }
        render(); return;
      }
      const eact = e.target.closest('[data-eact]');
      if (eact) { const x = state.expenses.find((y) => y.id === eact.closest('[data-eid]')?.dataset.eid); if (x) openExpense(x); return; }

      if (e.target.closest('#shop-urgent')) { state.shopUrgent = !state.shopUrgent; render(); return; }

      const sact = e.target.closest('[data-sact]');
      if (sact) {
        const id = sact.closest('[data-sid]')?.dataset.sid;
        const s = state.shopping.find((x) => x.id === id);
        if (!s) return;
        try {
          if (sact.dataset.sact === 'buy') {
            const bought = !s.bought;
            await store.update('shopping', id, { bought, boughtBy: bought ? state.me : null, boughtAt: bought ? Date.now() : null });
          } else if (sact.dataset.sact === 'urgent') {
            await store.update('shopping', id, { urgent: !s.urgent });
          } else if (sact.dataset.sact === 'del') {
            await store.remove('shopping', id);
          }
        } catch (err) { toast('Güncellenemedi: ' + (err.code || err.message)); }
        return;
      }

      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'showdone') { state.showDone = !state.showDone; render(); return; }
      if (a === 'markmode') { state.markMode = 'mark'; render(); return; }
      if (a === 'periodmode') { state.markMode = 'period'; state.cycle.layer = true; render(); return; }
      if (a === 'markdone') { state.markMode = false; render(); return; }
      if (a === 'cyclelayer') {
        state.cycle.layer = !state.cycle.layer;
        lsSet('cift-ajanda:cycleLayer', state.cycle.layer ? '1' : '0');
        render(); return;
      }
      if (a === 'settings') { openSettings(); return; }
      if (a === 'wx-gps') { useMyLocation(); return; }
      if (a === 'pick') {
        const open = state.board.filter((b) => b.type === 'watch' && !b.done);
        if (!open.length) return;
        const b = open[Math.floor(Math.random() * open.length)];
        state.boardPick = b.id;
        render();
        toast(`🎲 Bu akşam: ${b.title} 🍿`);
        requestAnimationFrame(() => { const el = document.querySelector('.task.pick'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
        return;
      }
      if (a === 'settle') {
        const debtor = act.dataset.debtor;
        const amt = Number(act.dataset.amt);
        const creditor = debtor === 'a' ? 'b' : 'a';
        if (!confirm(`${nameOf(debtor)} → ${nameOf(creditor)} ${money(amt)} ödendi olarak kaydedilsin mi? Hesap sıfırlanır.`)) return;
        try {
          await store.add('expenses', { kind: 'settle', amount: amt, category: 'diger', date: today(), paidBy: debtor, split: creditor, note: 'Hesaplaşma', addedBy: state.me });
          toast('🤝 Hesaplar denklendi');
        } catch (err) { toast('Kaydedilemedi: ' + (err.code || err.message)); }
        return;
      }
      if (a === 'clearbought') {
        if (!confirm('Alınan ürünler listeden silinsin mi?')) return;
        for (const s of state.shopping.filter((x) => x.bought)) await store.remove('shopping', s.id).catch(() => {});
        return;
      }
      const id = act.closest('.task')?.dataset.id;
      const task = state.tasks.find((x) => x.id === id);
      if (!task) return;
      if (a === 'toggle') {
        const done = !task.done;
        try { await store.update('tasks', id, { done, doneBy: done ? state.me : null }); }
        catch (err) { toast('Güncellenemedi: ' + (err.code || err.message)); }
      } else if (a === 'edit') {
        openSheet(task);
      }
    });

    // sohbet
    $('#chat-bar').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
    $('#chat-input').addEventListener('input', autoGrow);
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); sendChat(); }
    });

    // görev formu
    $('#task-form').addEventListener('submit', (e) => { e.preventDefault(); saveSheet(); });
    $$('dialog [data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
    $('#owner-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-owner]');
      if (b) { formOwner = b.dataset.owner; renderOwnerSeg(); }
    });
    $('#date-chips').addEventListener('click', (e) => {
      const q = e.target.closest('[data-quick]')?.dataset.quick;
      if (!q) return;
      $('#f-date').value = q === 'today' ? today() : q === 'tomorrow' ? addDays(today(), 1) : '';
      if (q === 'none') $('#f-time').value = '';
      syncDateChips();
    });
    $('#f-date').addEventListener('input', syncDateChips);
    $('#btn-delete').onclick = async () => {
      const id = state.editingId;
      if (!id || !confirm('Bu görev silinsin mi?')) return;
      sheet().close();
      try { await store.remove('tasks', id); toast('Silindi'); }
      catch (err) { toast('Silinemedi: ' + (err.code || err.message)); }
    };

    // pano formu
    $('#board-form').addEventListener('submit', (e) => { e.preventDefault(); saveBoardSheet(); });
    $('#board-form').addEventListener('click', (e) => {
      const o = e.target.closest('[data-bowner]');
      if (o) { boardForm.owner = o.dataset.bowner; renderBoardSeg(); return; }
      const t = e.target.closest('[data-btag]');
      if (t) { boardForm.tag = boardForm.tag === t.dataset.btag ? '' : t.dataset.btag; renderBoardSeg(); }
    });
    $('#bf-delete').onclick = async () => {
      if (!confirm('Silinsin mi?')) return;
      $('#board-sheet').close();
      try { await store.remove('board', boardForm.id); toast('Silindi'); } catch (err) { toast(err.message); }
    };

    // harcama formu
    $('#exp-form').addEventListener('submit', (e) => { e.preventDefault(); saveExpense(); });
    $('#exp-form').addEventListener('click', (e) => {
      const c = e.target.closest('[data-ecat]'); if (c) { expForm.cat = c.dataset.ecat; renderExpSegs(); return; }
      const p = e.target.closest('[data-epaid]'); if (p) { expForm.paidBy = p.dataset.epaid; renderExpSegs(); return; }
      const sp = e.target.closest('[data-esplit]'); if (sp) { expForm.split = sp.dataset.esplit; renderExpSegs(); }
    });
    $('#ef-delete').onclick = async () => {
      if (!confirm('Bu harcama silinsin mi?')) return;
      $('#exp-sheet').close();
      try { await store.remove('expenses', expForm.id); toast('Silindi'); } catch (err) { toast(err.message); }
    };

    // bildirim ayarları
    $('#push-btn').onclick = () => (pushState().on ? disablePush() : enablePush());
    $('#np-list').addEventListener('change', async (e) => {
      const k = e.target.dataset.np;
      if (!k) return;
      const next = { ...(state.notifyPrefs || NOTIFY_DEFAULTS), [k]: e.target.checked };
      state.notifyPrefs = next;
      try { await store.set('notifyPrefs', state.me, next); } catch (err) { toast('Kaydedilemedi: ' + (err.code || err.message)); }
    });

    // ayarlar
    $('#settings-form').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
    $('#w-search').onclick = searchCity;
    $('#w-city').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchCity(); } });
    $('#w-gps').onclick = () => { useMyLocation(); $('#w-status').textContent = '📍 Konum isteniyor…'; };

    // gün değişince (uygulama açık kalırsa) yenile
    let lastDay = today();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !store) return;
      fetchWeather();
      if (today() !== lastDay) { lastDay = today(); render(); }
    });
  }

  boot();
})();
