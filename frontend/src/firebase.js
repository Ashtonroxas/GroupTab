// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";


// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBrG7TLc0eWz3P4b7ThSblu-zPM8mSCEZE",
  authDomain: "grouptab-5c0c2.firebaseapp.com",
  projectId: "grouptab-5c0c2",
  storageBucket: "grouptab-5c0c2.firebasestorage.app",
  messagingSenderId: "883294318725",
  appId: "1:883294318725:web:c59deb904b39a3af93b9ec"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);