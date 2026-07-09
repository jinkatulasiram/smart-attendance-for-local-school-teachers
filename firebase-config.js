/* =========================================================
   firebase-config.js — Firebase initialization
   NIAT Schools — Built by Tulasi Ram Web Designs
========================================================= */

// Prevent double initialization
if (!firebase.apps.length) {
  const firebaseConfig = {
    apiKey:            "AIzaSyCm04NqkZeQlyDRphq0-TP2gcdYkVXFXSs",
    authDomain:        "niat-schools.firebaseapp.com",
    projectId:         "niat-schools",
    storageBucket:     "niat-schools.firebasestorage.app",
    messagingSenderId: "661406974995",
    appId:             "1:661406974995:web:82b94fc1b178a6fb2cabe6",
    measurementId:     "G-M53BJY31DD"
  };
  firebase.initializeApp(firebaseConfig);
}

window.auth    = firebase.auth();
window.db      = firebase.firestore();
window.storage = firebase.storage ? firebase.storage() : null;


// Offline persistence (safe — errors silently ignored)
window.db.enablePersistence({ synchronizeTabs: true }).catch(e => {
  console.warn('Persistence not available:', e.code);
});

console.log('%c🔥 Firebase Ready', 'color:#7c3aed;font-weight:bold;font-size:14px;');
