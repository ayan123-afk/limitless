
import { firebaseConfig } from "./config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, getDocs,
  addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const pageStatus = document.getElementById("pageStatus");
const productList = document.getElementById("productList");
const productForm = document.getElementById("productForm");
const addButton = document.getElementById("addProductButton");
const productMessage = document.getElementById("productMessage");

let currentUser = null;
let ready = false;

function setStatus(text) {
  pageStatus.textContent = text;
}

function showProductMessage(text) {
  productMessage.textContent = text;
}

function safeText(value) {
  return String(value ?? "");
}

async function isAdmin(user) {
  const snap = await getDoc(doc(db, "admins", user.uid));
  return snap.exists() && snap.data().active === true;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("/admin");
    return;
  }

  try {
    if (!(await isAdmin(user))) {
      await signOut(auth);
      window.location.replace("/admin");
      return;
    }

    currentUser = user;
    ready = true;
    setStatus("Signed in as " + user.email);
    await loadProducts();
  } catch (error) {
    console.error("Admin verification failed:", error);
    setStatus("Could not verify admin access: " + (error.code || error.message));
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("/admin");
});

document.getElementById("refreshButton").addEventListener("click", loadProducts);

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!ready || !currentUser) {
    showProductMessage("Admin verification abhi complete nahi hui.");
    return;
  }

  const name = document.getElementById("productName").value.trim();
  const price = Number(document.getElementById("productPrice").value);
  const image = document.getElementById("productImage").value.trim();
  const category = document.getElementById("productCategory").value.trim();
  const description = document.getElementById("productDescription").value.trim();

  if (!name || !Number.isFinite(price) || price <= 0) {
    showProductMessage("Product name aur valid price enter karo.");
    return;
  }

  addButton.disabled = true;
  showProductMessage("Saving product...");

  try {
    await addDoc(collection(db, "products"), {
      name,
      price,
      image,
      category,
      description,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    productForm.reset();
    showProductMessage("Product successfully added.");
    await loadProducts();
  } catch (error) {
    console.error("Product save failed:", error);
    showProductMessage("Save failed: " + (error.code || error.message));
  } finally {
    addButton.disabled = false;
  }
});

async function loadProducts() {
  if (!ready) return;

  productList.textContent = "Loading products...";

  try {
    const snapshot = await getDocs(collection(db, "products"));
    productList.replaceChildren();

    if (snapshot.empty) {
      productList.textContent = "Abhi koi product nahi hai.";
      return;
    }

    snapshot.forEach((productDoc) => {
      const data = productDoc.data();
      const row = document.createElement("div");
      row.className = "item";

      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = safeText(data.name || "Unnamed product");

      const price = document.createElement("div");
      price.className = "muted";
      price.textContent = "PKR " + Number(data.price || 0).toLocaleString();

      details.append(name, price);

      const remove = document.createElement("button");
      remove.className = "delete";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!confirm("Is product ko delete karna hai?")) return;

        remove.disabled = true;
        try {
          await deleteDoc(doc(db, "products", productDoc.id));
          await loadProducts();
        } catch (error) {
          console.error(error);
          setStatus("Delete failed: " + (error.code || error.message));
          remove.disabled = false;
        }
      });

      row.append(details, remove);
      productList.append(row);
    });
  } catch (error) {
    console.error("Product loading failed:", error);
    productList.textContent =
      "Products load nahi huay: " + (error.code || error.message);
  }
}
