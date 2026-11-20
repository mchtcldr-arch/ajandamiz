/* Ajandamız bildirim sunucusu (Firebase Cloud Functions, 2. nesil).
 *
 * Firestore'a yeni bir şey yazılınca diğer kişiye bildirim gönderir, ayrıca:
 *   - her 15 dakikada saatli görevler için hatırlatma
 *   - her sabah 08:00'de günlük özet
 * Kimin hangi bildirimi alacağı notifyPrefs/{a|b} belgesinden okunur.
 *
 * Yayınlama:  firebase deploy --only functions,firestore:rules   (KURULUM.md) */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

// Firestore veritabanınızın konumuna göre: nam5 (ABD) → 'us-central1', eur3 (Avrupa) → 'europe-west1'
const REGION = 'us-central1';
const APP_URL = 'https://mchtcldr-arch.github.io/ajandamiz/';
const TZ = 'Europe/Istanbul';
const DEFAULT_NAMES = { a: 'Mücahit', b: 'Ece' };
const MARKS = { a: { label: 'nöbet', icon: '🩺' }, b: { label: 'etkinlik', icon: '🎉' } };
const DEFAULT_PREFS = { chat: true, tasks: true, reminders: true, morning: true, shopping: true, board: true, expenses: false, special: true, cycle: true };
const CYCLE_OWNER = 'b'; // config.js'te cycle: true olan kişi
const BOARD = { watch: ['🎬', 'izleneceklere'], wish: ['🎁', 'istek listesine'], trip: ['✈️', 'tatil hayallerine'] };
const CATS = { market: 'Market', fatura: 'Fatura', kira: 'Kira / aidat', ulasim: 'Ulaşım', disari: 'Dışarıda yemek', saglik: 'Sağlık',
  giyim: 'Giyim', eglence: 'Eğlence', ev: 'Ev', hediye: 'Hediye', tatil: 'Tatil', diger: 'Diğer' };

setGlobalOptions({ region: REGION, maxInstances: 2, memory: '256MiB' });
initializeApp();
const db = getFirestore();

// ------------------------------------------------------------------ yardımcılar
const isMember = (k) => k === 'a' || k === 'b';
const other = (k) => (k === 'a' ? 'b' : 'a');
const clip = (s, n = 140) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const money = (n) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(Number(n) || 0);
const ymdTZ = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hmTZ = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const toMin = (hm) => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const fmtDate = (ymd) => {
  const today = ymdTZ(new Date());
  const tomorrow = ymdTZ(new Date(Date.now() + 864e5));
  if (ymd === today) return 'bugün';
  if (ymd === tomorrow) return 'yarın';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });
};

async function names() {
  const s = await db.doc('settings/profile').get();
  const n = (s.exists && s.data().names) || {};
  return { a: n.a || DEFAULT_NAMES.a, b: n.b || DEFAULT_NAMES.b };
}
async function prefsOf(owner) {
  const s = await db.doc(`notifyPrefs/${owner}`).get();
  return { ...DEFAULT_PREFS, ...(s.exists ? s.data() : {}) };
}

// Kişinin tüm cihazlarına bildirim gönder; geçersiz cihaz anahtarlarını temizle.
async function send(owner, pref, title, body, tag) {
  if (!isMember(owner)) return;
  if (pref && !(await prefsOf(owner))[pref]) return;
  const snap = await db.collection('pushTokens').where('owner', '==', owner).get();
  const tokens = snap.docs.map((d) => d.id);
  if (!tokens.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: clip(title, 80), body: clip(body, 180) },
    webpush: {
      notification: { icon: APP_URL + 'icon-192.png', badge: APP_URL + 'icon-192.png', tag: tag || undefined, renotify: !!tag },
      fcmOptions: { link: APP_URL },
    },
  });
  const dead = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];
  await Promise.all(res.responses.map((r, i) => (!r.success && r.error && dead.includes(r.error.code)
    ? db.doc(`pushTokens/${tokens[i]}`).delete() : null)));
  logger.info(`bildirim → ${owner}: ${res.successCount}/${tokens.length}`, { title });
}

// ------------------------------------------------------------------ anlık bildirimler
exports.onMessageCreated = onDocumentCreated('messages/{id}', async (e) => {
  const m = e.data && e.data.data();
  if (!m || !isMember(m.from)) return;
  const n = await names();
  await send(other(m.from), 'chat', `💬 ${n[m.from]}`, m.text, 'chat');
});

exports.onTaskCreated = onDocumentCreated('tasks/{id}', async (e) => {
  const t = e.data && e.data.data();
  if (!t || !isMember(t.createdBy)) return;
  const to = other(t.createdBy);
  if (t.owner !== to && t.owner !== 'both') return;
  const n = await names();
  const when = t.date ? ` · ${fmtDate(t.date)}${t.time ? ' ' + t.time : ''}` : '';
  await send(to, 'tasks', `📝 ${n[t.createdBy]} ${t.owner === 'both' ? 'ortak' : 'sana'} görev ekledi`, clip(t.title, 120) + when, `task-${e.params.id}`);
});

exports.onShoppingCreated = onDocumentCreated('shopping/{id}', async (e) => {
  const s = e.data && e.data.data();
  if (!s || !s.urgent || !isMember(s.addedBy)) return;
  const n = await names();
  await send(other(s.addedBy), 'shopping', '⚡ Hemen alınacak', `${s.name}${s.qty ? ' (' + s.qty + ')' : ''} — ${n[s.addedBy]} ekledi`, 'shopping');
});

exports.onBoardCreated = onDocumentCreated('board/{id}', async (e) => {
  const b = e.data && e.data.data();
  if (!b || !isMember(b.addedBy) || !BOARD[b.type]) return;
  const n = await names();
  const [icon, where] = BOARD[b.type];
  await send(other(b.addedBy), 'board', `${icon} ${n[b.addedBy]} ${where} ekledi`, b.title, `board-${e.params.id}`);
});

exports.onExpenseCreated = onDocumentCreated('expenses/{id}', async (e) => {
  const x = e.data && e.data.data();
  if (!x || !isMember(x.addedBy)) return;
  const n = await names();
  if (x.kind === 'settle') {
    await send(other(x.addedBy), 'expenses', '🤝 Hesaplaşma kaydedildi', `${n[x.paidBy] || ''} → ${n[x.split] || ''}: ${money(x.amount)}`, 'settle');
    return;
  }
  await send(other(x.addedBy), 'expenses', `💸 ${n[x.addedBy]} harcama ekledi`,
    `${money(x.amount)} · ${CATS[x.category] || 'Diğer'}${x.note ? ' · ' + x.note : ''}`, `exp-${e.params.id}`);
});

// ------------------------------------------------------------------ zamanlanmış
// Saatli görev hatırlatıcısı: görev saatine 0–20 dk kalan, henüz hatırlatılmamış görevler.
exports.taskReminders = onSchedule({ schedule: 'every 15 minutes', timeZone: TZ }, async () => {
  const now = new Date();
  const today = ymdTZ(now);
  const nowMin = toMin(hmTZ(now));
  const snap = await db.collection('tasks').where('date', '==', today).get();
  for (const doc of snap.docs) {
    const t = doc.data();
    if (t.done || !t.time || t.remindedAt) continue;
    const diff = toMin(t.time) - nowMin;
    if (diff < 0 || diff > 20) continue;
    const owners = t.owner === 'both' ? ['a', 'b'] : [t.owner];
    await Promise.all(owners.map((o) => send(o, 'reminders', `⏰ ${t.time} · ${clip(t.title, 60)}`,
      diff <= 1 ? 'Şimdi!' : `${diff} dakika sonra${t.owner === 'both' ? ' (ortak)' : ''}`, `rem-${doc.id}`)));
    await doc.ref.update({ remindedAt: FieldValue.serverTimestamp() });
  }
});

// Sabah özeti: bugünkü görevler, gecikenler, nöbet/etkinlik, acil market.
exports.morningSummary = onSchedule({ schedule: '0 8 * * *', timeZone: TZ }, async () => {
  const today = ymdTZ(new Date());
  const [n, tasks, marks, urgent] = await Promise.all([
    names(),
    db.collection('tasks').where('done', '==', false).get(),
    db.collection('marks').where('date', '==', today).get(),
    db.collection('shopping').where('bought', '==', false).where('urgent', '==', true).get(),
  ]);
  for (const o of ['a', 'b']) {
    const mine = tasks.docs.map((d) => d.data()).filter((t) => t.owner === o || t.owner === 'both');
    const todayN = mine.filter((t) => t.date === today).length;
    const lateN = mine.filter((t) => t.date && t.date < today).length;
    const parts = [];
    if (marks.docs.some((d) => d.data().owner === o)) parts.push(`${MARKS[o].icon} Bugün ${MARKS[o].label} günün`);
    if (todayN) parts.push(`📝 ${todayN} görev`);
    if (lateN) parts.push(`⏳ ${lateN} geciken`);
    if (urgent.size) parts.push(`⚡ ${urgent.size} acil market ürünü`);
    if (!parts.length) continue;
    await send(o, 'morning', `🌅 Günaydın ${n[o]}!`, parts.join(' · '), 'morning');
  }
  await specialDayNotices(today);
  await cycleNotices(today);
});

// ------------------------------------------------------------------ özel günler
const diffDays = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);
const addDaysYmd = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function nextOcc(sd, from) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd.date || '')) return null;
  if (!sd.yearly) return sd.date >= from ? sd.date : null;
  const [, m, d] = sd.date.split('-').map(Number);
  const occ = (y) => `${y}-${String(m).padStart(2, '0')}-${String(m === 2 && d === 29 && !isLeap(y) ? 28 : d).padStart(2, '0')}`;
  const y = +from.slice(0, 4);
  return occ(y) >= from ? occ(y) : occ(y + 1);
}
async function specialDayNotices(today) {
  const snap = await db.collection('specialDays').get();
  const ICON = { birthday: '🎂', anniversary: '💍', other: '⭐' };
  for (const doc of snap.docs) {
    const sd = doc.data();
    const occ = nextOcc(sd, today);
    if (!occ) continue;
    const days = diffDays(today, occ);
    const y0 = +String(sd.date).slice(0, 4);
    const nth = sd.yearly && y0 >= 1900 && +occ.slice(0, 4) > y0 ? ` (${+occ.slice(0, 4) - y0}. ${sd.type === 'birthday' ? 'yaş' : 'yıl'})` : '';
    const icon = ICON[sd.type] || '⭐';
    let title = null; let body = null;
    const celebrate = sd.type === 'other' ? 'Unutmayın 😊' : 'Kutlu olsun! 🎉';
    if (days === 0) { title = `${icon} Bugün: ${sd.title}${nth}`; body = celebrate; }
    else if (days === 1) { title = `${icon} Yarın: ${sd.title}${nth}`; body = sd.type === 'other' ? 'Hazır mısınız?' : 'Hazırlıklar tamam mı?'; }
    else if (days === 7) { title = `${icon} 1 hafta kaldı: ${sd.title}`; body = sd.type === 'other' ? 'Takvimde yerini ayırın.' : 'Hediye ya da plan düşündünüz mü? 🎁'; }
    if (!title) continue;
    // Doğum günü ikinizden birininse sürpriz bozulmasın: hatırlatma sadece diğerine gider.
    const to = sd.type === 'birthday' && isMember(sd.person) ? [other(sd.person)] : ['a', 'b'];
    await Promise.all(to.map((o) => send(o, 'special', title, body, `sp-${doc.id}`)));
  }
}

// ------------------------------------------------------------------ döngü (regl) hatırlatması
// Uygulamadaki hesapla aynı: son regl başlangıçlarından ortalama döngü süresi.
async function cycleNotices(today) {
  const [daysSnap, setSnap] = await Promise.all([
    db.collection(`cycle/${CYCLE_OWNER}/days`).get(),
    db.doc(`cycleSettings/${CYCLE_OWNER}`).get(),
  ]);
  const settings = setSnap.exists ? setSnap.data() : {};
  const logged = daysSnap.docs.map((d) => d.data()).filter((d) => d.period).map((d) => d.date).sort();
  if (!logged.length) return;
  const eps = [];
  for (const d of logged) { const l = eps[eps.length - 1]; if (l && diffDays(l.end, d) <= 2) l.end = d; else eps.push({ start: d, end: d }); }
  const lens = [];
  for (let i = 1; i < eps.length; i++) { const L = diffDays(eps[i - 1].start, eps[i].start); if (L >= 15 && L <= 60) lens.push(L); }
  const recent = lens.slice(-6);
  const cycleLen = recent.length ? Math.round(recent.reduce((s, x) => s + x, 0) / recent.length) : Math.min(45, Math.max(20, Number(settings.cycleLen) || 28));
  const last = eps[eps.length - 1];
  if (diffDays(last.start, today) > cycleLen * 2) return; // uzun süredir kayıt yok
  const next = addDaysYmd(last.start, cycleLen);
  const until = diffDays(today, next);
  const loggedToday = logged.includes(today);
  if (loggedToday || last.end >= addDaysYmd(today, -1)) return; // zaten regl döneminde
  const n = await names();
  if (until === 2) await send(CYCLE_OWNER, 'cycle', '🌸 Döngü hatırlatması', 'Bir sonraki dönemin ~2 gün sonra bekleniyor.', 'cycle');
  else if (until === 0) await send(CYCLE_OWNER, 'cycle', '🌸 Döngü hatırlatması', 'Dönemin bugün bekleniyor. Başlarsa uygulamada işaretlemeyi unutma.', 'cycle');
  if (settings.share === true && until === 1) {
    await send(other(CYCLE_OWNER), 'cycle', '🌸 Nazik bir hatırlatma', `${n[CYCLE_OWNER]}: dönem ~1 gün sonra bekleniyor 💕`, 'cycle-p');
  }
}
