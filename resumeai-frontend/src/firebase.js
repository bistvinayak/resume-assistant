import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCavPS5aAp_E4MyYOXhMrjB822rUQ_-cIs",
  authDomain: "resume-assist-f8361.firebaseapp.com",
  projectId: "resume-assist-f8361",
  storageBucket: "resume-assist-f8361.firebasestorage.app",
  messagingSenderId: "560868286991",
  appId: "1:560868286991:web:7945c3cba27dc40614f97a",
  measurementId: "G-LMGL9KJG52"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const signOutUser = () => signOut(auth);
