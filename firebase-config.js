// firebase-config.js — VESCO CONTROL V10.24
window.VESCO_FIREBASE_CONFIG = window.VESCO_FIREBASE_CONFIG || {
  apiKey: "AIzaSyDvQhoV0x6B9cTnouzvOxyfqXRtsG2nKq0",
  authDomain: "dashlogistica-49689.firebaseapp.com",
  databaseURL: "https://dashlogistica-49689-default-rtdb.firebaseio.com",
  projectId: "dashlogistica-49689",
  storageBucket: "dashlogistica-49689.firebasestorage.app",
  messagingSenderId: "833809141353",
  appId: "1:833809141353:web:c92b18ee10d9fc91c29cf8",
  measurementId: "G-NRYTBELTJ0"
};

(function(){
  if (window.firebase && !window.__vescoFirebaseReady) {
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.VESCO_FIREBASE_CONFIG);
      window.__vescoFirebaseReady = true;
      console.log("Firebase conectado com sucesso!");
    } catch(e) {
      console.warn("Firebase config falhou:", e);
    }
  }
})();
