# Kurulum (Faz 0) — yaklaşık 20 dakika

Uygulamayı önce hiçbir şey kurmadan **Demo modunda** deneyebilirsiniz:
klasörü bir sunucuyla açın (`npx serve .` ya da `python3 -m http.server`) veya
yayınlandığı adrese gidin. İkiniz gerçekten ortak kullanmak için aşağıdaki
adımları bir kez yapmanız yeterli.

## 1. Firebase projesi
1. <https://console.firebase.google.com> → **Proje ekle** → isim: `ajandamiz`
   (Google Analytics gerekmez, kapatabilirsiniz).
2. Sol menü **Build → Authentication → Get started → Sign-in method →
   Google → Enable** → destek e-postasını seçip kaydedin.
3. **Build → Firestore Database → Create database** → konum
   `eur3 (europe-west)` → **production mode** ile başlatın.
4. Firestore'da **Rules** sekmesine `firestore.rules` dosyasının içeriğini
   yapıştırın, e-posta adreslerini kendinizinkiyle değiştirin (`myKey()` içindeki
   ilk e-posta dahil — o kişi `a` olur, yani mavi/nöbet) → **Publish**.

## 2. Web uygulaması kaydı
1. Proje ana sayfasında **</> (Web)** simgesi → takma ad `ajandamiz-web`
   (Hosting kutusunu işaretlemenize gerek yok).
2. Gösterilen `firebaseConfig` nesnesinden `apiKey`, `authDomain`,
   `projectId`, `appId` değerlerini `config.js` içindeki `firebase:` alanına
   yazın.
3. `config.js` → `members` kısmına iki ismi ve **firestore.rules'taki ile aynı**
   e-postaları yazın. Renkleri isterseniz değiştirin.

## 3. Yayınlama
**Seçenek A — GitHub Pages** (repo herkese açıksa ücretsiz):
1. GitHub'da repo → **Settings → Pages → Deploy from a branch → main / (root)**.
2. Adres: `https://<kullanıcı-adı>.github.io/calldr/cift-ajanda/`

**Seçenek B — Firebase Hosting** (repo gizli kalacaksa — önerilen):
```bash
npm i -g firebase-tools        # Node.js kurulu olmalı (nodejs.org)
firebase login
cd cift-ajanda
firebase use --add             # projeni seç, takma ad: default
firebase deploy                # uygulama + firestore.rules birlikte yayınlanır
```
Adres: `https://<proje-adi>.web.app`. Güncelleme için sadece `firebase deploy`.

## 4. Alan adını yetkilendirme
Firebase → **Authentication → Settings → Authorized domains** → yayın adresinizin
alan adını ekleyin (ör. `kullanici-adi.github.io`). Firebase Hosting
kullanıyorsanız zaten ekli.

## 5. Yapay zekâ (Gemini) — opsiyonel
1. <https://aistudio.google.com/apikey> → **Create API key** (Google hesabınla, ücretsiz katman yeterli).
2. Uygulamada sağ üstteki **⚙︎ Ayarlar** → anahtarı yapıştır → **Bağlan** → önerilen model seçilir → **Kaydet**.
3. Anahtar ortak veritabanınızda saklanır; eşin de asistanı kullanabilir. Repoya/`config.js`'e **yazma**.
4. Önerilir: Google Cloud Console → *APIs & Services → Credentials* → anahtarı
   **HTTP referrer** ile yayın adresinize (ör. `https://kullanici-adi.github.io/*`) ve
   yalnızca *Generative Language API* ile sınırlandırın.

Asistan, indirim avcısı ve günün sözü bu anahtarla çalışır; anahtar yoksa uygulamanın
geri kalanı aynen çalışır (günün sözü atasözlerinden gelir).

## 6. Telefona ekleme
- **iPhone (Safari):** Paylaş → *Ana Ekrana Ekle*
- **Android (Chrome):** ⋮ menü → *Uygulamayı yükle / Ana ekrana ekle*

## Güvenlik notları
- `config.js`'teki `apiKey` gizli değildir, herkese açık olması normaldir.
  Verinizi koruyan şey Firestore kurallarındaki e-posta listesidir.
- Kuralları değiştirdikten sonra Firebase konsolundaki **Rules Playground** ile
  "başka bir e-posta okuyabiliyor mu?" diye deneyebilirsiniz — reddetmeli.
- Ücretsiz plan (Spark) günde 50.000 okuma / 20.000 yazma verir; iki kişi için
  fazlasıyla yeterli, kredi kartı gerekmez.
