# Ajandamız — Yol Haritası

İki kişiye (eşimle bana) özel, internetten her cihazdan erişilen, ortak
yapılacaklar listesi + takvim uygulaması.

## 1. Amaç

| # | Hedef | Ölçüt |
|---|-------|-------|
| 1 | **Sadece ikimize özel** | Yalnızca iki Google hesabı giriş yapabilir; veritabanı kuralları başkasını reddeder. |
| 2 | **Anlık ortak senkron** | Biri görev ekleyince/işaretleyince diğerinin ekranında 1–2 sn içinde görünür. |
| 3 | **Telefonda uygulama gibi** | "Ana ekrana ekle" ile ikon; mobil öncelikli tasarım; internet yokken de açılır. |
| 4 | **Ücretsiz ve bakımsız** | Sunucu yok, aylık ücret yok (Firebase ücretsiz planı iki kişiye fazlasıyla yeter). |
| 5 | **Basit** | 3 ekran, 1 ekleme butonu. Yeni bir şey öğrenmeden kullanılabilir. |

**Kapsam dışı (şimdilik):** çok kullanıcılı/aile planları, sohbet, dosya ekleri.

## 2. Mimari kararlar

```
 Telefon / Bilgisayar (tarayıcı, PWA)
 ┌─────────────────────────────────┐
 │ index.html + app.js (vanilla JS)│   derleme adımı yok, tek klasör
 │   └─ store: Demo (localStorage) │   ← config boşsa, hemen denenebilir
 │   └─ store: Bulut (Firestore)   │   ← config doluysa
 └──────────────┬──────────────────┘
                │ gerçek zamanlı dinleme (onSnapshot)
 ┌──────────────▼──────────────────┐
 │ Firebase                        │
 │  • Authentication: Google ile   │
 │  • Firestore: "tasks" koleksiyonu│
 │  • Güvenlik kuralı: 2 e-posta   │
 └─────────────────────────────────┘
 Barındırma: GitHub Pages veya Firebase Hosting (ücretsiz)
```

- **Neden Firebase?** Giriş + gerçek zamanlı veritabanı + çevrimdışı önbellek
  hazır geliyor; sunucu kodu yazmıyoruz. Alternatif Supabase'di; Firestore'un
  çevrimdışı desteği ve tek dosyadan yüklenebilmesi daha basit.
- **Neden framework yok?** Önceki araçlar gibi: dosyayı aç, çalışsın. Uygulama
  küçük kalacak; React/derleme zinciri bakım yükü getirir.
- **Gizlilik:** `apiKey` gizli bir anahtar değildir; asıl koruma
  `firestore.rules` içindeki e-posta izin listesidir.

## 3. Veri modeli

`tasks/{id}`

| Alan | Tip | Açıklama |
|------|-----|----------|
| `title` | string | Görev başlığı (zorunlu) |
| `note` | string | Opsiyonel açıklama |
| `date` | `"YYYY-MM-DD"` \| null | Takvim günü; boşsa "Tarihsiz" havuzunda |
| `time` | `"HH:MM"` \| null | Opsiyonel saat |
| `owner` | `"a"` \| `"b"` \| `"both"` | Kimin işi |
| `done` | bool | Tamamlandı mı |
| `doneBy` | `"a"` \| `"b"` \| null | Kim tamamladı |
| `createdBy` | `"a"` \| `"b"` | Kim ekledi |
| `createdAt`, `updatedAt` | zaman damgası | |

Diğer koleksiyonlar:

| Koleksiyon | Alanlar |
|---|---|
| `shopping/{id}` | `name`, `qty`, `urgent`, `bought`, `boughtBy`, `boughtAt`, `addedBy` |
| `messages/{id}` | `text`, `from` (`a`/`b`/`ai`), `askedBy`, `actions[]`, `sources[]` |
| `marks/{YYYY-MM-DD_kişi}` | `date`, `owner`, `label` (Nöbet/Etkinlik) |
| `daily/{YYYY-MM-DD}` | günün sözü: `text`, `author`, `ai` |
| `private/ai` | Gemini `apiKey`, `model` (sadece ikimiz okuyabilir) |
| `aiCache/discounts` | son indirim araştırması |
| `cycle/{kişi}/days/{YYYY-MM-DD}` | `period`, `flow`, `symptoms[]` (sadece sahibi yazar) |
| `cycleSettings/{kişi}` | `share`, `cycleLen`, `periodLen` |

## 4. Tasarım

- **Renk dili:** her kişinin bir rengi var (mavi / pembe), ortak işler mor.
  Görevin onay dairesi, takvimdeki noktalar ve etiketler bu renkte.
- **"Ben" gösterimi:** giriş yapan kişi kendi işlerini "Ben", diğerininkini
  adıyla görür. Aynı ekran ikimiz için de doğal okunur.
- **Ekranlar (alt sekmeler):**
  1. **Bugün** — Gecikenler · Bugün (ilerleme çubuğu) · Bu hafta · Tarihsiz
  2. **Takvim** — Ay görünümü, günlerde renkli noktalar; güne dokununca
     o günün listesi altta açılır
  3. **Market** — Hemen alınacaklar / Alınması gerekenler + ✨ İndirim avcısı
  4. **Sohbet** — ikimiz + ✨ asistan aynı odada
  (Tüm görevler listesi Bugün ekranının altından açılır.)
- **Üst filtre:** Hepsi / Benim / Onun / Ortak
- **Ekleme:** sağ alttaki `+` → alttan açılan form: başlık, Bugün/Yarın/
  Tarihsiz kısayolları, tarih, saat, kimin işi, not.
- Açık/koyu tema sistemi takip eder.

## 5. Fazlar ve yapılacaklar

### Faz 0 — Kurulum (sen, ~20 dk) → `KURULUM.md`
- [ ] Firebase projesi oluştur, Google girişini aç
- [ ] Firestore veritabanını oluştur, `firestore.rules` kurallarını yapıştır (iki e-posta)
- [ ] `config.js` içine Firebase ayarlarını, isimleri ve e-postaları yaz
- [ ] Yayınla (GitHub Pages / Firebase Hosting), alan adını Firebase'de yetkilendir

### Faz 1 — MVP ✅ (bu commit)
- [x] Google ile giriş, izin listesi dışındakine "erişim yok" ekranı
- [x] Görev ekle / düzenle / sil / tamamla
- [x] Tarih, saat, kimin işi, not
- [x] Bugün, Takvim (ay), Tümü ekranları + kişi filtresi
- [x] Gerçek zamanlı senkron (Firestore) + çevrimdışı önbellek
- [x] Config boşken **Demo modu** (tarayıcıda saklar; iki sekme açıp iki kişiyi simüle edebilirsin)
- [x] Açık/koyu tema, ana ekrana eklenebilir manifest

### Faz 1.5 — Ortak yaşam paketi ✅ (bu commit)
- [x] **Market listesi:** ⚡ Hemen alınacaklar + 🛒 Alınması gerekenler, ikimiz de ekleriz, alındı/geri al, "2 ekmek" → miktar otomatik ayrışır
- [x] **Sohbet:** birbirimize anlık mesaj, okunmamış rozeti
- [x] **✨ Asistan (Gemini, agentic):** sohbette ✨ ya da `@asistan` ile; görev ekler/tamamlar, markete ürün ekler, nöbet/etkinlik işaretler, Google'da arar
- [x] **İndirim avcısı:** Migros · ŞOK · BİM · CarrefourSA · A101 kampanyalarını Google Arama ile tarar, listemizdekileri öne çıkarır, kaynak gösterir
- [x] **Günün sözü:** Gemini ile günde bir kez üretilir, ikimiz aynısını görürüz (anahtar yoksa atasözü)
- [x] **Takvim işaretleri:** 🩺 Nöbet (mavi, ben) · 🎉 Etkinlik (pembe, eşim); toplu işaretleme modu
- [x] Pembe–mor gradyent tema

### Faz 1.6 — 🌸 Döngü (regl) takibi ✅
- [x] Eşim için regl günleri, akış (az/orta/yoğun) ve belirtiler (kramp, baş ağrısı…)
- [x] Geçmiş döngülerden ortalama süreyi öğrenip sonraki regl, doğurgan dönem ve yumurtlama tahmini
- [x] Takvimde katman: düz kırmızı = regl, kesikli = tahmin, turkuaz = doğurgan, koyu turkuaz = yumurtlama
- [x] **Gizlilik:** kayıtları sadece eşim girer; "Eşimle paylaş" kapalıyken veritabanı kuralı bile bana okutmaz; yapay zekâya hiç gönderilmez
- [x] Paylaşım açıkken bana nazik hatırlatma: "regl dönemi ~2 gün sonra 💕"

### Faz 2 — Günlük kullanım konforu
- [ ] Service worker: internet yokken uygulama kabuğunun açılması (tam PWA)
- [ ] Tekrarlayan görevler (her gün/hafta/ay — "faturayı öde", "çöp")
- [ ] Ayrı listeler: Market, Ev işleri, Tatil planı…
- [ ] Ayarlar ekranı: isim ve renk değiştirme
- [ ] Sürükle-bırak ile tarih değiştirme (takvimde)

### Faz 3 — Hatırlatma ve entegrasyon
- [ ] Hatırlatıcı bildirimleri (Firebase Cloud Messaging + zamanlanmış fonksiyon)
- [ ] "Eşin görev ekledi" bildirimi
- [ ] Google Takvim'e .ics aboneliği / dışa aktarma
- [ ] Haftalık özet ("bu hafta 12 işi bitirdiniz")

### Faz 4 — Hayal listesi 💭
- [ ] **Nöbet çizelgesi fotoğrafından takvime:** hastanenin nöbet listesinin fotoğrafını çek, Gemini okuyup günleri işaretlesin
- [ ] **"Buzdolabında ne var?"** fotoğrafından tarif önerisi + eksikleri market listesine ekleme
- [ ] **Haftalık yemek planı** → malzemeleri otomatik market listesine
- [ ] **Ortak bütçe / harcama takibi**, market fişi fotoğrafından tutar okuma
- [ ] **Anılar & özel günler:** yıl dönümü, doğum günleri için geri sayım ve hediye fikri hatırlatıcısı
- [ ] **Nöbet sonrası mod:** nöbet ertesi gün eşe otomatik "bugün dinlenme günü" notu, görevleri hafifletme önerisi
- [ ] **Ruh hâli / enerji check-in'i:** günde bir emoji, haftalık ortak görünüm
- [ ] **Sesli ekleme:** "süt bitti" diye konuş, listeye düşsün
- [ ] **Konum hatırlatıcısı:** markete yaklaşınca "⚡ hemen alınacaklar" bildirimi
- [ ] **İstek listesi / tatil hayalleri panosu**, birlikte izlenecek dizi-film listesi
- [ ] **Hafta sonu planlayıcı:** asistan hava durumu ve boş günlere göre aktivite önersin

### Faz 5 — Cila
- [ ] Animasyonlar, tamamlama efekti
- [ ] Arama
- [ ] Yedekleme (JSON dışa/içe aktarma)

## 6. Çalışma şekli

Her faz küçük commit'lerle bu klasörde ilerler. Bir faz bitince ikiniz bir
hafta kullanıp neyin eksik olduğuna göre bir sonraki fazın sırası değişebilir —
bu liste bir sözleşme değil, pusula.
