import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDyNiizUuQqHdgYAQqckIVYYpgV9kC3uG4",
  authDomain: "vegpick-f49b1.firebaseapp.com",
  projectId: "vegpick-f49b1",
  storageBucket: "vegpick-f49b1.firebasestorage.app",
  messagingSenderId: "441914305330",
  appId: "1:441914305330:web:0a785dbfd807e494b4852b",
  measurementId: "G-JHYYSGZF33"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, analytics, auth, db };
