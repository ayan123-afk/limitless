
import { firebaseConfig } from "./config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const form = document.getElementById("adminLoginForm");
const button = document.getElementById("loginButton");
const status = document.getElementById("status");

function showError(text) {
  status.textContent = text;
  status.style.display = "block";
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  event.stopPropagation();

  status.style.display = "none";
  button.disabled = true;
  button.textContent = "Signing in...";

  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const credential = await signInWithEmailAndPassword(auth, email, password);
    const user = credential.user;

    const adminDoc = await getDoc(doc(db, "admins", user.uid));

    if (!adminDoc.exists() || adminDoc.data().active !== true) {
      await signOut(auth);
      throw new Error("Admin permission missing. Check admins/{your-UID} and active: true.");
    }

    // Password is never added to the URL.
    window.location.replace("/admin/dashboard");
  } catch (error) {
    console.error("Login error:", error);
    const messages = {
      "auth/invalid-credential": "Email ya password ghalat hai.",
      "auth/invalid-email": "Email address sahi likho.",
      "auth/too-many-requests": "Bohat attempts hue. Thori dair baad try karo.",
      "auth/network-request-failed": "Internet connection check karo.",
      "permission-denied": "Firestore Rules ne request deny ki. Admin document aur rules check karo."
    };
    showError(messages[error.code] || error.message || "Login nahi ho saka.");
  } finally {
    button.disabled = false;
    button.textContent = "Sign In";
  }
});
