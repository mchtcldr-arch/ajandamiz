/* Bildirim service worker'ı — uygulama kapalıyken gelen bildirimleri gösterir.
 * Bildirim içeriği sunucudan (functions/index.js) "notification" olarak gelir;
 * Firebase Messaging onu kendiliğinden gösterir, tıklanınca uygulama açılır. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
importScripts('config.js');

firebase.initializeApp(self.CIFT_AJANDA_CONFIG.firebase);
firebase.messaging();
