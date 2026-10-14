
import { firebaseConfig } from "./config.js";

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const form = document.getElementById("adminLoginForm");
const button = document.getElementById("loginButton");
const status = document.getElementById("status");

function showMessage(message) {
  status.textContent = message;
  status.style.display = "block";
}

const friendlyErrors = {
  "auth/invalid-credential": "Email ya password ghalat hai.",
  "auth/invalid-email": "Email address ka format ghalat hai.",
  "auth/too-many-requests": "Bohat attempts hue. Thori dair baad try karo.",
  "auth/network-request-failed": "Internet connection check karo.",
  "permission-denied": "Firestore Rules ne request deny ki."
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  button.disabled = true;
  button.textContent = "Signing in...";
  status.style.display = "none";

  let auth;

  try {
    if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId) {
      throw new Error("config.js mein actual Firebase config missing hai.");
    }

    const app = getApps().length
      ? getApps()[0]
      : initializeApp(firebaseConfig);

    auth = getAuth(app);
    const db = getFirestore(app);

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const credential = await signInWithEmailAndPassword(
      auth, email, password
    );

    const adminSnapshot = await getDoc(
      doc(db, "admins", credential.user.uid)
    );

    if (!adminSnapshot.exists() ||
        adminSnapshot.data().active !== true) {
      await signOut(auth);
      throw new Error(
        "Admin permission missing. admins collection mein document ID user UID rakho aur active ko Boolean true set karo."
      );
    }

    showMessage("Login successful. Opening dashboard...");
    window.location.replace("/admin/dashboard");

  } catch (error) {
    console.error("LIMITLESS login error:", error);
    showMessage(
      friendlyErrors[error.code] ||
      `${error.code ? error.code + ": " : ""}${error.message || "Login failed."}`
    );
  } finally {
    button.disabled = false;
    button.textContent = "Sign In";
  }
});
