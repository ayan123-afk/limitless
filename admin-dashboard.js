
import { firebaseConfig } from "./config.js";

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, getDocs,
  addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

const pageStatus = document.getElementById("pageStatus");
const productList = document.getElementById("productList");
const productForm = document.getElementById("productForm");
const productMessage = document.getElementById("productMessage");
const addButton = document.getElementById("addProductButton");

let currentUser = null;
let verified = false;

function setStatus(text) {
  pageStatus.textContent = text;
}

async function verifyAdmin(user) {
  const snap = await getDoc(doc(db, "admins", user.uid));
  return snap.exists() && snap.data().active === true;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("/admin");
    return;
  }

  try {
    if (!(await verifyAdmin(user))) {
      await signOut(auth);
      window.location.replace("/admin");
      return;
    }

    currentUser = user;
    verified = true;
    setStatus("Admin verified: " + (user.email || "Signed in"));
    await loadProducts();
  } catch (error) {
    console.error("Admin verification error:", error);
    setStatus("Verification failed: " + (error.code || error.message));
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("/admin");
  } catch (error) {
    setStatus("Logout failed: " + (error.code || error.message));
  }
});

document.getElementById("refreshButton").addEventListener("click", loadProducts);

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!verified || !currentUser) {
    productMessage.textContent = "Admin access verify hone ka wait karo.";
    return;
  }

  const name = document.getElementById("productName").value.trim();
  const price = Number(document.getElementById("productPrice").value);
  const image = document.getElementById("productImage").value.trim();
  const category = document.getElementById("productCategory").value.trim();
  const description = document.getElementById("productDescription").value.trim();

  if (!name || !Number.isFinite(price) || price <= 0) {
    productMessage.textContent = "Valid product name aur price enter karo.";
    return;
  }

  addButton.disabled = true;
  productMessage.textContent = "Saving...";

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
    productMessage.textContent = "Product added successfully.";
    await loadProducts();
  } catch (error) {
    console.error("Product save error:", error);
    productMessage.textContent =
      "Save failed: " + (error.code || error.message);
  } finally {
    addButton.disabled = false;
  }
});

async function loadProducts() {
  if (!verified) return;

  productList.textContent = "Loading products...";

  try {
    const snapshot = await getDocs(collection(db, "products"));
    productList.replaceChildren();

    if (snapshot.empty) {
      productList.textContent = "No products yet.";
      return;
    }

    snapshot.forEach((productDoc) => {
      const data = productDoc.data();

      const row = document.createElement("div");
      row.className = "item";

      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = data.name || "Unnamed product";

      const price = document.createElement("small");
      price.textContent =
        "PKR " + Number(data.price || 0).toLocaleString();

      details.append(name, price);

      const removeButton = document.createElement("button");
      removeButton.className = "delete";
      removeButton.textContent = "Delete";

      removeButton.addEventListener("click", async () => {
        if (!confirm("Delete this product?")) return;

        removeButton.disabled = true;

        try {
          await deleteDoc(doc(db, "products", productDoc.id));
          await loadProducts();
        } catch (error) {
          console.error("Product delete error:", error);
          setStatus("Delete failed: " + (error.code || error.message));
          removeButton.disabled = false;
        }
      });

      row.append(details, removeButton);
      productList.append(row);
    });
  } catch (error) {
    console.error("Product load error:", error);
    productList.textContent =
      "Could not load products: " + (error.code || error.message);
  }
}
