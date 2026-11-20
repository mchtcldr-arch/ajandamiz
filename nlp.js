/* Doğal dille hızlı ekleme — Türkçe cümleden görev bilgisi çıkarır (yapay zekâ yok, kurallar).
 *   "yarın akşam 8'de sinema ikimiz"  → { title: 'Sinema', date: yarın, time: '20:00', owner: 'both' }
 *   "market: süt, 2 ekmek, yumurta acil" → { kind: 'shopping', items: [...], urgent: true }
 * parse(metin, { today: 'YYYY-MM-DD', me: 'a'|'b', names: { a: 'Mücahit', b: 'Ece' } }) */
(function (root) {
  'use strict';
  const L = '\\p{L}';
  const B = `(?<![${L}\\d])`;           // kelime başı
  const E = `(?![${L}])`;               // kelime sonu
  const SUF = `(?:'?(?:de|da|te|ta|ye|ya|e|a|ne|na|ki|deki|daki|teki|taki|dan|den|tan|ten|günü))?`;
  const DAYS = ['pazar', 'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi'];
  const DAY_RE = '(pazartesi|cumartesi|pazar|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma)';
  const DAY_IDX = { pazar: 0, pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3, perşembe: 4, persembe: 4, cuma: 5, cumartesi: 6 };
  const MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
  const MONTH_RE = '(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)';
  const MONTH_IDX = (m) => {
    const plain = (s) => s.replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u');
    return MONTHS.findIndex((x) => plain(x) === plain(m));
  };

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const validDate = (y, m, d) => { const x = new Date(y, m - 1, d); return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d; };
  const lower = (s) => s.toLocaleLowerCase('tr-TR');
  const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1) : s);
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function parse(input, ctx) {
    const today = ctx.today;
    const names = ctx.names || {};
    const me = ctx.me || 'a';
    const other = me === 'a' ? 'b' : 'a';
    const raw = String(input || '').trim();
    const out = { kind: 'task', title: '', date: null, time: null, owner: null, chips: [] };
    if (!raw) return out;

    // ---- market: "market: süt, ekmek" / "al: ..." / "alışveriş: ..."
    const mk = raw.match(/^\s*(market|alışveriş|alisveris|al|🛒)\s*[:\-–]\s*(.+)$/iu);
    if (mk) {
      let rest = mk[2];
      const urgent = new RegExp(`${B}(acil|hemen)${E}`, 'iu').test(lower(rest));
      rest = rest.replace(new RegExp(`${B}(acil|hemen)${E}`, 'giu'), ' ');
      const items = rest.split(/,|;|\s+ve\s+|\n/u).map((s) => s.trim()).filter(Boolean);
      return { kind: 'shopping', items, urgent, chips: [`🛒 ${items.length} ürün`].concat(urgent ? ['⚡ acil'] : []) };
    }

    // Çalışma kopyası: eşleşen parçaları boşlukla değiştiririz (uzunluk korunur → başlık temizlenir)
    let low = lower(raw);
    let txt = raw.length === low.length ? raw : low;
    const take = (re, fn) => {
      const m = re.exec(low);
      if (!m) return false;
      if (fn(m) === false) return false;
      const blank = ' '.repeat(m[0].length);
      low = low.slice(0, m.index) + blank + low.slice(m.index + m[0].length);
      txt = txt.slice(0, m.index) + blank + txt.slice(m.index + m[0].length);
      return true;
    };
    const setTime = (h, mi) => { if (h > 23 || mi > 59) return false; out.time = `${pad(h)}:${pad(mi)}`; return true; };

    // ---- SAAT
    // "akşam 8", "öğleden sonra 3:30", "sabah 9'da", "gece 11"
    take(new RegExp(`${B}(sabah|öğleden sonra|ogleden sonra|öğlen|öğle|ogle|oglen|akşam|aksam|gece)\\s+(?:saat\\s*)?(\\d{1,2})(?:[:.](\\d{2}))?${SUF}${E}`, 'u'), (m) => {
      let h = +m[2]; const mi = m[3] ? +m[3] : 0; const p = m[1];
      if (/akşam|aksam|sonra/.test(p) && h < 12) h += 12;
      else if (/gece/.test(p)) { if (h >= 7 && h < 12) h += 12; }
      else if (/öğle|ogle/.test(p) && h <= 6) h += 12;
      return setTime(h, mi);
    });
    // "20:30", "saat 20.30", "9.30'da"
    if (!out.time) take(new RegExp(`${B}(?:saat\\s*)?(\\d{1,2})[:.](\\d{2})(?![.\\/]\\d)${SUF}${E}`, 'u'), (m) => {
      const h = +m[1]; const mi = +m[2];
      const hasSaat = /saat/.test(m[0]);
      // "15.12" tarih de olabilir: noktalıysa dakika 12'den büyük ya da 00 ise saat say
      if (!hasSaat && m[0].includes('.') && !(mi > 12 || mi === 0)) return false;
      return setTime(h, mi);
    });
    // "saat 8"
    if (!out.time) take(new RegExp(`${B}saat\\s*(\\d{1,2})${SUF}${E}`, 'u'), (m) => setTime(+m[1], 0));
    // tek başına "akşam", "sabah", "öğlen"
    if (!out.time) take(new RegExp(`${B}(sabah|öğlen|öğle|oglen|akşam|aksam)(?:ı|i|leyin|ları)?${E}`, 'u'), (m) => {
      const p = m[1];
      return setTime(/sabah/.test(p) ? 9 : /akşam|aksam/.test(p) ? 19 : 12, 0);
    });

    // ---- TARİH
    const t = today;
    const dow = parseYmd(t).getDay();
    take(new RegExp(`${B}(bugün|bugun|yarından sonra|yarindan sonra|öbür gün|öbürgün|obur gun|yarın|yarin)${SUF}${E}`, 'u'), (m) => {
      const w = m[1];
      out.date = /sonra|öbür|obur/.test(w) ? addDays(t, 2) : /yar/.test(w) ? addDays(t, 1) : t;
    });
    if (!out.date) take(new RegExp(`${B}(\\d{1,3})\\s*(gün|gun|hafta)\\s*sonra${E}`, 'u'), (m) => {
      out.date = addDays(t, +m[1] * (/hafta/.test(m[2]) ? 7 : 1));
    });
    if (!out.date) take(new RegExp(`${B}(?:(bu|gelecek|haftaya|önümüzdeki|onumuzdeki|seneye)\\s+)?${DAY_RE}${SUF}${E}`, 'u'), (m) => {
      const target = DAY_IDX[m[2]];
      let diff = (target - dow + 7) % 7;
      if (m[1] && m[1] !== 'bu') diff += diff === 0 ? 7 : (m[1] === 'haftaya' || m[1] === 'gelecek' ? 7 : 0);
      out.date = addDays(t, diff);
    });
    if (!out.date) take(new RegExp(`${B}(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?${SUF}${E}`, 'u'), (m) => {
      const d = +m[1]; const mo = MONTH_IDX(m[2]) + 1; let y = m[3] ? +m[3] : parseYmd(t).getFullYear();
      if (!validDate(y, mo, d)) return false;
      let s = `${y}-${pad(mo)}-${pad(d)}`;
      if (!m[3] && s < t) { y += 1; s = `${y}-${pad(mo)}-${pad(d)}`; }
      out.date = s;
    });
    if (!out.date) take(new RegExp(`${B}(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${SUF}${E}`, 'u'), (m) => {
      const d = +m[1]; const mo = +m[2];
      let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : parseYmd(t).getFullYear();
      if (!validDate(y, mo, d)) return false;
      let s = `${y}-${pad(mo)}-${pad(d)}`;
      if (!m[3] && s < t) { y += 1; s = `${y}-${pad(mo)}-${pad(d)}`; }
      out.date = s;
    });
    if (!out.date) take(new RegExp(`${B}ayın\\s+(\\d{1,2})(?:'?\\p{L}*)?${E}`, 'u'), (m) => {
      const base = parseYmd(t); let y = base.getFullYear(); let mo = base.getMonth() + 1; const d = +m[1];
      let s = `${y}-${pad(mo)}-${pad(d)}`;
      if (s < t) { mo += 1; if (mo > 12) { mo = 1; y += 1; } s = `${y}-${pad(mo)}-${pad(d)}`; }
      if (!validDate(y, mo, d)) return false;
      out.date = s;
    });
    if (!out.date) take(new RegExp(`${B}(haftaya|gelecek hafta|önümüzdeki hafta|onumuzdeki hafta)${E}`, 'u'), () => { out.date = addDays(t, 7); });

    // ---- KİMİN İŞİ
    const otherName = names[other] ? lower(names[other]) : null;
    const meName = names[me] ? lower(names[me]) : null;
    if (take(new RegExp(`${B}(ikimiz|ikimizin|ikimize|ikimizle|birlikte|beraber|ortak|biz|bizim|bize)${E}`, 'u'), () => { out.owner = 'both'; })) {
      // ok
    } else if (otherName && take(new RegExp(`${B}${escRe(otherName)}(?:'?[${L}]{0,6})?(?:\\s+için)?${E}`, 'u'), () => { out.owner = other; })) {
      // ok
    } else if (take(new RegExp(`${B}(eşim|eşime|eşimin|esim|esime)(?:\\s+için)?${E}`, 'u'), () => { out.owner = other; })) {
      // ok
    } else if (meName && take(new RegExp(`${B}${escRe(meName)}(?:'?[${L}]{0,6})?(?:\\s+için)?${E}`, 'u'), () => { out.owner = me; })) {
      // ok
    } else {
      take(new RegExp(`${B}(ben|bana|benim)(?:\\s+için)?${E}`, 'u'), () => { out.owner = me; });
    }

    // ---- BAŞLIK
    let title = txt.replace(/\s+/g, ' ').trim()
      .replace(/^(ve|ile|için|,|-|–)\s+/iu, '').replace(/\s+(ve|ile|için|,|-|–)$/iu, '')
      .replace(/^[,.\-–:;\s]+|[,.\-–:;\s]+$/g, '');
    out.title = cap(title);

    if (out.date) {
      const diff = Math.round((parseYmd(out.date) - parseYmd(t)) / 864e5);
      const label = diff === 0 ? 'Bugün' : diff === 1 ? 'Yarın' : diff > 1 && diff < 7
        ? cap(DAYS[parseYmd(out.date).getDay()])
        : parseYmd(out.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      out.chips.push('📅 ' + label);
    }
    if (out.time) out.chips.push('🕑 ' + out.time);
    if (out.owner) out.chips.push(out.owner === 'both' ? '👥 Ortak' : out.owner === me ? '👤 Ben' : '👤 ' + (names[other] || 'Eşim'));
    return out;
  }

  root.CA_NLP = { parse };
  if (typeof module !== 'undefined') module.exports = { parse };
})(typeof self !== 'undefined' ? self : globalThis);
