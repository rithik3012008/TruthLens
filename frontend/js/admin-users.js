import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const el = (id) => document.getElementById(id);

const searchInput = el("userSearch");
const tableBody = el("usersTableBody");
const emptyState = el("usersEmptyState");
const loadingMessage = el("usersLoadingMessage");
const userCountLabel = el("userCountLabel");

const detailPanel = el("userDetailPanel");
const detailBackdrop = el("userDetailBackdrop");
const detailBody = el("userDetailBody");
const detailCloseBtn = el("userDetailClose");

let currentAdminUid = null;
let allUsers = [];
let adminUidSet = new Set();

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentAdminUid = user.uid;
    loadUsers();
  }
});

async function loadUsers() {
  showLoading("Loading users...");

  try {
    const [usersSnap, adminsSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "admins"))
    ]);

    adminUidSet = new Set(adminsSnap.docs.map((d) => d.id));
    allUsers = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    allUsers.sort((a, b) => (secondsOf(b.createdAt) - secondsOf(a.createdAt)));

    hideLoading();
    renderUsers(allUsers);

  } catch (error) {
    console.error("Failed to load users:", error);
    showLoading("Unable to load users. Check that your Firestore rules allow admin reads.");
  }
}

function secondsOf(ts) {
  return ts && ts.seconds ? ts.seconds : 0;
}

function currentFilter() {
  return (searchInput?.value || "").trim().toLowerCase();
}

function currentFilteredList() {
  const q = currentFilter();
  if (!q) return allUsers;
  return allUsers.filter((u) =>
    (u.name || "").toLowerCase().includes(q) ||
    (u.email || "").toLowerCase().includes(q)
  );
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    renderUsers(currentFilteredList());
  });
}

function renderUsers(list) {
  if (!tableBody) return;
  tableBody.innerHTML = "";

  if (userCountLabel) {
    userCountLabel.textContent = `${list.length} user${list.length === 1 ? "" : "s"}`;
  }

  if (list.length === 0) {
    if (emptyState) emptyState.classList.remove("hidden");
    return;
  }
  if (emptyState) emptyState.classList.add("hidden");

  list.forEach((u) => {
    const isAdmin = adminUidSet.has(u.uid);
    const isDisabled = !!u.disabled;
    const isSelf = u.uid === currentAdminUid;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="u-name">${escapeHtml(u.name || "—")}</div>
        <div class="u-email">${escapeHtml(u.email || "—")}</div>
      </td>
      <td>${fmtDate(u.createdAt)}</td>
      <td>${fmtDate(u.lastLogin)}</td>
      <td>${isAdmin ? '<span class="pill pill-admin">Admin</span>' : '<span class="pill">User</span>'}</td>
      <td>${isDisabled ? '<span class="pill pill-disabled">Disabled</span>' : '<span class="pill pill-active">Active</span>'}</td>
      <td class="actions-cell">
        <button class="btn-mini" data-action="details" data-uid="${u.uid}">Details</button>
        <button class="btn-mini" data-action="toggle-admin" data-uid="${u.uid}" ${isSelf ? "disabled title='Cannot change your own admin status here'" : ""}>${isAdmin ? "Remove Admin" : "Make Admin"}</button>
        <button class="btn-mini ${isDisabled ? "" : "btn-mini-danger"}" data-action="toggle-disabled" data-uid="${u.uid}" ${isSelf ? "disabled title='Cannot disable your own account'" : ""}>${isDisabled ? "Enable" : "Disable"}</button>
      </td>
    `;
    tableBody.appendChild(row);
  });
}

if (tableBody) {
  tableBody.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn || btn.disabled) return;

    const uid = btn.dataset.uid;
    const action = btn.dataset.action;

    if (action === "details") openDetails(uid);
    if (action === "toggle-admin") toggleAdmin(uid);
    if (action === "toggle-disabled") toggleDisabled(uid);
  });
}

async function toggleAdmin(uid) {
  if (uid === currentAdminUid) {
    alert("You can't change your own admin status from here.");
    return;
  }

  const isAdmin = adminUidSet.has(uid);
  const verb = isAdmin ? "remove admin access from" : "grant admin access to";
  const user = allUsers.find((u) => u.uid === uid);

  if (!confirm(`Are you sure you want to ${verb} ${user?.email || "this user"}?`)) return;

  try {
    if (isAdmin) {
      await deleteDoc(doc(db, "admins", uid));
      adminUidSet.delete(uid);
    } else {
      await setDoc(doc(db, "admins", uid), {
        grantedBy: currentAdminUid,
        grantedAt: new Date().toISOString()
      });
      adminUidSet.add(uid);
    }
    renderUsers(currentFilteredList());
  } catch (error) {
    console.error("Failed to toggle admin status:", error);
    alert("Couldn't update admin status. Check your Firestore rules allow admin writes to /admins.");
  }
}

async function toggleDisabled(uid) {
  if (uid === currentAdminUid) {
    alert("You can't disable your own account from here.");
    return;
  }

  const user = allUsers.find((u) => u.uid === uid);
  const nowDisabled = !user.disabled;
  const verb = nowDisabled ? "disable" : "re-enable";

  if (!confirm(`Are you sure you want to ${verb} ${user?.email || "this account"}?`)) return;

  try {
    await updateDoc(doc(db, "users", uid), { disabled: nowDisabled });
    user.disabled = nowDisabled;
    renderUsers(currentFilteredList());
  } catch (error) {
    console.error("Failed to toggle disabled status:", error);
    alert("Couldn't update account status. Check your Firestore rules allow admin writes to /users.");
  }
}

async function openDetails(uid) {
  const user = allUsers.find((u) => u.uid === uid);
  if (!user || !detailPanel) return;

  detailPanel.classList.remove("hidden");
  detailBackdrop.classList.remove("hidden");
  detailBody.innerHTML = `<p class="detail-loading">Loading user details...</p>`;

  try {
    const historyRef = collection(db, "history");
    const [totalSnap, realSnap, fakeSnap, recentSnap] = await Promise.all([
      getCountFromServer(query(historyRef, where("userId", "==", uid))),
      getCountFromServer(query(historyRef, where("userId", "==", uid), where("prediction", "==", "REAL"))),
      getCountFromServer(query(historyRef, where("userId", "==", uid), where("prediction", "==", "FAKE"))),
      getDocs(query(historyRef, where("userId", "==", uid), orderBy("createdAt", "desc"), limit(5)))
    ]);

    const total = totalSnap.data().count;
    const real = realSnap.data().count;
    const fake = fakeSnap.data().count;

    const recentItems = recentSnap.docs.map((d) => d.data());
    const isAdmin = adminUidSet.has(uid);
    const isDisabled = !!user.disabled;

    detailBody.innerHTML = `
      <h3>${escapeHtml(user.name || "Unnamed user")}</h3>
      <p class="detail-email">${escapeHtml(user.email || "—")}</p>

      <div class="detail-pills">
        ${isAdmin ? '<span class="pill pill-admin">Admin</span>' : '<span class="pill">User</span>'}
        ${isDisabled ? '<span class="pill pill-disabled">Disabled</span>' : '<span class="pill pill-active">Active</span>'}
      </div>

      <div class="detail-meta">
        <div><span>UID</span><code>${escapeHtml(uid)}</code></div>
        <div><span>Joined</span>${fmtDate(user.createdAt)}</div>
        <div><span>Last login</span>${fmtDate(user.lastLogin)}</div>
      </div>

      <div class="detail-stats">
        <div><strong>${total}</strong><span>Total checks</span></div>
        <div><strong style="color:var(--success)">${real}</strong><span>Real</span></div>
        <div><strong style="color:var(--danger)">${fake}</strong><span>Fake</span></div>
      </div>

      <h4>Recent checks</h4>
      ${recentItems.length === 0
        ? `<p class="detail-empty">No checks yet.</p>`
        : `<div class="detail-recent">${recentItems.map((entry) => {
            const isFake = entry.prediction === "FAKE";
            const date = entry.createdAt ? entry.createdAt.toDate().toLocaleString() : "Just now";
            const text = (entry.text || "").length > 90 ? entry.text.slice(0, 90) + "..." : (entry.text || "");
            return `
              <div class="detail-recent-row">
                <p>${escapeHtml(text)}</p>
                <div class="detail-recent-meta">
                  <span class="${isFake ? "text-fake" : "text-real"}">${entry.prediction || "—"} · ${entry.confidence ?? "—"}%</span>
                  <span>${date}</span>
                </div>
              </div>
            `;
          }).join("")}</div>`
      }
    `;

  } catch (error) {
    console.error("Failed to load user details:", error);
    detailBody.innerHTML = `<p class="detail-loading">Couldn't load this user's details. Check Firestore rules.</p>`;
  }
}

function closeDetails() {
  if (!detailPanel) return;
  detailPanel.classList.add("hidden");
  detailBackdrop.classList.add("hidden");
}

if (detailCloseBtn) detailCloseBtn.addEventListener("click", closeDetails);
if (detailBackdrop) detailBackdrop.addEventListener("click", closeDetails);

function fmtDate(ts) {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showLoading(msg) {
  if (!loadingMessage) return;
  loadingMessage.textContent = msg;
  loadingMessage.classList.remove("hidden");
}

function hideLoading() {
  if (!loadingMessage) return;
  loadingMessage.classList.add("hidden");
}