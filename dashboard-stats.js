import { auth } from "./firebase-config.js";
import { loadHistory } from "./history.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";


// ============================================================
// ELEMENTS
// ============================================================

// Support the IDs already present in your dashboard.html

const totalChecks =
  document.getElementById("statTotal") ||
  document.getElementById("totalChecks");

const realCount =
  document.getElementById("statReal") ||
  document.getElementById("realCount");

const fakeCount =
  document.getElementById("statFake") ||
  document.getElementById("fakeCount");

let unverifiedCount =
  document.getElementById("statUnverified") ||
  document.getElementById("unverifiedCount");

const logoutBtn =
  document.getElementById("logoutBtn");

const dashboardMessage =
  document.getElementById("dashboardMessage");


// ============================================================
// ADD NEEDS VERIFICATION CARD
// ============================================================

function createUnverifiedCard() {

  // If the card already exists, do nothing
  if (unverifiedCount) {
    return;
  }

  const statsGrid =
    document.querySelector(".stats-grid");

  if (!statsGrid) {
    return;
  }

  const statItem =
    document.createElement("div");

  statItem.className =
    "stat-item";

  statItem.innerHTML = `
    <div
      class="stat-number stat-unverified"
      id="statUnverified"
    >—</div>

    <div class="stat-label">
      Needs Verification
    </div>
  `;

  statsGrid.appendChild(statItem);

  unverifiedCount =
    document.getElementById("statUnverified");


  // ----------------------------------------------------------
  // Add styling for the new stat
  // ----------------------------------------------------------

  if (!document.getElementById("truthlens-unverified-style")) {

    const style =
      document.createElement("style");

    style.id =
      "truthlens-unverified-style";

    style.textContent = `

      .stat-unverified {
        color: #b7791f;
      }

      .stats-grid {
        grid-template-columns:
          repeat(4, 1fr);
      }

      @media (max-width: 520px) {

        .stats-grid {
          grid-template-columns: 1fr;
        }

      }

    `;

    document.head.appendChild(style);
  }

}


// Create the fourth card
createUnverifiedCard();


// ============================================================
// AUTH STATE
// ============================================================

onAuthStateChanged(auth, async (user) => {

  // ----------------------------------------------------------
  // NOT LOGGED IN
  // ----------------------------------------------------------

  if (!user) {

    window.location.href =
      "./login.html";

    return;
  }


  // ----------------------------------------------------------
  // LOAD STATS
  // ----------------------------------------------------------

  await loadDashboardStats();

});


// ============================================================
// LOAD DASHBOARD STATS
// ============================================================

async function loadDashboardStats() {

  try {

    showMessage(
      "Loading your verification statistics..."
    );


    // --------------------------------------------------------
    // LOAD HISTORY
    // --------------------------------------------------------

    const entries =
      await loadHistory(1000);


    // --------------------------------------------------------
    // COUNTERS
    // --------------------------------------------------------

    let total = 0;
    let real = 0;
    let fake = 0;
    let unverified = 0;


    // --------------------------------------------------------
    // COUNT RESULTS
    // --------------------------------------------------------

    entries.forEach((entry) => {

      total++;


      const prediction =
        String(
          entry.prediction || ""
        )
        .toUpperCase()
        .trim();


      // ------------------------------------------------------
      // REAL
      // ------------------------------------------------------

      if (prediction === "REAL") {

        real++;

      }


      // ------------------------------------------------------
      // FAKE
      // ------------------------------------------------------

      else if (prediction === "FAKE") {

        fake++;

      }


      // ------------------------------------------------------
      // NEEDS VERIFICATION
      // ------------------------------------------------------

      else if (
        prediction === "UNVERIFIED" ||
        prediction === "NEEDS VERIFICATION"
      ) {

        unverified++;

      }

    });


    // --------------------------------------------------------
    // UPDATE UI
    // --------------------------------------------------------

    animateNumber(
      totalChecks,
      total
    );


    animateNumber(
      realCount,
      real
    );


    animateNumber(
      fakeCount,
      fake
    );


    animateNumber(
      unverifiedCount,
      unverified
    );


    hideMessage();


    // --------------------------------------------------------
    // DEBUG LOG
    // --------------------------------------------------------

    console.log(
      "TruthLens dashboard stats:",
      {
        total,
        real,
        fake,
        unverified
      }
    );


  } catch (error) {

    console.error(
      "Unable to load dashboard statistics:",
      error
    );


    // --------------------------------------------------------
    // RESET COUNTERS
    // --------------------------------------------------------

    setNumber(
      totalChecks,
      0
    );


    setNumber(
      realCount,
      0
    );


    setNumber(
      fakeCount,
      0
    );


    setNumber(
      unverifiedCount,
      0
    );


    showMessage(
      "Unable to load verification statistics."
    );

  }

}


// ============================================================
// NUMBER ANIMATION
// ============================================================

function animateNumber(
  element,
  target
) {

  if (!element) {
    return;
  }


  const duration = 500;

  const startTime =
    performance.now();


  function update(currentTime) {

    const elapsed =
      currentTime - startTime;


    const progress =
      Math.min(
        elapsed / duration,
        1
      );


    // --------------------------------------------------------
    // Smooth animation
    // --------------------------------------------------------

    const eased =
      1 - Math.pow(
        1 - progress,
        3
      );


    const currentValue =
      Math.round(
        target * eased
      );


    element.textContent =
      currentValue;


    if (progress < 1) {

      requestAnimationFrame(
        update
      );

    }

  }


  requestAnimationFrame(
    update
  );

}


// ============================================================
// SET NUMBER
// ============================================================

function setNumber(
  element,
  value
) {

  if (!element) {
    return;
  }

  element.textContent =
    value;
}


// ============================================================
// MESSAGE
// ============================================================

function showMessage(
  message
) {

  if (!dashboardMessage) {
    return;
  }


  dashboardMessage.textContent =
    message;


  dashboardMessage.classList.remove(
    "hidden"
  );

}


function hideMessage() {

  if (!dashboardMessage) {
    return;
  }


  dashboardMessage.classList.add(
    "hidden"
  );

}


// ============================================================
// LOGOUT
// ============================================================

if (logoutBtn) {

  logoutBtn.addEventListener(
    "click",
    async () => {

      try {

        logoutBtn.disabled =
          true;


        logoutBtn.textContent =
          "Logging out...";


        await signOut(
          auth
        );


        window.location.href =
          "./login.html";


      } catch (error) {

        console.error(
          "Logout failed:",
          error
        );


        alert(
          "Unable to log out. Please try again."
        );


        logoutBtn.disabled =
          false;


        logoutBtn.textContent =
          "Logout";

      }

    }
  );

}