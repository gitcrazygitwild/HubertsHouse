// Public configuration only. Never put an Apple password or server secret here.
export const config = {
  firebase: {
    apiKey: "AIzaSyBEXNyX6vIbHwGCpI3fpVUb5llubOjt9qQ",
    authDomain: "huberts-house.firebaseapp.com",
    projectId: "huberts-house",
    storageBucket: "huberts-house.firebasestorage.app",
    messagingSenderId: "233498547172",
    appId: "1:233498547172:web:e250d2f14b0e19c6322df1"
  },
  functionsRegion: "us-central1",
  // Set true after completing docs/SETUP.md. The UI never claims a connection
  // or accepts an Apple credential until the private service is deployed.
  calendarServiceEnabled: true
};
