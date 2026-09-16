import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const el = (id) => document.getElementById(id);

const statUsers = el("adminStatUsers");
const statChecks = el("adminStatChecks");
const statReal = el("adminStatReal");
const statFake = el("adminStatFake");
const statReports = el("adminStatReports");
const recentActivityList = el("recentActivityList");
const noActivityMessage = el("noActivityMessage");
const dashboardMessage = el("adminDashboardMessage");

// admin-auth.js already handles the login/role check + redirect for this
// protected page — we just wait for a confirmed signed-in admin before
// pulling in data, so we're not racing that check.
onAuthStateChanged(auth, (user) => {
  if (user) {
    loadAdminStats();
  }
});

async function loadAdminStats() {
  showMessage("Loading dashboard stats...");

  try {
    const [usersCount, checksCount, realCount, fakeCount, reportsCount] = await Promise.all([
      safeCount(collection(db, "users")),
      safeCount(collection(db, "history")),
      safeCount(query(collection(db, "history"), where("prediction", "==", "REAL"))),
      safeCount(query(collection(db, "history"), where("prediction", "==", "FAKE"))),
      safeCount(collection(db, "reports")) // Doesn't exist until Phase 5 — safely counts as 0 until then
    ]);

    setNumber(statUsers, usersCount);
    setNumber(statChecks, checksCount);
    setNumber(statReal, realCount);
    setNumber(statFake, fakeCount);
    setNumber(statReports, reportsCount);

    await loadRecentActivity();

    hideMessage();

  } catch (error) {
    console.error("Failed to load admin stats:", error);
    showMessage("Unable to load dashboard statistics. Check that your Firestore rules allow admin reads.");
  }
}

// Wraps getCountFromServer so one missing/blocked collection doesn't
// break the whole dashboard — it just shows 0 for that stat.
async function safeCount(refOrQuery) {
  try {
    const snap = await getCountFromServer(refOrQuery);
    return snap.data().count;
  } catch (error) {
    console.error("Count query failed:", error);
    return 0;
  }
}

async function loadRecentActivity() {
  if (!recentActivityList) return;

  recentActivityList.innerHTML = "";

  const recentQuery = query(
    collection(db, "history"),
    orderBy("createdAt", "desc"),
    limit(10)
  );

  const snapshot = await getDocs(recentQuery);

  if (snapshot.empty) {
    if (noActivityMessage) noActivityMessage.classList.remove("hidden");
    return;
  }

  if (noActivityMessage) noActivityMessage.classList.add("hidden");

  const entries = snapshot.docs.map((d) => d.data());

  // Look up each entry's user profile so we can show who ran the check,
  // rather than just a raw uid. One lookup per unique user, not per entry.
  const uids = [...new Set(entries.map((e) => e.userId).filter(Boolean))];
  const userMap = {};

  await Promise.all(uids.map(async (uid) => {
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      userMap[uid] = userSnap.exists() ? userSnap.data() : null;
    } catch {
      userMap[uid] = null;
    }
  }));

  entries.forEach((entry) => {
    const user = userMap[entry.userId];
    const who = (user && (user.email || user.name)) || "Unknown user";
    const isFake = entry.prediction === "FAKE";
    const date = entry.createdAt ? entry.createdAt.toDate().toLocaleString() : "Just now";
    const text = entry.text || "";
    const preview = text.length > 110 ? text.slice(0, 110) + "..." : text;

    const row = document.createElement("div");
    row.className = "admin-activity-row";
    row.innerHTML = `
      <div class="admin-activity-main">
        <div class="admin-activity-who">${escapeHtml(who)}</div>
        <p class="admin-activity-text">${escapeHtml(preview)}</p>
      </div>
      <div class="admin-activity-result">
        <div class="admin-activity-badge ${isFake ? "is-fake" : "is-real"}">
          ${entry.prediction || "—"} · ${entry.confidence ?? "—"}%
        </div>
        <div class="admin-activity-date">${date}</div>
      </div>
    `;
    recentActivityList.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setNumber(element, value) {
  if (!element) return;
  element.textContent = value;
}

function showMessage(message) {
  if (!dashboardMessage) return;
  dashboardMessage.textContent = message;
  dashboardMessage.classList.remove("hidden");
}

function hideMessage() {
  if (!dashboardMessage) return;
  dashboardMessage.classList.add("hidden");
}