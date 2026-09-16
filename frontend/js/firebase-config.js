// Import the Firebase functions we need from the Firebase CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCpsa4R-UDaH_K_sXIvatpSfkTFk_98LpY",
  authDomain: "truthlens-e4814.firebaseapp.com",
  projectId: "truthlens-e4814",
  storageBucket: "truthlens-e4814.firebasestorage.app",
  messagingSenderId: "607892268154",
  appId: "1:607892268154:web:6e1d77e992ac567e0007c3"
};

// Initialize Firebase and export the "auth" and "db" objects so other files can use them
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);