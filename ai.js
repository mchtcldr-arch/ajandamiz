/* Gemini istemcisi — doğrudan tarayıcıdan Google Gemini API'ye bağlanır.
 * Anahtar kullanıcıya aittir (Ayarlar ekranı); kodda veya repoda durmaz.
 *  - listModels      : anahtarın erişebildiği modelleri getirir
 *  - search          : Google Arama ile desteklenen (grounded) yanıt + kaynaklar
 *  - runAgent        : fonksiyon çağrılı (agentic) döngü — uygulamada işlem yapar
 *  - findDiscounts   : 5 markette indirim araştırması
 *  - dailyQuote      : günün özlü sözü */
window.CA_AI = (function () {
  'use strict';
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/';

  async function call(key, path, body) {
    let r;
    try {
      r = await fetch(BASE + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Gemini sunucusuna ulaşılamadı (internet bağlantısı?)');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || 'HTTP ' + r.status;
      if (r.status === 400 && /API key/i.test(msg)) throw new Error('API anahtarı geçersiz.');
      if (r.status === 429) throw new Error('Gemini kotası doldu, biraz sonra tekrar deneyin.');
      throw new Error(msg);
    }
    return j;
  }

  async function listModels(key) {
    const j = await call(key, 'models?pageSize=200');
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
      .filter((m) => !/(image|tts|audio|live|embedding|robotics|computer-use)/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
  }

  // En yeni kararlı "flash" modelini seç (hızlı ve ucuz; arama + araç çağırma destekli).
  function pickDefault(models) {
    const ver = (id) => { const m = id.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    const stable = (id) => !/(preview|exp|lite|thinking|latest)/i.test(id);
    const ranked = models.slice().sort((a, b) => ver(b.id) - ver(a.id));
    const pick = ranked.find((m) => /flash/.test(m.id) && stable(m.id))
      || ranked.find((m) => /flash/.test(m.id))
      || ranked[0];
    return pick ? pick.id : '';
  }

  const generate = (key, model, body) => call(key, `models/${encodeURIComponent(model)}:generateContent`, body);

  function textOf(resp) {
    const parts = (resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts) || [];
    return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
  }
  function sourcesOf(resp) {
    const chunks = (resp.candidates && resp.candidates[0] && resp.candidates[0].groundingMetadata
      && resp.candidates[0].groundingMetadata.groundingChunks) || [];
    const seen = new Set();
    const out = [];
    for (const c of chunks) {
      if (!c.web || !c.web.uri || seen.has(c.web.uri)) continue;
      seen.add(c.web.uri);
      out.push({ title: c.web.title || c.web.uri, uri: c.web.uri });
    }
    return out;
  }
  function parseJson(text) {
    if (!text) return null;
    const s = text.indexOf('{'); const e = text.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
  }

  async function search(key, model, prompt) {
    const r = await generate(key, model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    });
    return { text: textOf(r), sources: sourcesOf(r) };
  }

  /* Agentic döngü: model araç çağırır → execute() çalıştırır → sonucu modele
   * geri verir; model son yanıtı yazana kadar (en fazla maxSteps tur). */
  async function runAgent({ key, model, system, history, tools, execute, maxSteps = 6 }) {
    const contents = history.slice();
    const sources = [];
    for (let step = 0; step < maxSteps; step++) {
      const r = await generate(key, model, {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: tools }],
      });
      const cand = r.candidates && r.candidates[0];
      if (!cand || !cand.content || !cand.content.parts) {
        const why = (cand && cand.finishReason) || (r.promptFeedback && r.promptFeedback.blockReason) || 'boş yanıt';
        throw new Error('Model yanıt vermedi (' + why + ')');
      }
      contents.push(cand.content); // düşünce imzaları dahil olduğu gibi geri gönderilmeli
      const calls = cand.content.parts.filter((p) => p.functionCall);
      if (!calls.length) return { text: textOf(r), sources };
      const responses = [];
      for (const p of calls) {
        const fc = p.functionCall;
        let out;
        try { out = await execute(fc.name, fc.args || {}); }
        catch (e) { out = { error: e.message }; }
        if (out && Array.isArray(out.sources)) sources.push(...out.sources);
        if (!out || typeof out !== 'object' || Array.isArray(out)) out = { result: out };
        responses.push({ functionResponse: { name: fc.name, response: out, ...(fc.id ? { id: fc.id } : {}) } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    return { text: 'İşlemleri yaptım ama adım sınırına ulaştım; gerekirse tekrar sorun.', sources };
  }

  const MARKETS = ['Migros', 'ŞOK', 'BİM', 'CarrefourSA', 'A101'];

  async function findDiscounts(key, model, items, dateStr) {
    const list = items.length ? items.join(', ') : '(liste boş)';
    const prompt = `Bugünün tarihi ${dateStr}. Türkiye'deki ${MARKETS.join(', ')} marketlerinin ŞU AN GEÇERLİ indirim, kampanya ve aktüel ürünlerini Google'da ara (resmi siteler, aktüel katalog ve kampanya sayfaları, güvenilir haber/derleme siteleri).

Alışveriş listemiz: ${list}

1) Listemizdeki ürünler için bu marketlerde geçerli indirim/kampanya var mı bul (en uygun olanı öne al).
2) Ardından bu hafta dikkat çeken 3-5 genel fırsat ekle (forList: false).

Kurallar: Yalnızca kaynaklarda gördüğün bilgileri yaz. Fiyat görmediysen "price" alanını boş bırak, UYDURMA. Geçerlilik tarihini biliyorsan yaz. Eski tarihli kampanyaları alma.
Yanıtı SADECE aşağıdaki JSON biçiminde ver, başka metin ekleme:
{"items":[{"product":"","market":"","deal":"","price":"","valid":"","forList":true}],"summary":"listemiz için 1-2 cümlelik Türkçe alışveriş tavsiyesi"}`;
    const { text, sources } = await search(key, model, prompt);
    const j = parseJson(text);
    const items2 = j && Array.isArray(j.items) ? j.items.filter((x) => x && x.product).slice(0, 25) : [];
    return {
      items: items2.map((x) => ({
        product: String(x.product || ''), market: String(x.market || ''), deal: String(x.deal || ''),
        price: String(x.price || ''), valid: String(x.valid || ''), forList: !!x.forList,
      })),
      summary: j ? String(j.summary || '') : '',
      raw: j ? '' : text,
      sources: sources.slice(0, 10),
    };
  }

  async function dailyQuote(key, model, dateStr) {
    const r = await generate(key, model, {
      contents: [{
        role: 'user',
        parts: [{ text: `${dateStr} günü için birlikte yaşayan bir çiftin sabah okuyacağı, Türkçe, kısa (en fazla 25 kelime), umut ve sevgi dolu bir özlü söz seç. Bir atasözü, deyim ya da sözü kesin bilinen bir yazar olabilir. Sözün sahibinden emin değilsen yazar olarak "Anonim" yaz; kimseye yanlış atfetme. Sadece JSON ver: {"text":"...","author":"..."}` }],
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 1 },
    });
    const j = parseJson(textOf(r));
    return j && j.text ? { text: String(j.text), author: String(j.author || 'Anonim') } : null;
  }

  return { listModels, pickDefault, search, runAgent, findDiscounts, dailyQuote, MARKETS };
})();
