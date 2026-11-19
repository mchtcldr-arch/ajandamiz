// Ajandamız ayarları — KURULUM.md adımlarını izleyerek doldurun.
//
// firebase: null bırakılırsa uygulama "Demo modu"nda çalışır: veriler sadece
// bu tarayıcıda saklanır, senkron yoktur. Denemek için idealdir.
//
// Firebase'deki apiKey gizli bir şifre değildir; asıl güvenlik
// firestore.rules içindeki e-posta izin listesidir.
window.CIFT_AJANDA_CONFIG = {
  firebase: {
    apiKey: "AIzaSyAqEuhSzuvhyUx05n3tvKPCo6ttgTo98qU",
    authDomain: "evim-e8613.firebaseapp.com",
    projectId: "evim-e8613",
    storageBucket: "evim-e8613.firebasestorage.app",
    messagingSenderId: "446681304392",
    appId: "1:446681304392:web:3da03b516f5883c0fff77d",
  },

  members: {
    // a = sen (mavi, nöbet günleri)   b = eşin (pembe, etkinlik günleri)
    // cycle: true → bu kişi için 🌸 regl/döngü takibi açılır (kayıtları sadece o girer)
    a: { name: "Mücahit", email: "mchtcldr@gmail.com", color: "#3b82f6", markLabel: "Nöbet", markIcon: "🩺" },
    b: { name: "Ece", email: "egrsl113@gmail.com", color: "#ec4899", markLabel: "Etkinlik", markIcon: "🎉", cycle: true },
  },
  bothColor: "#a855f7",
  // İlk açılışta hava durumu için varsayılan şehir (her cihaz Ayarlar'dan değiştirebilir). Boş: konum sorulur.
  weatherCity: "",
};
