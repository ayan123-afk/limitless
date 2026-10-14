
import { firebaseConfig } from "./config.js";

import {
  initializeApp,
  getApps
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const form = document.getElementById("adminLoginForm");
const button = document.getElementById("loginButton");
const message = document.getElementById("loginMessage");

function showMessage(text) {
  message.textContent = text;
  message.style.display = "block";
}

function friendlyError(error) {
  const code = error?.code || "";

  const errors = {
    "auth/invalid-credential":
      "Email ya password ghalat hai. Firebase Authentication mein account check karo.",
    "auth/user-not-found":
      "Is email ka account Firebase Authentication mein nahi mila.",
    "auth/wrong-password":
      "Password ghalat hai. Dobara check karo.",
    "auth/invalid-email":
      "Email address sahi format mein likho.",
    "auth/too-many-requests":
      "Bohat zyada login attempts hue hain. Kuch dair baad try karo.",
    "auth/network-request-failed":
      "Internet connection check karo aur dobara try karo.",
    "permission-denied":
      "Firestore ne access deny kiya. Admin document aur Firestore Rules check karo.",
    "unavailable":
      "Firebase filhal available nahi. Internet check karke dobara try karo."
  };

  return errors[code] ||
    `Login fail hua. Error: ${code || error?.message || "Unknown error"}`;
}

let auth;
let db;
let setupError = null;

try {
  if (!firebaseConfig ||
      !firebaseConfig.apiKey ||
      !firebaseConfig.projectId) {
    throw new Error(
      "config.js mein firebaseConfig incomplete hai."
    );
  }

  const app = getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig);

  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  setupError = error;
  console.error("Firebase setup error:", error);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  message.style.display = "none";

  if (setupError || !auth || !db) {
    showMessage(
      "Firebase setup nahi hua. config.js check karo. " +
      (setupError?.message || "")
    );
    return;
  }

  const email = document.getElementById("email")
    .value.trim();
  const password = document.getElementById("password")
    .value;

  if (!email || !password) {
    showMessage("Email aur password dono enter karo.");
    return;
  }

  button.disabled = true;
  button.textContent = "Checking...";

  try {
    await setPersistence(auth, browserLocalPersistence);

    const result = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    const user = result.user;

    const adminRef = doc(db, "admins", user.uid);
    const adminSnapshot = await getDoc(adminRef);

    if (!adminSnapshot.exists()) {
      await auth.signOut();
      showMessage(
        "Admin record nahi mila. Firestore mein admins collection " +
        "banao aur document ID mein is user ka exact UID rakho."
      );
      return;
    }

    if (adminSnapshot.data().active !== true) {
      await auth.signOut();
      showMessage(
        "Admin account inactive hai. admins document mein " +
        "active field ka type Boolean aur value true honi chahiye."
      );
      return;
    }

    button.textContent = "Opening dashboard...";
    window.location.replace("/admin/dashboard");

  } catch (error) {
    console.error("Admin login error:", error);
    showMessage(friendlyError(error));
  } finally {
    button.disabled = false;
    if (button.textContent !== "Opening dashboard...") {
      button.textContent = "Sign In";
    }
  }
});
