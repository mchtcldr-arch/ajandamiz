/* Market fişi okuyucu — fotoğraftaki yazıyı cihazın içinde okur (Tesseract OCR, yapay zekâ servisi yok),
 * içinden toplam tutarı, tarihi ve market adını çıkarır.
 *   CA_RECEIPT.recognize(file, onProgress) → okunan metin
 *   CA_RECEIPT.parse(metin) → { total, date, store, category } */
(function (root) {
  'use strict';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const STORES = [
    ['MIGROS', 'Migros'], ['MACROCENTER', 'Macrocenter'], ['CARREFOUR', 'CarrefourSA'], ['A101', 'A101'], ['A 101', 'A101'],
    ['BİM', 'BİM'], ['BIM ', 'BİM'], ['BIM\n', 'BİM'], ['BİRLEŞİK MAĞAZALAR', 'BİM'], ['BIRLESIK MAGAZALAR', 'BİM'],
    ['ŞOK', 'ŞOK'], ['SOK MARKET', 'ŞOK'], ['ŞOK MARKET', 'ŞOK'], ['HAKMAR', 'Hakmar'], ['METRO', 'Metro'],
    ['FİLE', 'File'], ['TARIM KREDİ', 'Tarım Kredi'], ['TARIM KREDI', 'Tarım Kredi'], ['ONUR MARKET', 'Onur Market'],
    ['GRATIS', 'Gratis'], ['WATSONS', 'Watsons'], ['ROSSMANN', 'Rossmann'], ['EVKUR', 'Evkur'], ['KİPA', 'Kipa'],
    ['ECZANE', 'Eczane'], ['OPET', 'Opet'], ['SHELL', 'Shell'], ['PETROL OFİSİ', 'Petrol Ofisi'], ['BP ', 'BP'],
  ];
  const CAT_BY_STORE = { Eczane: 'saglik', Opet: 'ulasim', Shell: 'ulasim', 'Petrol Ofisi': 'ulasim', BP: 'ulasim', Gratis: 'ev', Watsons: 'ev', Rossmann: 'ev' };

  const up = (s) => s.toLocaleUpperCase('tr-TR');
  // "1.234,56" / "1 234,56" / "*123,45" / "123.45" → sayı
  const AMOUNT = /\*?\s*(\d{1,3}(?:[.\s]\d{3})+|\d+)\s?[,.]\s?(\d{2})(?!\d)/g;
  const toNum = (int, dec) => parseFloat(int.replace(/[.\s]/g, '') + '.' + dec);

  function amountsIn(line) {
    const out = [];
    let m;
    AMOUNT.lastIndex = 0;
    while ((m = AMOUNT.exec(line))) out.push({ value: toNum(m[1], m[2]), star: m[0].includes('*') });
    return out;
  }

  function parse(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const U = lines.map(up);
    const res = { total: null, date: null, store: null, category: 'market' };

    // Market adı
    const all = U.join('\n') + '\n';
    for (const [k, name] of STORES) { if (all.includes(k)) { res.store = name; break; } }
    if (res.store && CAT_BY_STORE[res.store]) res.category = CAT_BY_STORE[res.store];

    // Toplam: önce "GENEL TOPLAM", sonra "TOPLAM"/"ÖDENECEK"/"TUTAR" (KDV ve ARA TOPLAM hariç)
    const rank = (u) => {
      if (/KDV|TOPKDV|ARA\s*TOP|ARATOP|İNDİRİM|INDIRIM|PARA\s*ÜSTÜ|PARA\s*USTU|NAKİT|NAKIT/.test(u)) return 0;
      if (/GENEL\s*TOP/.test(u)) return 4;
      if (/TOPLAM|TOPLAN|T0PLAM|TOPLM/.test(u)) return 3;
      if (/ÖDENECEK|ODENECEK|KREDİ\s*KART|KREDI\s*KART|K\.KART/.test(u)) return 2;
      if (/TUTAR/.test(u)) return 1;
      return 0;
    };
    let best = null;
    U.forEach((u, i) => {
      const r = rank(u);
      if (!r) return;
      // tutar aynı satırda yoksa bir sonraki satıra bak (OCR bazen ayırır)
      let am = amountsIn(lines[i]);
      if (!am.length && lines[i + 1]) am = amountsIn(lines[i + 1]);
      if (!am.length) return;
      const v = am[am.length - 1].value;
      if (!best || r > best.r || (r === best.r && v > best.v)) best = { r, v };
    });
    if (best) res.total = best.v;
    else {
      // yedek: yıldızlı en büyük tutar
      const stars = lines.flatMap(amountsIn).filter((a) => a.star).map((a) => a.value);
      if (stars.length) res.total = Math.max(...stars);
    }
    if (res.total != null && !(res.total > 0 && res.total < 1e6)) res.total = null;

    // Tarih: GG.AA.YYYY / GG/AA/YY / GG-AA-YYYY
    for (const l of lines) {
      const m = l.match(/(?<!\d)(\d{2})[./-](\d{2})[./-](\d{4}|\d{2})(?!\d)/);
      if (!m) continue;
      const d = +m[1]; const mo = +m[2]; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      const dt = new Date(y, mo - 1, d);
      if (dt.getMonth() === mo - 1 && dt.getDate() === d && y >= 2020 && y <= 2100) {
        res.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        break;
      }
    }
    return res;
  }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      if (root.Tesseract) return ok();
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Fiş okuyucu yüklenemedi (internet?)'));
      document.head.appendChild(s);
    });
  }

  // Büyük fotoğrafları küçült + gri tona çevir (daha hızlı ve isabetli)
  async function prepare(file) {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = () => fail(new Error('Fotoğraf açılamadı'));
      i.src = URL.createObjectURL(file);
    });
    const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const g = c.getContext('2d');
    g.filter = 'grayscale(1) contrast(1.25)';
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return c;
  }

  async function recognize(file, onProgress) {
    await loadScript(TESS);
    const canvas = await prepare(file);
    const r = await root.Tesseract.recognize(canvas, 'tur+eng', {
      logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); },
    });
    return r.data.text || '';
  }

  root.CA_RECEIPT = { parse, recognize };
  if (typeof module !== 'undefined') module.exports = { parse };
})(typeof self !== 'undefined' ? self : globalThis);
