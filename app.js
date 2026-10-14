
import { firebaseConfig, storeConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat(storeConfig.currencyLocale || "en-PK", {
  style: "currency", currency: storeConfig.currency || "PKR",
  maximumFractionDigits: 0
}).format(Number(value) || 0);
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[ch]));
const safeImage = value => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
};
const splitList = value => String(value || "").split(",").map(s => s.trim()).filter(Boolean);
const setStatus = (selector, message) => {
  const element = $(selector);
  if (element) element.textContent = message;
};

let db, auth, firebaseReady = false, currentUser = null, isAdmin = false;
let products = [], currentProduct = null, unsubscribeAuth = null;

try {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("ADD_")) {
    throw new Error("Firebase config missing. Add your Firebase Web App values in config.js.");
  }
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  firebaseReady = true;
} catch (error) {
  console.error(error);
  document.documentElement.dataset.firebase = "unconfigured";
}

const readCart = () => {
  try {
    const cart = JSON.parse(sessionStorage.getItem("limitless_cart") || "[]");
    return Array.isArray(cart) ? cart : [];
  } catch { return []; }
};
const saveCart = cart => {
  sessionStorage.setItem("limitless_cart", JSON.stringify(cart));
  updateCartCount();
};
const updateCartCount = () => {
  const count = readCart().reduce((total, item) => total + Math.max(0, Number(item.quantity) || 0), 0);
  $$("#cartCount").forEach(el => el.textContent = count);
};
const routePath = () => {
  const url = new URL(location.href);
  const params = url.searchParams;
  if (params.get("view")) return params.get("view");
  const path = location.pathname.replace(/\/+$/, "");
  if (path.startsWith("/product/")) return "product";
  if (path === "/cart") return "cart";
  if (path === "/checkout") return "checkout";
  if (path === "/reviews") return "reviews";
  return "shop";
};
const navigateView = view => {
  const url = view === "cart" ? "/shop?view=cart" :
              view === "checkout" ? "/shop?view=checkout" :
              view === "reviews" ? "/shop?view=reviews" : "/shop";
  history.pushState({}, "", url);
  renderShopRoute();
};
window.addEventListener("popstate", renderShopRoute);

async function getProducts() {
  if (!firebaseReady) throw new Error("Firebase config.js is not configured yet.");
  const snapshot = await getDocs(collection(db, "products"));
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
    .filter(item => item.active !== false);
}
async function getProductById(id) {
  const cached = products.find(item => item.id === id);
  if (cached) return cached;
  if (!firebaseReady) return null;
  const snapshot = await getDoc(doc(db, "products", id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}
const discountPercent = item => {
  const old = Number(item.oldPrice || 0), price = Number(item.price || 0);
  return old > price && old > 0 ? Math.round((old - price) / old * 100) : 0;
};
function productCard(item) {
  const image = safeImage(item.image) || storeConfig.logo;
  const discount = discountPercent(item);
  return `<article class="card product-card">
    <a href="/product/${encodeURIComponent(item.id)}" class="product-image">
      <img src="${escapeHTML(image)}" alt="${escapeHTML(item.title)}" loading="lazy">
      ${discount ? `<span class="pill">${discount}% OFF</span>` : ""}
    </a>
    <div class="info product-info">
      <h3><a href="/product/${encodeURIComponent(item.id)}">${escapeHTML(item.title || "Untitled product")}</a></h3>
      <div class="price">${money(item.price)} ${discount ? `<span class="old">${money(item.oldPrice)}</span>` : ""}</div>
      <div class="rating">★ ${Number(item.averageRating || 0).toFixed(1)} <span class="muted">(${Number(item.reviewCount || 0)} reviews)</span></div>
      <button class="btn full add-cart" data-id="${escapeHTML(item.id)}">ADD TO CART</button>
    </div>
  </article>`;
}
function bindAddCart(root = document) {
  $$(".add-cart", root).forEach(button => button.addEventListener("click", async () => {
    const item = await getProductById(button.dataset.id);
    if (!item) return alert("Product unavailable. Please refresh the shop.");
    if (Number(item.stock ?? 999) <= 0) return alert("This product is currently out of stock.");
    const cart = readCart();
    const found = cart.find(row => row.id === item.id);
    if (found) {
      if (Number(found.quantity) >= Number(item.stock ?? 999)) return alert("Available stock limit reached.");
      found.quantity++;
    } else {
      cart.push({ id: item.id, title: item.title, price: Number(item.price) || 0,
        image: safeImage(item.image) || storeConfig.logo, quantity: 1,
        size: "", color: "" });
    }
    saveCart(cart);
    button.textContent = "ADDED ✓";
    setTimeout(() => button.textContent = "ADD TO CART", 1000);
  }));
}
function renderProductGrid(items, container) {
  if (!container) return;
  container.innerHTML = items.length ? items.map(productCard).join("") :
    `<p class="muted">No products found. Add products from the admin dashboard.</p>`;
  bindAddCart(container);
}
async function loadShop() {
  const container = $("#products");
  const featured = $("#featuredProducts");
  if (!firebaseReady) {
    if (container) container.innerHTML = `<p class="muted">Connect Firebase in config.js to load the live catalogue.</p>`;
    return;
  }
  try {
    products = await getProducts();
    renderProductGrid(products, container);
    if (featured) renderProductGrid(products.slice(0, 4), featured);
    const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
    const select = $("#category");
    if (select) select.innerHTML = `<option value="">All categories</option>` +
      categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
  } catch (error) {
    console.error(error);
    if (container) container.innerHTML = `<p class="muted">Products could not be loaded. Check Firebase setup and Firestore rules.</p>`;
    if (featured) featured.innerHTML = `<p class="muted">Catalogue is temporarily unavailable.</p>`;
  }
}
function filterShop() {
  const search = ($("#search")?.value || "").toLowerCase().trim();
  const category = $("#category")?.value || "";
  const sort = $("#sort")?.value || "newest";
  let list = products.filter(item =>
    (!category || item.category === category) &&
    `${item.title || ""} ${item.description || ""} ${item.category || ""}`.toLowerCase().includes(search)
  );
  if (sort === "low") list.sort((a,b) => Number(a.price)-Number(b.price));
  if (sort === "high") list.sort((a,b) => Number(b.price)-Number(a.price));
  if (sort === "discount") list.sort((a,b) => discountPercent(b)-discountPercent(a));
  renderProductGrid(list, $("#products"));
}
async function showProduct(id) {
  const item = await getProductById(decodeURIComponent(id));
  const section = $("#productView"), detail = $("#productDetail");
  if (!section || !detail) return;
  $("#shopView")?.classList.add("hidden");
  section.classList.remove("hidden");
  if (!item) {
    detail.innerHTML = `<div><h1>Product not found</h1><p class="muted">This product may have been removed.</p></div>`;
    return;
  }
  currentProduct = item;
  const discount = discountPercent(item);
  const sizes = Array.isArray(item.sizes) ? item.sizes : splitList(item.sizes);
  const colors = Array.isArray(item.colors) ? item.colors : splitList(item.colors);
  detail.innerHTML = `<div><img src="${escapeHTML(safeImage(item.image) || storeConfig.logo)}" alt="${escapeHTML(item.title)}"></div>
  <div><p class="muted">LIMITLESS / ${escapeHTML(item.category || "COLLECTION")}</p>
  <h1>${escapeHTML(item.title)}</h1><div class="rating">★ ${Number(item.averageRating || 0).toFixed(1)} · ${Number(item.reviewCount || 0)} reviews</div>
  <h2>${money(item.price)} ${discount ? `<span class="old">${money(item.oldPrice)}</span>` : ""}</h2>
  ${discount ? `<p class="notice">${discount}% discount</p>` : ""}
  <p class="muted" style="line-height:1.9">${escapeHTML(item.description || "More product details will be added soon.")}</p>
  <p class="muted">${Number(item.stock ?? 0) > 0 ? `${Number(item.stock)} available` : "Stock status unavailable"}</p>
  ${sizes.length ? `<label>Size <select id="detailSize">${sizes.map(s=>`<option>${escapeHTML(s)}</option>`).join("")}</select></label>` : ""}
  ${colors.length ? `<label>Color <select id="detailColor">${colors.map(s=>`<option>${escapeHTML(s)}</option>`).join("")}</select></label>` : ""}
  <label>Quantity <input id="detailQty" type="number" min="1" max="${Math.max(1, Number(item.stock || 1))}" value="1" class="field"></label>
  <button class="btn full" id="detailAdd">ADD TO CART</button>
  <button class="btn secondary full" id="showReviews">READ / WRITE REVIEWS</button></div>`;
  $("#detailAdd")?.addEventListener("click", () => {
    const qty = Math.max(1, Number($("#detailQty")?.value) || 1);
    const stock = Number(item.stock ?? 0);
    if (stock <= 0 || qty > stock) return alert("Please select a quantity within available stock.");
    const cart = readCart(), existing = cart.find(row => row.id === item.id);
    const size = $("#detailSize")?.value || "", color = $("#detailColor")?.value || "";
    const keyMatch = row => row.id === item.id && row.size === size && row.color === color;
    const found = cart.find(keyMatch);
    if (found) found.quantity = Math.min(stock, found.quantity + qty);
    else cart.push({ id:item.id, title:item.title, price:Number(item.price)||0,
      image:safeImage(item.image)||storeConfig.logo, quantity:qty, size, color });
    saveCart(cart); alert("Added to your cart."); navigateView("cart");
  });
  $("#showReviews")?.addEventListener("click", () => {
    history.pushState({}, "", `/shop?view=reviews&product=${encodeURIComponent(item.id)}`);
    renderShopRoute();
  });
}
function cartTotals(cart) {
  const subtotal = cart.reduce((sum,item)=>sum+(Number(item.price)||0)*(Number(item.quantity)||0),0);
  const shipping = cart.length ? Number(storeConfig.defaultShipping || 0) : 0;
  return { subtotal, shipping, total: subtotal + shipping };
}
function renderCart() {
  const container = $("#cartItems");
  if (!container) return;
  const cart = readCart();
  container.innerHTML = cart.length ? cart.map((item,index)=>`
    <div class="cart-row">
      <img src="${escapeHTML(safeImage(item.image)||storeConfig.logo)}" alt="">
      <div><strong>${escapeHTML(item.title)}</strong><p class="muted">${item.size ? `Size: ${escapeHTML(item.size)}` : ""} ${item.color ? `Color: ${escapeHTML(item.color)}` : ""}</p><p>${money(item.price)}</p>
      <label class="muted">Qty <input class="field cart-qty" type="number" min="1" value="${Math.max(1,Number(item.quantity)||1)}" data-index="${index}"></label></div>
      <button class="btn secondary remove" data-remove="${index}">Remove</button>
    </div>`).join("") : `<p class="muted">Your cart is empty. <a href="/shop">Browse the collection</a>.</p>`;
  $("#subtotal").textContent = money(cartTotals(cart).subtotal);
  $$(".cart-qty",container).forEach(input=>input.addEventListener("change",()=>{
    const c=readCart(),i=Number(input.dataset.index);
    c[i].quantity=Math.max(1,Math.min(99,Number(input.value)||1));saveCart(c);renderCart();
  }));
  $$("[data-remove]",container).forEach(button=>button.addEventListener("click",()=>{
    const c=readCart();c.splice(Number(button.dataset.remove),1);saveCart(c);renderCart();
  }));
  const checkout = $("#goCheckout");
  if(checkout) checkout.disabled = !cart.length;
}
function renderCheckoutSummary() {
  const cart = readCart(), totals = cartTotals(cart);
  const container = $("#checkoutSummary");
  if (container) container.innerHTML = cart.map(item=>`<p>${escapeHTML(item.title)} × ${Number(item.quantity)} <strong style="float:right">${money(Number(item.price)*Number(item.quantity))}</strong></p>`).join("") +
    `<p>Subtotal <strong style="float:right">${money(totals.subtotal)}</strong></p><p>Shipping <strong style="float:right">${money(totals.shipping)}</strong></p>`;
  if ($("#checkoutTotal")) $("#checkoutTotal").textContent = money(totals.total);
}
async function submitCheckout(event) {
  event.preventDefault();
  if (!firebaseReady) return setStatus("#checkoutMessage","Firebase is not configured. Order was not submitted.");
  const cart = readCart();
  if (!cart.length) return setStatus("#checkoutMessage","Your cart is empty.");
  const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  const button = $("button[type=submit]",form) || $("button",form);
  if (button) button.disabled = true;
  setStatus("#checkoutMessage","Submitting your order…");
  try {
    const fresh = await Promise.all(cart.map(item=>getProductById(item.id)));
    if (fresh.some((p,i)=>!p || p.active === false || Number(p.stock ?? 0) < cart[i].quantity)) {
      throw new Error("One or more items are no longer available in the requested quantity. Refresh your cart.");
    }
    const totals = cartTotals(cart);
    const order = {
      customer: { name:String(data.name).trim(), phone:String(data.phone).trim(),
        email:String(data.email||"").trim(), address:String(data.address).trim(), city:String(data.city).trim() },
      items: cart.map(item=>({id:item.id,title:item.title,price:item.price,quantity:item.quantity,size:item.size||"",color:item.color||""})),
      subtotal: totals.subtotal, shipping: totals.shipping, total: totals.total,
      paymentMethod: data.payment, status: "pending", createdAt: serverTimestamp()
    };
    const result = await addDoc(collection(db,"orders"),order);
    sessionStorage.removeItem("limitless_cart");updateCartCount();
    history.pushState({}, "", "/shop?view=success");
    $("#checkoutView")?.classList.add("hidden");
    $("#successView")?.classList.remove("hidden");
    setStatus("#successText",`Order reference: ${result.id}. Save this reference for order support. The store will contact you to confirm delivery.`);
    form.reset();
  } catch(error) {
    console.error(error);
    setStatus("#checkoutMessage",error.message || "Could not submit the order. Please try again.");
  } finally { if(button) button.disabled = false; }
}
async function loadReviews() {
  const list = $("#reviewList"), productId = new URL(location.href).searchParams.get("product");
  if (!list) return;
  if (!firebaseReady || !productId) { list.innerHTML = `<p class="muted">Open reviews from a product page.</p>`; return; }
  try {
    const snap = await getDocs(query(collection(db,"reviews"),where("productId","==",productId)));
    const reviews = snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.approved === true);
    list.innerHTML = reviews.length ? reviews.map(r=>`<article class="box"><strong>${escapeHTML(r.name)}</strong> <span class="stars">${"★".repeat(Math.max(1,Math.min(5,Number(r.rating)||1)))}</span><p>${escapeHTML(r.text)}</p></article>`).join("") : `<p class="muted">No approved reviews yet.</p>`;
    $("#reviewForm")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const data=Object.fromEntries(new FormData(e.currentTarget));
      try {
        await addDoc(collection(db,"reviews"),{productId,name:String(data.name).trim(),rating:Number(data.rating),text:String(data.text).trim(),approved:false,createdAt:serverTimestamp()});
        e.currentTarget.reset();alert("Review submitted for moderation.");
      } catch(err) { console.error(err);alert("Review could not be submitted. Check Firestore rules."); }
    },{once:true});
  } catch(error) { console.error(error);list.innerHTML=`<p class="muted">Reviews unavailable.</p>`; }
}
function renderShopRoute() {
  const view = routePath();
  ["shopView","productView","cartView","checkoutView","successView","reviewsView"].forEach(id=>$("#"+id)?.classList.add("hidden"));
  if (view === "cart") { $("#cartView")?.classList.remove("hidden");renderCart(); }
  else if (view === "checkout") { $("#checkoutView")?.classList.remove("hidden");renderCheckoutSummary(); }
  else if (view === "product") showProduct(location.pathname.split("/").pop());
  else if (view === "reviews") { $("#reviewsView")?.classList.remove("hidden");loadReviews(); }
  else if (view === "success") $("#successView")?.classList.remove("hidden");
  else { $("#shopView")?.classList.remove("hidden"); }
}
$("#backShop")?.addEventListener("click",()=>{history.pushState({},"","/shop");renderShopRoute();});
$("#goCheckout")?.addEventListener("click",()=>{if(!readCart().length)return; navigateView("checkout");});
$("#checkoutForm")?.addEventListener("submit",submitCheckout);
$("#search")?.addEventListener("input",filterShop);
$("#category")?.addEventListener("change",filterShop);
$("#sort")?.addEventListener("change",filterShop);
$("#contactForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!firebaseReady)return setStatus("#message","Firebase is not configured. Message was not sent.");
  const form=event.currentTarget,data=Object.fromEntries(new FormData(form));
  try{
    await addDoc(collection(db,"messages"),{name:String(data.name).trim(),email:String(data.email).trim(),subject:String(data.subject).trim(),message:String(data.message).trim(),status:"unread",createdAt:serverTimestamp()});
    form.reset();setStatus("#message","Message sent successfully. Thank you for contacting LIMITLESS.");
  }catch(error){console.error(error);setStatus("#message","Message could not be sent. Please try WhatsApp support.");}
});
$("#year") && ($("#year").textContent=new Date().getFullYear());
updateCartCount();
if ($("#featuredProducts") || $("#products")) loadShop();
if ($("#shopView")) renderShopRoute();

async function hasAdminRole(user) {
  if (!user || !firebaseReady) return false;
  const snap = await getDoc(doc(db,"admins",user.uid));
  return snap.exists() && snap.data().active === true;
}
function showAdminSection(id) {
  $$(".section").forEach(section=>section.classList.toggle("active",section.id===id));
  $$(".sidebtn[data-section]").forEach(button=>button.classList.toggle("active",button.dataset.section===id));
  const title = $(`[data-section="${id}"]`)?.textContent || "Dashboard";
  if($("#sectionTitle"))$("#sectionTitle").textContent=title;
}
$$(".sidebtn[data-section]").forEach(button=>button.addEventListener("click",()=>showAdminSection(button.dataset.section)));
$("#adminLoginForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!firebaseReady)return setStatus("#loginMessage","Configure Firebase first in config.js.");
  const form=event.currentTarget,data=Object.fromEntries(new FormData(form));
  try{
    const credential=await signInWithEmailAndPassword(auth,String(data.email).trim(),data.password);
    const allowed=await hasAdminRole(credential.user);
    if(!allowed){await signOut(auth);throw new Error("This account does not have administrator permission.");}
    location.href="/admin/dashboard";
  }catch(error){console.error(error);setStatus("#loginMessage",error.message||"Sign-in failed.");}
});
$("#logoutButton")?.addEventListener("click",async()=>{if(auth)await signOut(auth);location.href="/admin";});

async function guardAdmin() {
  if(!$("#adminEmail"))return;
  if(!firebaseReady){setStatus("#dashboardMessage","Firebase config.js is missing or invalid.");return;}
  onAuthStateChanged(auth,async user=>{
    currentUser=user;
    if(!user){location.replace("/admin");return;}
    try{
      isAdmin=await hasAdminRole(user);
      if(!isAdmin){await signOut(auth);location.replace("/admin");return;}
      $("#adminEmail").textContent=user.email||"Administrator";
      await refreshDashboard();
    }catch(error){console.error(error);setStatus("#dashboardMessage","Could not verify administrator access. Check the admins collection and Firestore rules.");}
  });
}
async function refreshDashboard() {
  if(!isAdmin)return;
  try{
    const [p,o,m,r]=await Promise.all([
      getDocs(collection(db,"products")),getDocs(collection(db,"orders")),
      getDocs(collection(db,"messages")),getDocs(collection(db,"reviews"))
    ]);
    products=p.docs.map(d=>({id:d.id,...d.data()}));
    const orders=o.docs.map(d=>({id:d.id,...d.data()}));
    const messages=m.docs.map(d=>({id:d.id,...d.data()}));
    const reviews=r.docs.map(d=>({id:d.id,...d.data()}));
    $("#statProducts")&&($("#statProducts").textContent=products.length);
    $("#statOrders")&&($("#statOrders").textContent=orders.length);
    $("#statMessages")&&($("#statMessages").textContent=messages.filter(x=>x.status!=="read").length);
    $("#statPending")&&($("#statPending").textContent=orders.filter(x=>x.status==="pending").length);
    renderAdminProducts(products);renderAdminOrders(orders);renderAdminMessages(messages);renderAdminReviews(reviews);
  }catch(error){console.error(error);setStatus("#dashboardMessage","Unable to load admin data. Check Firestore rules and indexes.");}
}
function renderAdminProducts(items) {
  const tbody=$("#adminProductsTable");if(!tbody)return;
  tbody.innerHTML=items.map(item=>`<tr><td>${escapeHTML(item.title)}</td><td>${money(item.price)}</td><td>${Number(item.stock)||0}</td><td>${item.active===false?"Hidden":"Active"}</td><td><div class="table-actions"><button class="btn secondary" data-edit="${escapeHTML(item.id)}">Edit</button><button class="btn danger" data-delete="${escapeHTML(item.id)}">Delete</button></div></td></tr>`).join("")||`<tr><td colspan="5">No products yet.</td></tr>`;
  $$("[data-edit]",tbody).forEach(button=>button.addEventListener("click",()=>{
    const item=items.find(p=>p.id===button.dataset.edit);if(!item)return;
    const form=$("#productForm");for(const key of ["id","title","category","price","oldPrice","stock","image","sku","description"]){if(form.elements[key])form.elements[key].value=item[key]??"";}
    form.elements.sizes.value=(item.sizes||[]).join(", ");form.elements.colors.value=(item.colors||[]).join(", ");form.elements.active.value=String(item.active!==false);
    $("#productFormTitle").textContent="Edit product";showAdminSection("productsAdmin");form.scrollIntoView({behavior:"smooth"});
  }));
  $$("[data-delete]",tbody).forEach(button=>button.addEventListener("click",async()=>{
    if(!confirm("Permanently delete this product? Export a backup first if you may need it."))return;
    try{await deleteDoc(doc(db,"products",button.dataset.delete));await refreshDashboard();setStatus("#dashboardMessage","Product deleted.");}
    catch(error){console.error(error);setStatus("#dashboardMessage","Delete failed. Check administrator permissions.");}
  }));
}
$("#productForm")?.addEventListener("submit",async event=>{
  event.preventDefault();if(!isAdmin)return;
  const form=event.currentTarget,data=Object.fromEntries(new FormData(form));
  const payload={
    title:String(data.title).trim(),category:String(data.category).trim(),
    price:Number(data.price),oldPrice:Number(data.oldPrice)||0,stock:Number(data.stock),
    image:safeImage(data.image),sizes:splitList(data.sizes),colors:splitList(data.colors),
    sku:String(data.sku||"").trim(),description:String(data.description||"").trim(),
    active:data.active==="true",updatedAt:serverTimestamp()
  };
  if(!payload.image)return setStatus("#dashboardMessage","Please enter a valid product image URL.");
  if(payload.price<0||payload.stock<0)return setStatus("#dashboardMessage","Price and stock must be zero or greater.");
  try{
    const id=String(data.id||"").trim();
    if(id)await updateDoc(doc(db,"products",id),payload);
    else await addDoc(collection(db,"products"),{...payload,createdAt:serverTimestamp()});
    form.reset();form.elements.stock.value=0;$("#productFormTitle").textContent="Add product";
    setStatus("#dashboardMessage","Product saved successfully.");await refreshDashboard();
  }catch(error){console.error(error);setStatus("#dashboardMessage","Product save failed. Check Firestore permissions.");}
});
$("#cancelEdit")?.addEventListener("click",()=>{$("#productFormTitle").textContent="Add product";});
$("#adminProductSearch")?.addEventListener("input",event=>{
  const term=event.target.value.toLowerCase();
  renderAdminProducts(products.filter(p=>`${p.title||""} ${p.category||""}`.toLowerCase().includes(term)));
});
function renderAdminOrders(orders) {
  const tbody=$("#adminOrdersTable");if(!tbody)return;
  const statuses=["pending","confirmed","processing","shipped","delivered","cancelled"];
  tbody.innerHTML=orders.map(o=>`<tr><td>${escapeHTML(o.id)}</td><td>${escapeHTML(o.customer?.name||"") }<br>${escapeHTML(o.customer?.phone||"")}</td><td>${money(o.total)}</td><td>${escapeHTML(o.status||"pending")}</td><td><select class="field order-status" data-order="${escapeHTML(o.id)}">${statuses.map(s=>`<option ${s===(o.status||"pending")?"selected":""}>${s}</option>`).join("")}</select><button class="btn secondary" data-save-order="${escapeHTML(o.id)}">Save</button></td></tr>`).join("")||`<tr><td colspan="5">No orders yet.</td></tr>`;
  $$("[data-save-order]",tbody).forEach(button=>button.addEventListener("click",async()=>{
    const id=button.dataset.saveOrder,status=$(`[data-order="${CSS.escape(id)}"]`,tbody)?.value;
    try{await updateDoc(doc(db,"orders",id),{status,updatedAt:serverTimestamp()});setStatus("#dashboardMessage","Order status updated.");await refreshDashboard();}
    catch(error){console.error(error);setStatus("#dashboardMessage","Order update failed.");}
  }));
}
function renderAdminMessages(messages) {
  const el=$("#adminMessagesList");if(!el)return;
  el.innerHTML=messages.map(m=>`<article class="panel"><p><strong>${escapeHTML(m.subject||"Enquiry")}</strong> · ${escapeHTML(m.name)} · ${escapeHTML(m.email)}</p><p class="message">${escapeHTML(m.message)}</p><button class="btn secondary" data-read-message="${escapeHTML(m.id)}">Mark read</button></article>`).join("")||`<p class="muted">No messages.</p>`;
  $$("[data-read-message]",el).forEach(b=>b.addEventListener("click",async()=>{try{await updateDoc(doc(db,"messages",b.dataset.readMessage),{status:"read"});await refreshDashboard();}catch(e){console.error(e);}}));
}
function renderAdminReviews(reviews) {
  const el=$("#adminReviewsList");if(!el)return;
  el.innerHTML=reviews.map(r=>`<article class="panel"><p><strong>${escapeHTML(r.name)}</strong> · ${Number(r.rating)||0}/5 · Product ${escapeHTML(r.productId)}</p><p class="message">${escapeHTML(r.text)}</p><p>Status: ${r.approved===true?"Approved":"Pending moderation"}</p><button class="btn" data-approve-review="${escapeHTML(r.id)}">${r.approved===true?"Approved":"Approve review"}</button> <button class="btn danger" data-delete-review="${escapeHTML(r.id)}">Delete</button></article>`).join("")||`<p class="muted">No reviews.</p>`;
  $$("[data-approve-review]",el).forEach(b=>b.addEventListener("click",async()=>{try{await updateDoc(doc(db,"reviews",b.dataset.approveReview),{approved:true,moderatedAt:serverTimestamp()});await refreshDashboard();}catch(e){console.error(e);}}));
  $$("[data-delete-review]",el).forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Delete this review?"))return;try{await deleteDoc(doc(db,"reviews",b.dataset.deleteReview));await refreshDashboard();}catch(e){console.error(e);}}));
}
function downloadFile(name,content,type) {
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
$("#exportBackup")?.addEventListener("click",()=>downloadFile("limitless-products-backup.json",JSON.stringify(products,null,2),"application/json"));
$("#exportCsv")?.addEventListener("click",()=>{
  const fields=["id","title","category","price","oldPrice","stock","image","sizes","colors","sku","description","active"];
  const csv=[fields.join(","),...products.map(p=>fields.map(k=>`"${String(Array.isArray(p[k])?p[k].join("|"):p[k]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");
  downloadFile("limitless-products-backup.csv",csv,"text/csv;charset=utf-8");
});
if($("#adminEmail"))guardAdmin();
