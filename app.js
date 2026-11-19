/* Ajandamız — iki kişilik ortak yapılacaklar, takvim, market listesi ve sohbet.
 * Derleme gerektirmez. config.js'te firebase ayarı yoksa Demo modunda
 * (localStorage) çalışır; varsa Firebase Auth + Firestore ile senkronlanır.
 * Yapay zekâ özellikleri kullanıcının kendi Gemini anahtarıyla çalışır (ai.js). */
(function () {
  'use strict';

  const CFG = window.CIFT_AJANDA_CONFIG || {};
  const AI = window.CA_AI;
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
  const MARKET_COLORS = { Migros: '#f97316', 'ŞOK': '#eab308', 'BİM': '#dc2626', CarrefourSA: '#2563eb', A101: '#0891b2' };
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
    view: 'today',          // today | all | calendar | market | chat
    filter: 'all',          // all | mine | other | both
    calMonth: null,
    selDay: today(),
    showDone: false,
    markMode: false,        // false | 'mark' (nöbet/etkinlik) | 'period' (regl)
    cycle: { settings: null, days: [], layer: lsGet('cift-ajanda:cycleLayer') !== '0' },
    editingId: null,
    shopUrgent: false,
    aiToggle: false,
    aiBusy: false,
    discountBusy: false,
    tasks: [], shopping: [], messages: [], marks: [],
    ai: { apiKey: '', model: '' },
    quote: null, quoteLoaded: false,
    discounts: null,
    chatSeen: Number(lsGet('cift-ajanda:chatSeen')) || 0,
  };
  let store = null;
  const other = () => (state.me === 'a' ? 'b' : 'a');
  const nameOf = (k) => (k === state.me ? 'Ben' : MEMBERS[k] ? MEMBERS[k].name : '?');
  const ownerLabel = (o) => (o === BOTH ? 'Ortak' : nameOf(o));
  const ownerColor = (o) => COLORS[o] || COLORS.both;
  const hasAi = () => !!(state.ai.apiKey && state.ai.model);

  // ---------------------------------------------------------------- açılış
  function showGate(msg, { login = false, logout = false } = {}) {
    $('#gate').hidden = false;
    $('#app').hidden = true;
    $('#gate-msg').textContent = msg;
    $('#btn-login').hidden = !login;
    $('#btn-logout-gate').hidden = !logout;
  }

  let unDaily = null;
  function watchDaily() {
    if (unDaily) unDaily();
    const d = today();
    state.quoteLoaded = false;
    unDaily = store.watchDoc('daily', d, (doc) => {
      state.quote = doc && doc.text ? doc : null;
      state.quoteLoaded = true;
      ensureQuote();
      if (state.view === 'today') render();
    });
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
    store.watchDoc('private', 'ai', (d) => {
      state.ai = { apiKey: (d && d.apiKey) || '', model: (d && d.model) || '' };
      ensureQuote();
      scheduleRender();
    });
    store.watchDoc('aiCache', 'discounts', (d) => { state.discounts = d; scheduleRender(); });
    // Uygulama içinden değiştirilen isimler config.js'tekilerin önüne geçer
    store.watchDoc('settings', 'profile', (d) => {
      const names = (d && d.names) || {};
      for (const k of ['a', 'b']) MEMBERS[k].name = (names[k] || '').trim() || CONFIG_NAMES[k];
      scheduleRender();
    });
    if (CYCLE_OWNER) {
      store.watchDoc('cycleSettings', CYCLE_OWNER, (d) => { state.cycle.settings = d; syncCycleWatch(); scheduleRender(); });
    }
    watchDaily();
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
  // (Firestore kuralı da bunu zorlar). Bu veriler yapay zekâya gönderilmez.
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

    const q = state.quote || builtinQuote(t);
    let html = `<div class="quote"><div class="q-label">Günün sözü${state.quote && state.quote.ai ? ' ✨' : ''}</div>
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
      cells += `<button class="${cls}" data-day="${d}" style="${dayStyle(owners)}" aria-label="${esc(label)}">${icons ? `<span class="mk">${icons}</span>` : ''}<span class="n">${parseYmd(d).getDate()}</span><span class="dots">${dots}</span></button>`;
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
      <div class="section"><div class="section-head"><span>${esc(fmtLong(state.selDay))}</span></div><div class="card">${markRows}</div></div>
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

  function discountsHtml() {
    const d = state.discounts;
    const markets = AI.MARKETS.map((m) => `<span class="mkt" style="--mc:${MARKET_COLORS[m]}">${esc(m)}</span>`).join('');
    let body = '';
    if (!hasAi()) {
      body = `<button class="btn ghost" data-act="settings">✨ Gemini anahtarı bağla</button>`;
    } else {
      body = `<button class="btn primary" data-act="discounts" ${state.discountBusy ? 'disabled' : ''}>
        ${state.discountBusy ? 'Marketler taranıyor… (30-60 sn)' : '🔎 Listemiz için indirimleri ara'}</button>`;
    }
    if (d && (d.items?.length || d.raw)) {
      const items = (d.items || []).slice().sort((x, y) => (y.forList ? 1 : 0) - (x.forList ? 1 : 0));
      body += `<div class="deals">${items.map((x) => {
        const mk = AI.MARKETS.find((m) => m.toLocaleLowerCase('tr-TR') === String(x.market).toLocaleLowerCase('tr-TR').trim()) || x.market;
        return `<div class="deal${x.forList ? ' fav' : ''}">
          <span class="mkt" style="--mc:${MARKET_COLORS[mk] || '#888'}">${esc(mk || '?')}</span>
          <div class="grow"><b>${x.forList ? '⭐ ' : ''}${esc(x.product)}</b>
            <span class="d-meta">${esc(x.deal)}${x.valid ? ' · ' + esc(x.valid) : ''}</span></div>
          ${x.price ? `<span class="price">${esc(x.price)}</span>` : ''}
        </div>`;
      }).join('')}</div>`;
      if (d.raw) body += `<div class="raw">${richText(d.raw)}</div>`;
      if (d.summary) body += `<p class="ai-summary">💡 ${esc(d.summary)}</p>`;
      if (d.sources?.length) body += `<div class="sources">Kaynaklar: ${d.sources.slice(0, 8).map((s) => `<a href="${esc(safeUrl(s.uri))}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join('')}</div>`;
      const when = toMs(d.updatedAt) || d.at;
      body += `<p class="fine">${when ? new Date(when).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}${d.by && MEMBERS[d.by] ? ' · ' + esc(nameOf(d.by)) + ' aradı' : ''} · Bilgiler internetteki kaynaklardan derlenir; raf fiyatı ve stok değişebilir.</p>`;
    }
    return `<div class="ai-card"><div><h3>✨ İndirim avcısı</h3><div class="markets">${markets}</div>${body}</div></div>`;
  }

  function renderMarket() {
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
    html += discountsHtml();
    if (bought.length) {
      html += section('✓ Alındı', bought.map(shopRow).join(''), { right: '<button class="link-btn" data-act="clearbought">Temizle</button>' });
    }
    $('#main').innerHTML = html;
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

  async function runDiscountSearch() {
    if (!hasAi()) { openSettings(); return null; }
    if (state.discountBusy) return state.discounts;
    state.discountBusy = true; scheduleRender();
    try {
      const items = state.shopping.filter((s) => !s.bought).sort((x, y) => (y.urgent ? 1 : 0) - (x.urgent ? 1 : 0)).map((s) => s.name);
      const res = await AI.findDiscounts(state.ai.apiKey, state.ai.model, items, today());
      const doc = { ...res, by: state.me, at: Date.now() };
      await store.set('aiCache', 'discounts', doc);
      state.discounts = doc;
      return doc;
    } finally {
      state.discountBusy = false; scheduleRender();
    }
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
    $('#view-sub').textContent = `Sen & ${MEMBERS[o].name}${hasAi() ? ' & ✨ Asistan' : ''}`;
    const msgs = state.messages;
    let html = '<div class="chat">';
    if (!msgs.length) {
      html += `<div class="empty">Henüz mesaj yok. İlk mesajı yaz 💌
        <ul class="tips"><li><b>✨</b> düğmesini açarak (ya da mesaja <b>@asistan</b> diye başlayarak) yapay zekâya sorabilirsiniz:</li>
        <li>“Cumartesi 20:00'de sinema ekle, ikimizin”</li><li>“Markete süt, yumurta ekle; süt acil”</li>
        <li>“Aralık'ta 3, 11, 19 ve 27'de nöbetim var, işaretle”</li><li>“Bu hafta A101'de deterjan indirimi var mı?”</li></ul></div>`;
    }
    let lastDay = '';
    for (const m of msgs) {
      const ms = toMs(m.createdAt);
      const d = ms ? ymd(new Date(ms)) : '';
      if (d && d !== lastDay) { html += `<span class="day-sep">${esc(relDay(d))}</span>`; lastDay = d; }
      html += msgHtml(m);
    }
    if (state.aiBusy) html += `<div class="msg ai"><span class="who-l">✨ Asistan</span><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`;
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
    const askAi = state.aiToggle || /^@(asistan|ai)\b/i.test(text);
    if (askAi && !hasAi()) { toast('Önce Ayarlar\'dan Gemini anahtarı bağlayın'); openSettings(); return; }
    input.value = ''; autoGrow();
    try { await store.add('messages', { text, from: state.me }); }
    catch (e) { toast('Gönderilemedi: ' + (e.code || e.message)); input.value = text; return; }
    scrollChat(true);
    if (askAi) runAssistant(text);
  }
  function autoGrow() {
    const el = $('#chat-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // ---------------------------------------------------------------- Asistan (agentic)
  const S = (type, description, extra = {}) => ({ type, description, ...extra });
  const AGENT_TOOLS = [
    {
      name: 'add_task',
      description: 'Ortak yapılacaklar listesine görev ekler.',
      parameters: S('OBJECT', 'Görev', {
        properties: {
          title: S('STRING', 'Kısa görev başlığı'),
          date: S('STRING', 'YYYY-MM-DD; tarihsizse boş bırak'),
          time: S('STRING', 'HH:MM; saat yoksa boş bırak'),
          owner: S('STRING', 'Kimin işi', { enum: ['a', 'b', 'both'] }),
          note: S('STRING', 'Opsiyonel not'),
        },
        required: ['title', 'owner'],
      }),
    },
    {
      name: 'complete_task',
      description: 'Bir görevi tamamlandı olarak işaretler (id mevcut verilerden alınır).',
      parameters: S('OBJECT', 'Görev', { properties: { id: S('STRING', 'Görev id') }, required: ['id'] }),
    },
    {
      name: 'add_shopping_items',
      description: 'Market/alışveriş listesine bir veya daha fazla ürün ekler. urgent=true → "Hemen alınacaklar".',
      parameters: S('OBJECT', 'Ürünler', {
        properties: {
          items: S('ARRAY', 'Eklenecek ürünler', {
            items: S('OBJECT', 'Ürün', {
              properties: { name: S('STRING', 'Ürün adı'), qty: S('STRING', 'Miktar, ör. "2 adet", "1 kg"'), urgent: S('BOOLEAN', 'Acil mi') },
              required: ['name'],
            }),
          }),
        },
        required: ['items'],
      }),
    },
    {
      name: 'mark_shopping_bought',
      description: 'Market listesindeki bir ürünü alındı olarak işaretler.',
      parameters: S('OBJECT', 'Ürün', { properties: { id: S('STRING', 'Ürün id') }, required: ['id'] }),
    },
    {
      name: 'set_calendar_marks',
      description: `Takvimde kişiye özel gün işaretlerini ekler/kaldırır. a: "${MEMBERS.a.markLabel}", b: "${MEMBERS.b.markLabel}".`,
      parameters: S('OBJECT', 'İşaretler', {
        properties: {
          owner: S('STRING', 'Kimin işareti', { enum: ['a', 'b'] }),
          dates: S('ARRAY', 'YYYY-MM-DD tarihleri', { items: S('STRING', 'Tarih') }),
          on: S('BOOLEAN', 'true=ekle, false=kaldır'),
        },
        required: ['owner', 'dates', 'on'],
      }),
    },
    {
      name: 'web_search',
      description: 'Güncel bilgi için Google\'da arama yapar ve kaynaklı özet döner (fiyat, kampanya, hava, saatler, tarifler…).',
      parameters: S('OBJECT', 'Arama', { properties: { query: S('STRING', 'Arama sorusu') }, required: ['query'] }),
    },
    {
      name: 'find_market_discounts',
      description: 'Migros, ŞOK, BİM, CarrefourSA ve A101\'de alışveriş listemizdeki ürünler için güncel indirimleri araştırır; sonuçlar Market ekranında da görünür.',
      parameters: S('OBJECT', 'Parametre yok', { properties: {} }),
    },
  ];

  function buildSystemPrompt() {
    const t = today();
    const now = new Date();
    const days = Array.from({ length: 21 }, (_, i) => { const d = addDays(t, i); return `${d} ${weekday(d)}`; }).join(', ');
    const data = {
      tasks: state.tasks.filter((x) => !x.done).sort(cmpTasks).slice(0, 80)
        .map((x) => ({ id: x.id, title: x.title, date: x.date || null, time: x.time || null, owner: x.owner })),
      shopping: state.shopping.filter((s) => !s.bought).map((s) => ({ id: s.id, name: s.name, qty: s.qty || '', urgent: !!s.urgent })),
      marks: state.marks.filter((m) => m.date >= addDays(t, -7) && m.date <= addDays(t, 60)).map((m) => ({ date: m.date, owner: m.owner })),
    };
    return `Sen "Ajandamız" uygulamasındaki sıcakkanlı ev asistanısın. Bir çiftin ortak yapılacaklar listesini, market listesini ve takvimini yönetiyorsun; aynı sohbet odasında ikisiyle de konuşuyorsun.
Bugün ${t} ${weekday(t)}, saat ${pad(now.getHours())}:${pad(now.getMinutes())}. Önümüzdeki günler: ${days}.
Kişiler: a = ${MEMBERS.a.name} (mavi; takvim işareti "${MEMBERS.a.markLabel}"), b = ${MEMBERS.b.name} (pembe; takvim işareti "${MEMBERS.b.markLabel}").
Şu an yazan: ${MEMBERS[state.me].name} (${state.me}). "ben/benim" bu kişidir; "ikimiz/birlikte/biz" → owner "both"; "eşim" → diğer kişi.
Kurallar:
- Türkçe, samimi ve kısa yaz. Yaptığın işlemleri tek cümleyle özetle.
- Ekleme/değiştirme isteklerinde mutlaka ilgili aracı çağır; araç çağırmadan "ekledim" deme.
- Göreli tarihleri yukarıdaki takvime göre YYYY-MM-DD'ye çevir.
- Güncel bilgi gerekiyorsa (fiyat, indirim, hava, açılış saati, haber) web_search; market indirimleri için find_market_discounts kullan. Bulamazsan dürüstçe söyle, fiyat uydurma; fiyatların mağazada değişebileceğini hatırlat.
- Belirsizlik varsa makul varsayımla ilerle ve varsayımını belirt.
- Regl/döngü verilerine gizlilik gereği erişimin yok; bu konuda kayıt isteklerini Takvim'deki 🌸 Döngü bölümüne yönlendir.
Mevcut veriler (JSON): ${JSON.stringify(data)}`;
  }

  function buildHistory() {
    const recent = state.messages.slice(-16);
    const contents = [];
    for (const m of recent) {
      const role = m.from === 'ai' ? 'model' : 'user';
      const text = role === 'model' ? m.text : `[${MEMBERS[m.from]?.name || '?'}]: ${m.text.replace(/^@(asistan|ai)\b\s*/i, '')}`;
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts.push({ text });
      else contents.push({ role, parts: [{ text }] });
    }
    while (contents.length && contents[0].role !== 'user') contents.shift();
    return contents;
  }

  async function execTool(name, args, actions) {
    const me = state.me;
    switch (name) {
      case 'add_task': {
        const title = String(args.title || '').trim().slice(0, 200);
        if (!title) return { error: 'Başlık boş' };
        const date = isYmd(args.date) ? args.date : null;
        const time = date && isHm(args.time) ? args.time : null;
        const owner = ['a', 'b', BOTH].includes(args.owner) ? args.owner : me;
        await store.add('tasks', { title, note: String(args.note || '').slice(0, 2000), date, time, owner, done: false, doneBy: null, createdBy: me });
        actions.push(`📝 ${title}${date ? ' · ' + relDay(date) + (time ? ' ' + time : '') : ''}`);
        return { ok: true };
      }
      case 'complete_task': {
        const t = state.tasks.find((x) => x.id === args.id);
        if (!t) return { error: 'Görev bulunamadı' };
        await store.update('tasks', t.id, { done: true, doneBy: me });
        actions.push(`✓ ${t.title}`);
        return { ok: true };
      }
      case 'add_shopping_items': {
        const items = Array.isArray(args.items) ? args.items.slice(0, 30) : [];
        const added = [];
        for (const it of items) {
          const n = String((it && it.name) || '').trim().slice(0, 120);
          if (!n) continue;
          await store.add('shopping', { name: n, qty: String(it.qty || '').slice(0, 20), urgent: !!it.urgent, bought: false, boughtBy: null, boughtAt: null, addedBy: me });
          added.push((it.urgent ? '⚡' : '') + n);
        }
        if (added.length) actions.push(`🛒 ${added.join(', ')}`);
        return { ok: true, added: added.length };
      }
      case 'mark_shopping_bought': {
        const s = state.shopping.find((x) => x.id === args.id);
        if (!s) return { error: 'Ürün bulunamadı' };
        await store.update('shopping', s.id, { bought: true, boughtBy: me, boughtAt: Date.now() });
        actions.push(`✓ ${s.name} alındı`);
        return { ok: true };
      }
      case 'set_calendar_marks': {
        const owner = args.owner === 'b' ? 'b' : 'a';
        const dates = (Array.isArray(args.dates) ? args.dates : []).filter(isYmd).slice(0, 62);
        for (const d of dates) {
          const id = markId(d, owner);
          if (args.on === false) await store.remove('marks', id);
          else await store.set('marks', id, { date: d, owner, label: MEMBERS[owner].markLabel });
        }
        if (dates.length) actions.push(`${MEMBERS[owner].markIcon} ${dates.length} gün ${args.on === false ? 'kaldırıldı' : MEMBERS[owner].markLabel.toLocaleLowerCase('tr-TR')}`);
        return { ok: true, count: dates.length };
      }
      case 'web_search': {
        const r = await AI.search(state.ai.apiKey, state.ai.model, `${args.query}\n(Bugün ${today()}. Türkçe ve kısa yanıtla, yalnızca kaynaklara dayan.)`);
        return { summary: r.text.slice(0, 4000), sources: r.sources };
      }
      case 'find_market_discounts': {
        const d = await runDiscountSearch();
        actions.push('🔎 İndirimler Market ekranında');
        return { summary: d?.summary || '', items: (d?.items || []).slice(0, 15), raw: (d?.raw || '').slice(0, 3000) };
      }
      default:
        return { error: 'Bilinmeyen araç: ' + name };
    }
  }

  async function runAssistant() {
    state.aiBusy = true; scheduleRender();
    requestAnimationFrame(() => scrollChat(true));
    const actions = [];
    try {
      const res = await AI.runAgent({
        key: state.ai.apiKey, model: state.ai.model,
        system: buildSystemPrompt(), history: buildHistory(), tools: AGENT_TOOLS,
        execute: (n, a) => execTool(n, a, actions),
      });
      const seen = new Set();
      const sources = res.sources.filter((s) => !seen.has(s.uri) && seen.add(s.uri)).slice(0, 8);
      await store.add('messages', { text: res.text || (actions.length ? 'Tamamdır 👍' : '…'), from: 'ai', askedBy: state.me, actions, sources });
    } catch (e) {
      await store.add('messages', { text: 'Üzgünüm, bir sorun oldu: ' + e.message, from: 'ai', askedBy: state.me, actions, sources: [] }).catch(() => {});
    } finally {
      state.aiBusy = false; scheduleRender();
    }
  }

  // ---------------------------------------------------------------- Günün sözü
  let quoteReqFor = '';
  async function ensureQuote() {
    const t = today();
    if (!store || !state.quoteLoaded || state.quote || !hasAi() || quoteReqFor === t) return;
    quoteReqFor = t;
    try {
      const q = await AI.dailyQuote(state.ai.apiKey, state.ai.model, t);
      if (q) await store.set('daily', t, { ...q, ai: true });
    } catch (e) { console.warn('Günün sözü alınamadı:', e.message); }
  }

  // ---------------------------------------------------------------- Ayarlar
  function fillModels(models, selected) {
    const sel = $('#s-model');
    sel.innerHTML = models.map((m) => `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(m.label)} (${esc(m.id)})</option>`).join('');
  }
  function setStatus(msg, cls = '') { const el = $('#s-status'); el.textContent = msg; el.className = 'hint ' + cls; }

  function openSettings() {
    $('#s-key').value = state.ai.apiKey;
    fillModels(state.ai.model ? [{ id: state.ai.model, label: state.ai.model }] : [], state.ai.model);
    setStatus(hasAi() ? '✓ Bağlı' : 'Bağlı değil', hasAi() ? 'ok' : '');
    $('#s-where').textContent = store.mode === 'cloud'
      ? '🔒 Anahtar ikinizin ortak veritabanında saklanır; sadece siz ikiniz okuyabilirsiniz ve eşiniz de asistanı kullanabilir. İstekler tarayıcıdan doğrudan Google\'a gider.'
      : 'Demo modunda anahtar sadece bu tarayıcıda saklanır.';
    $('#s-remove').hidden = !state.ai.apiKey;
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
  async function loadModels() {
    const key = $('#s-key').value.trim();
    if (!key) { setStatus('Önce anahtarı yapıştırın.', 'err'); return null; }
    setStatus('Bağlanıyor…');
    try {
      const models = await AI.listModels(key);
      if (!models.length) throw new Error('Kullanılabilir model bulunamadı');
      const cur = $('#s-model').value;
      const pick = models.some((m) => m.id === cur) ? cur : AI.pickDefault(models);
      fillModels(models, pick);
      setStatus(`✓ Bağlandı — ${models.length} model. Önerilen seçildi.`, 'ok');
      return pick;
    } catch (e) { setStatus('✕ ' + e.message, 'err'); return null; }
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
      const key = $('#s-key').value.trim();
      const na = $('#n-a').value.trim().slice(0, 30);
      const nb = $('#n-b').value.trim().slice(0, 30);
      if (na !== MEMBERS.a.name || nb !== MEMBERS.b.name) {
        await store.set('settings', 'profile', { names: { a: na || CONFIG_NAMES.a, b: nb || CONFIG_NAMES.b } });
      }
      let msg = 'Kaydedildi';
      if (key) {
        let model = $('#s-model').value;
        if (!model || key !== state.ai.apiKey) { model = await loadModels(); if (!model) return; }
        if (key !== state.ai.apiKey || model !== state.ai.model) {
          await store.set('private', 'ai', { apiKey: key, model });
          msg = '✨ Yapay zekâ bağlandı';
        }
      }
      $('#settings').close();
      toast(msg);
    } catch (e) { setStatus('Kaydedilemedi: ' + (e.code || e.message), 'err'); }
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
    $('#fab').hidden = !taskViews.includes(state.view) || state.markMode;
    $('#chat-bar').hidden = state.view !== 'chat';
    document.body.classList.toggle('in-chat', state.view === 'chat');
    document.body.classList.toggle('ai-mode', state.aiToggle);
    preserveFocus(() => {
      if (state.view === 'calendar') renderCalendar();
      else if (state.view === 'all') renderAll();
      else if (state.view === 'market') renderMarket();
      else if (state.view === 'chat') renderChat();
      else renderToday();
    });
    updateBadges();
  }

  function go(view) {
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
      if (id) await store.update('tasks', id, data);
      else await store.add('tasks', { ...data, done: false, doneBy: null, createdBy: state.me });
      if (date && state.view === 'calendar') state.selDay = date;
      toast(id ? 'Güncellendi' : 'Eklendi');
    } catch (e) { toast('Kaydedilemedi: ' + (e.code || e.message)); }
  }

  // ---------------------------------------------------------------- olaylar
  function bindUi() {
    $('#fab').onclick = () => openSheet(null);
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
        toast(`Artık ${MEMBERS[state.me].name} olarak görüyorsun`);
        render();
      } else if (confirm('Çıkış yapılsın mı?')) {
        state.signOut();
      }
    };

    $('#main').addEventListener('submit', async (e) => {
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
      if (a === 'discounts') {
        try { await runDiscountSearch(); toast('İndirimler güncellendi'); }
        catch (err) { toast('Arama başarısız: ' + err.message); }
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
    $('#ai-toggle').onclick = () => {
      if (!hasAi()) { openSettings(); return; }
      state.aiToggle = !state.aiToggle;
      $('#ai-toggle').setAttribute('aria-pressed', String(state.aiToggle));
      $('#chat-input').placeholder = state.aiToggle ? '✨ Asistana sor…' : 'Mesaj yaz…';
      document.body.classList.toggle('ai-mode', state.aiToggle);
      $('#chat-input').focus();
    };

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

    // ayarlar
    $('#settings-form').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
    $('#s-load').onclick = loadModels;
    $('#s-remove').onclick = async () => {
      if (!confirm('Gemini anahtarı kaldırılsın mı? Yapay zekâ özellikleri kapanır.')) return;
      await store.remove('private', 'ai').catch(() => {});
      $('#settings').close();
      toast('Anahtar kaldırıldı');
    };

    // gün değişince (uygulama açık kalırsa) yenile
    let lastDay = today();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && store && today() !== lastDay) {
        lastDay = today(); quoteReqFor = ''; watchDaily(); render();
      }
    });
  }

  boot();
})();
