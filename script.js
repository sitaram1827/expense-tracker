const $ = id => document.getElementById(id);
const API = "http://localhost:5000/api";
const fmt = n => `Rs ${Number(n).toFixed(2)}`;
const getUser = () => localStorage.getItem("user");
const setUser = e => localStorage.setItem("user", e);
const clearUser = () => localStorage.removeItem("user");
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {...opts, headers: {"Content-Type": "application/json", ...(opts.headers||{})}});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}
let user = null, page = "dashboard", isAdmin = false, txs = [];
const pages = Array.from(document.querySelectorAll(".page"));
const navBtns = Array.from(document.querySelectorAll(".nav-btn"));
function setPage(p) {
  page = p;
  pages.forEach(el => {el.classList.toggle("active", el.id === `page-${p}`); el.classList.toggle("hidden", el.id !== `page-${p}`);});
  navBtns.forEach(btn => {btn.classList.toggle("active", btn.dataset.page === p);});
  if (p === "admin" && !isAdmin) setPage("dashboard");
}
function getBudgetKey(e) { return `budget:${e}`; }
function getBudget(e) { const v = Number(localStorage.getItem(getBudgetKey(e))); return Number.isFinite(v) && v > 0 ? v : 0; }
function setBudget(e, a) { localStorage.setItem(getBudgetKey(e), String(a)); }
function getTotals() {
  let inc = 0, exp = 0;
  txs.forEach(tx => {if (tx.type === "income") inc += tx.amount; else exp += tx.amount;});
  return {inc, exp, bal: inc - exp};
}
navBtns.forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.page)));
const loginForm = $("loginForm"), regForm = $("registerForm"), logoutBtn = $("logoutBtn");
const loginBtn = $("loginBtn"), loginTab = $("loginTab"), regTab = $("registerTab"), loginPane = $("loginPane"), regPane = $("registerPane");
function setAuthTab(t) {
  const isLog = t === "login";
  loginPane.classList.toggle("active", isLog);
  regPane.classList.toggle("active", !isLog);
  loginTab.classList.toggle("active", isLog);
  regTab.classList.toggle("active", !isLog);
  $("authMessage").textContent = "";
}
if (loginTab) loginTab.addEventListener("click", () => setAuthTab("login"));
if (regTab) regTab.addEventListener("click", () => setAuthTab("register"));
async function doLogin() {
  try {
    const em = $("loginEmail").value.trim(), p = $("loginPassword").value;
    const res = await api("/auth/login", {method: "POST", body: JSON.stringify({email: em, password: p, become_admin: false})});
    setUser(res.user.email);
    await loadDash();
    setPage("dashboard");
  } catch (e) { $("authMessage").textContent = e.message; }
}
if (regForm) {
  regForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const n = $("registerName").value.trim(), em = $("registerEmail").value.trim(), p = $("registerPassword").value;
      await api("/auth/register", {method: "POST", body: JSON.stringify({name: n, email: em, password: p, is_admin: false})});
      $("authMessage").textContent = "Registered! Login now.";
      regForm.reset();
      setAuthTab("login");
    } catch (e) { $("authMessage").textContent = e.message; }
  });
}
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await doLogin();
  });
}
if (loginBtn) loginBtn.addEventListener("click", doLogin);
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    clearUser();
    user = null;
    isAdmin = false;
    txs = [];
    $("authContainer").classList.remove("hidden");
    $("dashboardContainer").classList.add("hidden");
    loginForm.reset();
    setAuthTab("login");
  });
}
async function loadDash() {
  const em = getUser();
  if (!em) return;
  try {
    const res = await api(`/me?email=${encodeURIComponent(em)}`);
    user = res;
    isAdmin = res.is_admin;
    txs = res.transactions || [];
    $("userChip").textContent = res.user.email;
    $("authContainer").classList.add("hidden");
    $("dashboardContainer").classList.remove("hidden");
    if (!isAdmin) $("adminBtn").classList.add("hidden");
    render();
  } catch (e) {
    clearUser();
    $("dashboardContainer").classList.add("hidden");
    $("authContainer").classList.remove("hidden");
  }
}
function render() {
  renderDash();
  renderHistory();
  renderVisual();
  renderBudget();
  if (isAdmin) renderAdmin();
}
function renderDash() {
  const {inc, exp, bal} = getTotals();
  const cats = [...new Set(txs.map(t => t.category))];
  let topCat = "-";
  if (cats.length > 0) {
    topCat = cats.reduce((max, c) => {
      const sum = txs.filter(t => t.category === c && t.type === "expense").reduce((s,t) => s + t.amount, 0);
      return sum > txs.filter(t => t.category === max && t.type === "expense").reduce((s,t) => s + t.amount, 0) ? c : max;
    });
  }
  $("totalIncome").textContent = fmt(inc);
  $("totalExpense").textContent = fmt(exp);
  $("balance").textContent = fmt(bal);
  $("topExpenseCategory").textContent = topCat;
}
function renderHistory() {
  const tbody = $("historyTable");
  if (!tbody) return;
  tbody.innerHTML = "";
  let runningBalance = 0;
  txs.forEach(tx => {
    runningBalance += tx.type === "income" ? tx.amount : -tx.amount;
    const tr = $("txRow").content.cloneNode(true);
    tr.querySelector(".tx-date").textContent = tx.date;
    tr.querySelector(".tx-desc").textContent = tx.desc;
    tr.querySelector(".tx-cat").textContent = tx.category;
    tr.querySelector(".tx-type").textContent = tx.type;
    tr.querySelector(".tx-amt").textContent = fmt(tx.amount);
    tr.querySelector(".tx-bal").textContent = fmt(runningBalance);
    tr.querySelector(".edit-btn").onclick = () => editTx(tx.id);
    tr.querySelector(".del-btn").onclick = () => delTx(tx.id);
    tbody.appendChild(tr);
  });
  if (txs.length === 0) $("emptyMsg").classList.remove("hidden");
  else $("emptyMsg").classList.add("hidden");
}
function renderVisual() {
  const {inc, exp} = getTotals();
  $("visualIncome").textContent = fmt(inc);
  $("visualExpense").textContent = fmt(exp);
  const canvas = $("donutChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const total = inc + exp;
  if (total === 0) return;
  const cx = 150, cy = 150, r = 80;
  let angle = -Math.PI / 2;
  const incA = (inc / total) * 2 * Math.PI;
  ctx.clearRect(0, 0, 300, 300);
  ctx.fillStyle = "#11a36a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, angle, angle + incA);
  ctx.lineTo(cx, cy);
  ctx.fill();
  angle += incA;
  ctx.fillStyle = "#ff5470";
  ctx.beginPath();
  ctx.arc(cx, cy, r, angle, angle + (2 * Math.PI - incA));
  ctx.lineTo(cx, cy);
  ctx.fill();
}
function renderBudget() {
  const em = getUser();
  if (!em) return;
  const bud = getBudget(em);
  const spent = txs.filter(t => t.type === "expense").reduce((s,t) => s + t.amount, 0);
  const rem = bud - spent;
  $("budgetAmount").textContent = fmt(bud);
  $("budgetSpent").textContent = fmt(spent);
  $("budgetRemaining").textContent = fmt(Math.max(rem, 0));
  if (bud > 0) $("progressFill").style.width = Math.min((spent / bud) * 100, 100) + "%";
}
async function renderAdmin() {
  $("adminBtn").classList.remove("hidden");
  const tbody = $("adminUsersTable");
  try {
    const res = await api(`/admin/overview?email=${encodeURIComponent(getUser())}`);
    // update summary
    $("adminUsers").textContent = res.summary.total_users || 0;
    $("adminTx").textContent = res.summary.total_transactions || 0;
    $("adminIncome").textContent = fmt(res.summary.total_income || 0);
    $("adminExpense").textContent = fmt(res.summary.total_expense || 0);
    const usersList = res.users || [];
    if (tbody) {
      tbody.innerHTML = "";
      usersList.forEach(u => {
        const tr = document.createElement("tr");
        const isSelf = (u.email === getUser());
        const isAdminUser = !!u.is_admin;
        const promoteDisabled = isSelf || isAdminUser ? 'disabled' : '';
        const deleteDisabled = isSelf || isAdminUser ? 'disabled' : '';
        const promoteBtn = `<button class="edit-btn make-admin-btn" data-email="${u.email}" ${promoteDisabled}>Make Admin</button>`;
        const deleteBtn = `<button class="del-btn" data-email="${u.email}" ${deleteDisabled}>Delete</button>`;
        tr.innerHTML = `<td>${u.name || "-"}</td><td>${u.email || "-"}</td><td>${u.transaction_count || 0}</td><td>${fmt(u.total_income || 0)}</td><td>${fmt(u.total_expense || 0)}</td><td>${fmt(u.balance || 0)}</td><td>${promoteBtn} ${deleteBtn}</td>`;
          const pbtn = tr.querySelector('.make-admin-btn');
          if (pbtn && !promoteDisabled) {
            pbtn.addEventListener('click', async () => {
              if (!confirm(`Promote ${u.email} to admin?`)) return;
              try {
                await api(`/admin/users/${encodeURIComponent(u.email)}/promote?email=${encodeURIComponent(getUser())}`, {method: 'POST'});
                await loadDash();
              } catch (e) { alert(e.message); }
            });
          }
          const btn = tr.querySelector('.del-btn');
          if (btn && !deleteDisabled) {
            btn.addEventListener('click', async () => {
              if (!confirm(`Delete user ${u.email}?`)) return;
              try {
                await api(`/admin/users/${encodeURIComponent(u.email)}?email=${encodeURIComponent(getUser())}`, {method: 'DELETE'});
                await loadDash();
              } catch (e) { alert(e.message); }
            });
          }
        tbody.appendChild(tr);
      });
    }
  } catch (e) {
    console.error('Admin load error', e);
  }
}
const txForm = $("transactionForm");
if (txForm) {
  txForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const em = getUser();
    if (!em) return;
    try {
      const d = $("description").value, a = parseFloat($("amount").value), c = $("category").value, t = $("type").value, dt = $("date").value;
      const id = $("transactionForm").dataset.txId;
      if (id) {
        await api(`/transactions/${encodeURIComponent(id)}`, {method: "PUT", body: JSON.stringify({email: em, desc: d, amount: a, category: c, type: t, date: dt})});
      } else {
        await api("/transactions", {method: "POST", body: JSON.stringify({email: em, desc: d, amount: a, category: c, type: t, date: dt})});
      }
      txForm.reset();
      delete $("transactionForm").dataset.txId;
      await loadDash();
    } catch (e) { alert(e.message); }
  });
}
function editTx(id) {
  const tx = txs.find(t => t.id === id);
  if (!tx) return;
  $("description").value = tx.desc;
  $("amount").value = tx.amount;
  $("category").value = tx.category;
  $("type").value = tx.type;
  $("date").value = tx.date;
  $("transactionForm").dataset.txId = id;
  $("submitBtn").textContent = "Update";
  setPage("add-tx");
}
async function delTx(id) {
  if (!confirm("Delete?")) return;
  const em = getUser();
  if (!em) return;
  try {
    await api(`/transactions/${encodeURIComponent(id)}`, {method: "DELETE", headers: {"Email": em}});
    await loadDash();
  } catch (e) { alert(e.message); }
}
if ($("saveBudgetBtn")) {
  $("saveBudgetBtn").addEventListener("click", () => {
    const em = getUser();
    if (!em) return;
    const a = Number($("budgetInput").value);
    if (!Number.isFinite(a) || a < 0) return;
    setBudget(em, a);
    $("budgetMsg").textContent = "Budget saved!";
    renderBudget();
  });
}
if ($("exportCsv")) {
  $("exportCsv").addEventListener("click", () => {
    if (txs.length === 0) { alert("No data"); return; }
    const csv = [["Date", "Desc", "Category", "Type", "Amount"], ...txs.map(t => [t.date, t.desc, t.category, t.type, t.amount])].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], {type: "text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
if (getUser()) loadDash();