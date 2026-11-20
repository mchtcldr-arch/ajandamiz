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

## 5. Bildirimler (Firebase Cloud Messaging)
Uygulama kapalıyken bildirim için küçük bir sunucu kodu (`functions/`) Firebase'e yüklenir.

1. **Blaze planı:** Firebase konsolu → sol altta **Spark → Yükselt → Blaze** → kart ekle.
   İki kişilik kullanımda ücretsiz kotalar içinde kalır; güvenlik için Google Cloud'da
   **Faturalandırma → Bütçeler ve uyarılar** ile 1 $'lık bütçe uyarısı kurun.
2. **VAPID anahtarı:** Proje ayarları → **Cloud Messaging** → **Web Push sertifikaları** →
   **Anahtar çifti oluştur** → çıkan anahtarı `config.js` içindeki `vapidKey` alanına yazın.
3. **Bölge:** Firestore Database sayfasında veritabanı konumuna bakın. `nam5` ise
   `functions/index.js` içindeki `REGION` olduğu gibi kalır (`us-central1`); `eur3` ise
   `europe-west1` yapın.
4. **Yükleme (kurulum gerektirmez):** <https://shell.cloud.google.com> (Google Cloud Shell) açın:
   ```bash
   git clone https://github.com/mchtcldr-arch/ajandamiz && cd ajandamiz
   (cd functions && npm ci)
   firebase login --no-localhost
   firebase deploy --only functions,firestore:rules --project evim-e8613
   ```
   "Container images cleanup policy" sorulursa **Y** deyin. İlk yükleme birkaç dakika sürer.
   Sonraki güncellemelerde: `git pull && firebase deploy --only functions,firestore:rules --project evim-e8613`
5. **Telefonda açma:** Uygulama → ⚙︎ Ayarlar → **🔔 Bildirimleri aç**.
   iPhone'da (iOS 16.4+) önce Safari'den **Ana Ekrana Ekle** yapıp uygulamayı ana ekrandaki
   ikondan açmanız gerekir; Safari sekmesinden bildirim açılamaz.

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
