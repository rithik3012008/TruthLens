import { auth } from "./firebase-config.js";
import { loadHistory } from "./history.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const historyList = document.getElementById("historyList");
const emptyMessage = document.getElementById("emptyMessage");

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const entries = await loadHistory(20);

  if (entries.length === 0) {
    emptyMessage.classList.remove("hidden");
    return;
  }

  entries.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "dashboard-card history-item-card";

    const isFake = entry.prediction === "FAKE";

    const date = entry.createdAt
      ? entry.createdAt.toDate().toLocaleString()
      : "Just now";

    const predictionClass = isFake
      ? "history-badge-fake"
      : "history-badge-real";

    const predictionIcon = isFake ? "⚠" : "✓";

    card.innerHTML = `
      <div class="history-item-main">

        <div class="history-item-content">

          <div class="history-item-label">
            <span class="history-item-dot ${
              isFake ? "dot-fake" : "dot-real"
            }"></span>

            News verification
          </div>

          <p class="history-item-text">
            ${entry.text}${entry.text.length >= 300 ? "..." : ""}
          </p>

        </div>


        <div class="history-result-badge ${predictionClass}">

          <span class="history-result-icon">
            ${predictionIcon}
          </span>

          <span class="history-result-prediction">
            ${entry.prediction}
          </span>

          <span class="history-result-confidence">
            ${entry.confidence}%
          </span>

        </div>

      </div>


      <div class="history-item-footer">

        <span class="history-date">
          🕒 ${date}
        </span>

        <span class="history-analysis">
          ML Analysis
        </span>

      </div>
    `;

    historyList.appendChild(card);
  });
});