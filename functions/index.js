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
const DEFAULT_PREFS = { chat: true, tasks: true, reminders: true, morning: true, shopping: true, board: true, expenses: false };
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
  if (x.split !== 'both') return;
  await send(other(x.addedBy), 'expenses', `💸 ${n[x.addedBy]} ortak harcama ekledi`,
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
});
