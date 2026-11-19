// Accounts: Firebase Authentication with email and password. Firebase sends the
// verification and password-reset emails itself; the server checks the token
// sent with every call (backend/auth.py). The config below is public by design.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const auth = getAuth(initializeApp({"apiKey": "AIzaSyDgLIwl4glZsCuW7gzFgKuh8tnW1R0oEwE", "authDomain": "liza-tutor-web.firebaseapp.com", "projectId": "liza-tutor-web", "appId": "1:482721520907:web:cb249577710c0bbacbd60e"}));

// Resolves once Firebase knows whether someone is signed in on this browser.
export const ready = new Promise((resolve) => { const stop = onAuthStateChanged(auth, () => { stop(); resolve(); }); });

export const user = () => auth.currentUser;
export const verified = () => !!(auth.currentUser && auth.currentUser.emailVerified);

// The token for the API, refreshed by Firebase when it is near expiry.
export async function token() {
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

export async function signUp(email, password) {
  const { user: made } = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(made);
}

export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const resend = () => sendEmailVerification(auth.currentUser);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const leave = () => signOut(auth);

// After they click the link in the email: ask Firebase again, and take a fresh
// token that carries the verified flag.
export async function recheck() {
  if (!auth.currentUser) return false;
  await auth.currentUser.reload();
  if (auth.currentUser.emailVerified) await auth.currentUser.getIdToken(true);
  return auth.currentUser.emailVerified;
}

// Firebase's error codes, said plainly.
export function why(err) {
  const code = (err && err.code) || "";
  return {
    "auth/invalid-email": "That email address does not look right.",
    "auth/email-already-in-use": "There is already an account with that email. Sign in instead.",
    "auth/weak-password": "Use a password of at least 6 characters.",
    "auth/invalid-credential": "The email or password is not right.",
    "auth/wrong-password": "The email or password is not right.",
    "auth/user-not-found": "There is no account with that email.",
    "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
    "auth/network-request-failed": "No internet connection. Try again.",
    "auth/operation-not-allowed": "Email sign-in is not switched on yet.",
  }[code] || (err && err.message) || "Something went wrong.";
}
