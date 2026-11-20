# Ajandamız

İki kişiye özel, gerçek zamanlı senkronlanan ortak yapılacaklar listesi, takvim
(nöbet/etkinlik işaretleri), market listesi, pano (izlenecekler / istek listesi / tatil hayalleri),
ortak bütçe, sohbet, hava durumu ve bildirimler. Telefonda ana ekrana eklenip uygulama gibi kullanılır.

- **YOL-HARITASI.md** — amaç, tasarım, veri modeli ve fazlar
- **KURULUM.md** — Firebase + yayınlama adımları (bir kerelik)

## Dosyalar
| Dosya | Görev |
|-------|-------|
| `index.html` | Sayfa iskeleti |
| `styles.css` | Tasarım (açık/koyu tema) |
| `app.js` | Arayüz ve uygulama mantığı (görevler, takvim, döngü, market, sohbet, hava durumu) |
| `store.js` | Veri katmanı: Demo (localStorage) ve Bulut (Firestore) |
| `firebase-messaging-sw.js` | Uygulama kapalıyken bildirimleri gösteren service worker |
| `functions/` | Bildirim sunucusu (Cloud Functions): anlık bildirimler, hatırlatıcı, sabah özeti |
| `config.js` | Firebase ayarları, isimler, e-postalar, renkler |
| `firestore.rules` | Sadece iki e-postaya izin veren veritabanı kuralları |
| `manifest.webmanifest`, `icon.svg` | Ana ekrana ekleme |

## Hemen denemek
```bash
cd cift-ajanda
python3 -m http.server 8080   # sonra http://localhost:8080
```
`config.js` içinde `firebase: null` olduğu sürece **Demo modu** çalışır.
İki sekme açıp sağ üstteki rozete basarak birinde Kişi 1, diğerinde Kişi 2
olun — biri görev ekleyince diğer sekmede anında belirir.
