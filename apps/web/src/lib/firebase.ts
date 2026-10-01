import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";

// Next.js inlines NEXT_PUBLIC_* env vars at build time, and this module is
// imported during `next build`'s page-data-collection pass even for pages
// that are later marked dynamic -- so without a real Firebase project
// configured, `getAuth()` throws `auth/invalid-api-key` and fails the build
// outright. Falling back to a syntactically-valid placeholder config keeps
// `npm run build` (and CI) green with no real Firebase project; real auth
// only works once real NEXT_PUBLIC_FIREBASE_* env vars are provided at
// build time. This is documented in the README, not hidden.
const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyDemoDemoDemoDemoDemoDemoDemoDemoDe",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "demo.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-project",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:000000000000:web:0000000000000000000000",
};

export const firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
