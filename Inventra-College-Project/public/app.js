const authShell = document.querySelector("#auth-shell");
const authContent = document.querySelector("#auth-content");
const application = document.querySelector("#application");
const mainView = document.querySelector("#main-view");
const toast = document.querySelector("#toast");
const productDialog = document.querySelector("#product-dialog");
const profileDialog = document.querySelector("#profile-dialog");

const state = {
  user: null,
  view: "dashboard",
  products: [],
  reconciliation: null,
  authMode: "login",
  searchTimer: null,
  toastTimer: null
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[char]);
}

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  let payload = {};
  if (response.status !== 204) {
    try { payload = await response.json(); } catch { payload = {}; }
  }
  if (!response.ok) {
    const error = new Error(payload.error || "Request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3300);
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function statusPill(status) {
  const styles = {
    completed: ["Completed", "completed"],
    in_progress: ["In progress", "progress"],
    Matched: ["Matched", "matched"],
    "Requires review": ["Requires review", "review"],
    "Not counted": ["Not counted", "progress"]
  };
  const [label, style] = styles[status] || [status, ""];
  return `<span class="status-pill ${style}">${escapeHtml(label)}</span>`;
}

function showAuth(mode = "login") {
  state.authMode = mode;
  application.hidden = true;
  authShell.hidden = false;
  document.querySelector("#loading-screen").hidden = true;
  const isRegister = mode === "register";
  authContent.innerHTML = `
    <h2 class="auth-title">${isRegister ? "Create your workspace" : "Welcome back"}</h2>
    <p class="auth-subtitle">${isRegister ? "Set up an account to start reconciling your stock." : "Sign in to continue to your inventory."}</p>
    <form id="auth-form" class="auth-form">
      ${isRegister ? `<label>Your name<input name="name" maxlength="80" required autocomplete="name" placeholder="Alex Morgan"></label>
      <label>Business name<input name="business_name" maxlength="120" required placeholder="ABC Hardware"></label>` : ""}
      <label>Email address<input name="email" type="email" required autocomplete="email" placeholder="you@business.com"></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete="${isRegister ? "new-password" : "current-password"}" placeholder="At least 8 characters"></label>
      <p class="form-error" id="auth-error" hidden></p>
      <button class="button button-primary button-wide" type="submit">${isRegister ? "Create account" : "Sign in"}</button>
    </form>
    <p class="auth-switch">${isRegister ? "Already have an account?" : "New to Inventra?"} <button class="text-button" type="button" data-action="switch-auth">${isRegister ? "Sign in" : "Create an account"}</button></p>
    ${isRegister ? "" : `<div class="demo-box"><strong>Try the demonstration workspace</strong><p>Sample products and one completed stock check are included.</p><button class="button button-secondary" type="button" data-action="fill-demo">Fill demo login</button></div>`}
  `;
}

async function startApp(user) {
  state.user = user;
  authShell.hidden = true;
  application.hidden = false;
  document.querySelector("#loading-screen").hidden = true;
  const initial = user.name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  document.querySelector("#user-avatar").textContent = initial || "I";
  document.querySelector("#sidebar-user-name").textContent = user.name;
  document.querySelector("#sidebar-business").textContent = user.business_name;
  await renderView("dashboard");
}

function setNavigation(view) {
  state.view = view;
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const names = { dashboard: "Dashboard", inventory: "Inventory", reconciliations: "Reconciliations", count: "Physical count", report: "Reconciliation report" };
  document.querySelector("#breadcrumb-current").textContent = names[view] || "Workspace";
}

async function renderView(view = state.view) {
  setNavigation(view);
  mainView.innerHTML = `<div class="empty-state"><span class="empty-icon">↻</span><h3>Loading your workspace</h3><p>Getting your inventory ready.</p></div>`;
  try {
    if (view === "dashboard") await renderDashboard();
    if (view === "inventory") await renderInventory();
    if (view === "reconciliations") await renderReconciliations();
    if (view === "count" || view === "report") await renderReconciliationDetail();
  } catch (error) {
    if (error.status === 401) {
      showAuth("login");
      return;
    }
    mainView.innerHTML = `<div class="empty-state"><span class="empty-icon">!</span><h3>We couldn’t load this page</h3><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-action="retry-view">Try again</button></div>`;
  }
}

function pageHeading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</div>`;
}

function statCard(label, value, note, icon) {
  return `<div class="stat-card"><div class="stat-top"><span>${escapeHtml(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-foot">${escapeHtml(note)}</div></div>`;
}

function reconciliationTableRows(rows) {
  return rows.map((row) => `<tr>
    <td><strong>${escapeHtml(formatDate(row.count_date))}</strong></td>
    <td class="product-cell"><strong>${escapeHtml(row.name)}</strong></td>
    <td>${Number(row.products_checked || 0)}</td>
    <td>${row.status === "completed" ? Number(row.variances || 0) : `${Number(row.uncounted || 0)} left`}</td>
    <td>${statusPill(row.status)}</td>
    <td><button class="row-button" data-action="open-reconciliation" data-id="${row.id}">${row.status === "completed" ? "View report" : "Continue"}</button></td>
  </tr>`).join("");
}

async function renderDashboard() {
  const { total_products: totalProducts, recent_reconciliations: rows } = await api("/api/dashboard");
  const latest = rows[0];
  const checked = latest ? Number(latest.products_checked || 0) - Number(latest.uncounted || 0) : 0;
  const matched = latest ? Number(latest.matched || 0) : 0;
  const variances = latest ? Number(latest.variances || 0) : 0;
  const actions = `<button class="button button-primary" data-action="new-reconciliation">＋ New reconciliation</button>`;
  mainView.innerHTML = `${pageHeading("OVERVIEW", `Good ${greeting()}, ${state.user.name.split(" ")[0]}`, "Here’s what’s happening in your stock records.", actions)}
    <section class="stats-grid">
      ${statCard("Inventory products", totalProducts, "Items in your current inventory", "▤")}
      ${statCard("Products counted", latest ? checked : "—", latest ? `In ${latest.name}` : "Complete a count to see progress", "✓")}
      ${statCard("Matched", latest ? matched : "—", latest ? "Same as recorded quantity" : "No completed count yet", "＝")}
      ${statCard("Requires review", latest ? variances : "—", latest ? "Variances to review" : "No completed count yet", "↗")}
    </section>
    <section class="dashboard-grid">
      <div class="panel">
        <div class="panel-heading"><div><h2>Recent reconciliations</h2><p>Review your latest stock checks</p></div><button class="link-button" data-view="reconciliations">View history →</button></div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Reconciliation</th><th>Products</th><th>Variances / left</th><th>Status</th><th></th></tr></thead><tbody>${reconciliationTableRows(rows)}</tbody></table></div>` : `<div class="empty-state"><span class="empty-icon">↻</span><h3>No stock checks yet</h3><p>Start a reconciliation to compare your recorded inventory with a physical count.</p><button class="button button-secondary" data-action="new-reconciliation">Create first count</button></div>`}
      </div>
      <div class="panel">
        <div class="panel-heading"><div><h2>Count workflow</h2><p>Three steps to a clear report</p></div></div>
        <div class="workflow-list">
          <div class="workflow-step"><span>01</span><div><strong>Load inventory</strong><small>Add products or import a CSV file.</small></div></div>
          <div class="workflow-step"><span>02</span><div><strong>Count physical stock</strong><small>Record what you find on the shelf.</small></div></div>
          <div class="workflow-step"><span>03</span><div><strong>Review variances</strong><small>Compare counts and add remarks.</small></div></div>
        </div>
        <div class="workflow-action"><button class="button button-secondary" data-view="inventory">Open inventory</button></div>
      </div>
    </section>`;
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

async function renderInventory(search = "") {
  const { products } = await api("/api/products");
  state.products = products;
  const actions = `<input class="visually-hidden-file" type="file" id="csv-file" accept=".csv,text/csv" aria-label="Import inventory from CSV"><label class="button button-secondary upload-label" for="csv-file">Import CSV</label><button class="button button-primary" data-action="new-product">＋ Add product</button>`;
  mainView.innerHTML = `${pageHeading("STOCK RECORDS", "Inventory", "Manage the expected quantities used in your next reconciliation.", actions)}
    <div class="inventory-toolbar"><label class="search-box"><span class="search-icon">⌕</span><input id="product-search" value="${escapeHtml(search)}" type="search" placeholder="Search by product ID or name" aria-label="Search inventory"></label><span class="inventory-count">${products.length} ${products.length === 1 ? "product" : "products"}</span></div>
    <div class="panel">
      ${products.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Product ID</th><th>Variant</th><th>Expected stock</th><th>Actions</th></tr></thead><tbody>${products.map((product) => `<tr data-search="${escapeHtml(`${product.sku} ${product.name} ${product.variant}`.toLowerCase())}">
        <td class="product-cell"><div class="table-name"><span class="product-thumb">${escapeHtml(product.name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(product.name)}</strong><small>Stock record</small></span></div></td>
        <td><strong>${escapeHtml(product.sku)}</strong></td><td>${escapeHtml(product.variant || "—")}</td><td><strong>${Number(product.expected_quantity)}</strong></td>
        <td><div class="table-actions"><button class="row-button" data-action="edit-product" data-id="${product.id}">Edit</button><button class="row-button" data-action="delete-product" data-id="${product.id}">Delete</button></div></td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><span class="empty-icon">▤</span><h3>${search ? "No matching products" : "Your inventory is empty"}</h3><p>${search ? "Try a different product name or ID." : "Add a few products or import your existing stock CSV to get started."}</p>${search ? "" : `<button class="button button-secondary" data-action="new-product">Add your first product</button>`}</div>`}
    </div><p class="import-note">CSV columns: <strong>product_id, product_name, variant, expected_quantity</strong>. Importing an existing product ID updates its record. Reconciliation history keeps its original snapshot.</p>`;
}

async function renderReconciliations() {
  const [{ reconciliations }, { total_products: totalProducts }] = await Promise.all([api("/api/reconciliations"), api("/api/dashboard")]);
  const actions = `<button class="button button-primary" data-action="focus-new-reconciliation">＋ New reconciliation</button>`;
  mainView.innerHTML = `${pageHeading("COUNT HISTORY", "Reconciliations", "Start a physical stock count or reopen a saved result.", actions)}
    <section class="reconciliation-layout">
      <div class="panel">
        <div class="panel-heading"><div><h2>All stock checks</h2><p>${reconciliations.length} saved ${reconciliations.length === 1 ? "reconciliation" : "reconciliations"}</p></div></div>
        ${reconciliations.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Products</th><th>Variances / left</th><th>Status</th><th></th></tr></thead><tbody>${reconciliationTableRows(reconciliations)}</tbody></table></div>` : `<div class="empty-state"><span class="empty-icon">↻</span><h3>No reconciliations</h3><p>Create a count when your inventory is ready.</p></div>`}
      </div>
      <aside class="panel reconciliation-side" id="new-reconciliation-panel"><h3>Start a stock check</h3><p>Create a named count. Expected quantities are saved as a snapshot so this report stays consistent later.</p>
        <form id="new-reconciliation-form" class="new-recon-form">
          <label>Reconciliation name<input name="name" required maxlength="120" placeholder="September Stock Check"></label>
          <label>Count date<input name="count_date" type="date" value="${todayString()}" required></label>
          <button class="button button-primary" type="submit" ${totalProducts ? "" : "disabled"}>Create and start count</button>
        </form>
        <div class="side-info">${totalProducts ? `${totalProducts} products will be added to this count.` : "Add products to your inventory before starting a count."} Counts can be saved and continued later.</div>
      </aside>
    </section>`;
}

async function renderReconciliationDetail() {
  if (!state.reconciliation?.id) {
    state.view = "reconciliations";
    return renderReconciliations();
  }
  const { reconciliation } = await api(`/api/reconciliations/${state.reconciliation.id}`);
  state.reconciliation = reconciliation;
  setNavigation(reconciliation.status === "completed" ? "report" : "count");
  if (reconciliation.status === "completed") renderReport(reconciliation);
  else renderCount(reconciliation);
}

function renderCount(reconciliation) {
  const items = reconciliation.items;
  const counted = items.filter((item) => item.physical_quantity !== null).length;
  const completion = items.length ? Math.round(counted / items.length * 100) : 0;
  const canComplete = counted === items.length && items.length > 0;
  const actions = `<button class="button button-secondary" data-action="back-to-reconciliations">Save and close</button><button class="button button-primary" data-action="complete-reconciliation" ${canComplete ? "" : "disabled"}>Complete count</button>`;
  mainView.innerHTML = `${pageHeading("PHYSICAL COUNT", reconciliation.name, `Count date ${formatDate(reconciliation.count_date)} · Enter the quantity you physically counted.`, actions)}
    <section class="count-summary"><div class="count-summary-title"><strong>${escapeHtml(reconciliation.name)}</strong><span>${counted} of ${items.length} products counted · Expected quantities are visible</span></div><div class="progress-area"><div class="progress-label"><span>Count progress</span><strong>${completion}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${completion}%"></div></div></div></section>
    <label class="search-box" style="display:block;margin-bottom:12px"><span class="search-icon">⌕</span><input id="count-search" type="search" placeholder="Find a product by name or ID" aria-label="Search count items"></label>
    <section id="count-list" class="count-list">${items.map((item) => countRow(item)).join("")}</section>
    ${items.length ? `<p class="report-footnote">A variance is <strong>physical quantity − expected quantity</strong>. A difference is flagged for review; Inventra does not determine its cause.</p>` : `<div class="empty-state"><h3>No products in this count</h3></div>`}`;
}

function countRow(item) {
  const isCounted = item.physical_quantity !== null;
  return `<article class="count-row ${isCounted ? "is-saved" : ""} ${item.variance ? "is-review" : ""}" data-search="${escapeHtml(`${item.sku} ${item.name} ${item.variant}`.toLowerCase())}">
    <div class="count-product"><span class="product-thumb">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku)}${item.variant ? ` · ${escapeHtml(item.variant)}` : ""}</small></span></div>
    <div class="count-expected">Expected<strong>${Number(item.expected_quantity)}</strong></div>
    <div class="count-input-wrap"><input type="number" min="0" step="1" inputmode="numeric" aria-label="Physical quantity for ${escapeHtml(item.name)}" value="${isCounted ? Number(item.physical_quantity) : ""}" placeholder="Count"><button class="row-button" data-action="save-count" data-item="${item.id}">Save</button></div>
  </article>`;
}

function renderReport(reconciliation) {
  const items = reconciliation.items;
  const matched = items.filter((item) => item.variance === 0).length;
  const review = items.filter((item) => item.variance !== 0).length;
  const actions = `<button class="button button-secondary report-actions" data-action="download-report">Download CSV</button><button class="button button-primary report-actions" data-action="print-report">Print / Save PDF</button><button class="button button-quiet report-actions" data-action="back-to-reconciliations">Back to history</button>`;
  mainView.innerHTML = `${pageHeading("RECONCILIATION REPORT", reconciliation.name, `${state.user.business_name} · ${formatDate(reconciliation.count_date)} · Completed`, actions)}
    <section class="report-summary">
      <div class="report-metric"><span>Products checked</span><strong>${items.length}</strong></div>
      <div class="report-metric"><span>Matched</span><strong>${matched}</strong></div>
      <div class="report-metric alert"><span>Requires review</span><strong>${review}</strong></div>
    </section>
    <div class="panel"><div class="panel-heading"><div><h2>Count results</h2><p>Add a remark when a variance needs a follow-up action.</p></div></div>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Expected</th><th>Physical</th><th>Variance</th><th>Status</th><th>Remark</th><th class="remark-save"></th></tr></thead><tbody>${items.map((item) => `<tr>
        <td class="product-cell"><div class="table-name"><span class="product-thumb">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku)}${item.variant ? ` · ${escapeHtml(item.variant)}` : ""}</small></span></div></td>
        <td>${Number(item.expected_quantity)}</td><td>${Number(item.physical_quantity)}</td><td><strong>${item.variance > 0 ? "+" : ""}${Number(item.variance)}</strong></td><td>${statusPill(item.status)}</td>
        <td><input class="remark-input" maxlength="500" aria-label="Remark for ${escapeHtml(item.name)}" value="${escapeHtml(item.remark)}" placeholder="Add a remark" data-remark-id="${item.id}"></td>
        <td class="remark-save"><button class="row-button" data-action="save-remark" data-item="${item.id}">Save</button></td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><h3>No count results</h3></div>`}
    </div>
    <p class="report-footnote"><strong>Variance = physical quantity − expected quantity.</strong> A non-zero variance requires review. The report records the difference and user remarks; it does not decide whether stock is missing or identify a cause.</p>`;
}

function openProductDialog(product = null) {
  const form = document.querySelector("#product-form");
  form.reset();
  form.elements.id.value = product?.id || "";
  form.elements.sku.value = product?.sku || "";
  form.elements.name.value = product?.name || "";
  form.elements.variant.value = product?.variant || "";
  form.elements.expected_quantity.value = product?.expected_quantity ?? "";
  document.querySelector("#product-dialog-title").textContent = product ? "Edit product" : "Add product";
  productDialog.showModal();
  form.elements.sku.focus();
}

function openProfileDialog() {
  const form = document.querySelector("#profile-form");
  form.elements.name.value = state.user.name;
  form.elements.business_name.value = state.user.business_name;
  form.elements.email.value = state.user.email;
  profileDialog.showModal();
}

function downloadReport() {
  const reconciliation = state.reconciliation;
  const headers = ["product_id", "product_name", "variant", "expected_quantity", "physical_quantity", "variance", "status", "remark"];
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = reconciliation.items.map((item) => [item.sku, item.name, item.variant, item.expected_quantity, item.physical_quantity, item.variance, item.status, item.remark]);
  const csv = [headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `${reconciliation.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reconciliation"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("CSV report downloaded.");
}

async function submitAuth(form) {
  const errorBox = form.querySelector("#auth-error");
  const button = form.querySelector("button[type=submit]");
  errorBox.hidden = true;
  button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const result = await api(state.authMode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST", body: JSON.stringify(body)
    });
    await startApp(result.user);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function submitProduct(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  const id = values.id;
  const payload = { sku: values.sku, name: values.name, variant: values.variant, expected_quantity: Number(values.expected_quantity) };
  const errorBox = form.querySelector("#product-form-error");
  const submitButton = form.querySelector("button[type=submit]");
  errorBox.hidden = true;
  submitButton.disabled = true;
  try {
    await api(id ? `/api/products/${id}` : "/api/products", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
    productDialog.close();
    showToast(id ? "Product updated." : "Product added.");
    await renderView("inventory");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
}

async function submitNewReconciliation(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api("/api/reconciliations", { method: "POST", body: JSON.stringify(payload) });
    state.reconciliation = result.reconciliation;
    showToast("Reconciliation created. Start entering your counts.");
    await renderView("count");
  } catch (error) { showToast(error.message, true); }
}

async function submitProfile(form) {
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await api("/api/profile", { method: "PATCH", body: JSON.stringify(payload) });
    state.user = result.user;
    profileDialog.close();
    await startApp(state.user);
    showToast("Profile updated.");
  } catch (error) { showToast(error.message, true); }
}

async function importCsv(file) {
  if (!file) return;
  if (file.size > 2_000_000) { showToast("Choose a CSV file smaller than 2 MB.", true); return; }
  try {
    const csv = await file.text();
    const result = await api("/api/products/import", { method: "POST", body: JSON.stringify({ csv }) });
    showToast(`${result.added} added · ${result.updated} updated.`);
    await renderView("inventory");
  } catch (error) { showToast(error.message, true); }
  finally { const input = document.querySelector("#csv-file"); if (input) input.value = ""; }
}

async function saveCount(button) {
  const row = button.closest(".count-row");
  const input = row.querySelector("input");
  const value = input.value.trim();
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) { showToast("Enter a whole-number physical quantity of zero or more.", true); input.focus(); return; }
  button.disabled = true;
  try {
    await api(`/api/reconciliations/${state.reconciliation.id}/items/${button.dataset.item}`, {
      method: "PUT", body: JSON.stringify({ physical_quantity: Number(value) })
    });
    showToast("Count saved.");
    await renderView("count");
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
}

async function saveRemark(button) {
  const input = document.querySelector(`[data-remark-id="${button.dataset.item}"]`);
  try {
    await api(`/api/reconciliations/${state.reconciliation.id}/items/${button.dataset.item}`, {
      method: "PUT", body: JSON.stringify({ remark: input.value })
    });
    showToast("Remark saved.");
  } catch (error) { showToast(error.message, true); }
}

async function handleAction(action, button) {
  if (action === "switch-auth") showAuth(state.authMode === "login" ? "register" : "login");
  if (action === "fill-demo") {
    const form = document.querySelector("#auth-form");
    form.elements.email.value = "demo@inventra.local";
    form.elements.password.value = "InventraDemo2026!";
    form.elements.password.focus();
  }
  if (action === "new-product") openProductDialog();
  if (action === "edit-product") {
    const product = state.products.find((item) => String(item.id) === button.dataset.id);
    if (product) openProductDialog(product);
  }
  if (action === "delete-product") {
    const product = state.products.find((item) => String(item.id) === button.dataset.id);
    if (!product || !window.confirm(`Delete ${product.name} (${product.sku}) from the current inventory? Existing reconciliation reports keep their saved product details.`)) return;
    try {
      await api(`/api/products/${product.id}`, { method: "DELETE" });
      showToast("Product deleted from current inventory.");
      await renderView("inventory");
    } catch (error) { showToast(error.message, true); }
  }
  if (action === "new-reconciliation" || action === "focus-new-reconciliation") {
    await renderView("reconciliations");
    document.querySelector("#new-reconciliation-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.querySelector("#new-reconciliation-form input[name=name]")?.focus();
  }
  if (action === "open-reconciliation") {
    state.reconciliation = { id: Number(button.dataset.id) };
    await renderView("count");
  }
  if (action === "back-to-reconciliations") {
    state.reconciliation = null;
    await renderView("reconciliations");
  }
  if (action === "save-count") await saveCount(button);
  if (action === "complete-reconciliation") {
    if (!window.confirm("Complete this stock count? You can still add remarks, but the physical quantities will become read-only.")) return;
    try {
      await api(`/api/reconciliations/${state.reconciliation.id}/complete`, { method: "POST", body: JSON.stringify({}) });
      showToast("Count completed. Your report is ready.");
      await renderView("report");
    } catch (error) { showToast(error.message, true); }
  }
  if (action === "save-remark") await saveRemark(button);
  if (action === "download-report") downloadReport();
  if (action === "print-report") window.print();
  if (action === "retry-view") await renderView(state.view);
}

document.addEventListener("click", async (event) => {
  const navButton = event.target.closest("[data-view]");
  if (navButton) {
    const view = navButton.dataset.view;
    state.reconciliation = null;
    await renderView(view);
    return;
  }
  const closeButton = event.target.closest("[data-close-dialog]");
  if (closeButton) { closeButton.closest("dialog")?.close(); return; }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) await handleAction(actionButton.dataset.action, actionButton);
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "auth-form") await submitAuth(event.target);
  if (event.target.id === "new-reconciliation-form") await submitNewReconciliation(event.target);
  if (event.target.id === "profile-form") await submitProfile(event.target);
});

// Bind the product dialog directly. This keeps Save product reliable even when
// a browser handles dialog form submission differently from document delegation.
document.querySelector("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitProduct(event.currentTarget);
});

document.addEventListener("input", (event) => {
  if (event.target.id === "product-search") {
    const query = event.target.value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll(".panel tbody tr[data-search]").forEach((row) => {
      row.hidden = !row.dataset.search.includes(query);
      if (!row.hidden) visible += 1;
    });
    const counter = document.querySelector(".inventory-count");
    if (counter) counter.textContent = `${visible} ${visible === 1 ? "product" : "products"}`;
  }
  if (event.target.id === "count-search") {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll(".count-row").forEach((row) => { row.hidden = !row.dataset.search.includes(query); });
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "csv-file") importCsv(event.target.files?.[0]);
});

document.querySelector("#profile-button").addEventListener("click", openProfileDialog);
document.querySelector("#top-profile-button").addEventListener("click", openProfileDialog);
document.querySelector("#logout-button").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
  profileDialog.close();
  state.user = null;
  state.reconciliation = null;
  showAuth("login");
});

(async function boot() {
  try {
    const { user } = await api("/api/auth/me");
    await startApp(user);
  } catch {
    showAuth("login");
  }
})();
