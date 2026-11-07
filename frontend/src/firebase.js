import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Validate required environment variables
const requiredEnvVars = [
  'VITE_API_KEY',
  'VITE_AUTH_DOMAIN',
  'VITE_PROJECT_ID',
  'VITE_MESSAGING_SENDER_ID',
  'VITE_APP_ID'
];

const missingEnvVars = requiredEnvVars.filter(
  varName => !import.meta.env[varName]
);

let firebaseConfigurationError = missingEnvVars.length > 0
  ? `Missing Firebase settings: ${missingEnvVars.join(', ')}`
  : null;

if (firebaseConfigurationError) {
  console.error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}\n` +
    `Please check your .env file and ensure all Firebase credentials are set.`
  );
}

// Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

// Initialize Firebase with error handling
let app, auth, db, googleProvider;

if (!firebaseConfigurationError) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    googleProvider = new GoogleAuthProvider();
    googleProvider.addScope('profile');
    googleProvider.addScope('email');

    setPersistence(auth, browserLocalPersistence)
      .catch(error => console.warn('Could not set Firebase persistence:', error));

  } catch (error) {
    console.error('Failed to initialize Firebase:', error);
    firebaseConfigurationError = 'Firebase could not start. Verify the Firebase settings for this environment.';
  }
}

export { auth, googleProvider, db, firebaseConfigurationError };
