import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Turns Firebase's technical error codes into friendly messages
function getFriendlyErrorMessage(errorCode) {
  switch (errorCode) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/missing-password":
      return "Please enter a password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

// An "admin" is any user with a doc at admins/{uid} in Firestore.
// To make yourself an admin: in the Firebase console, go to Firestore,
// create a collection called "admins", then add a document whose ID
// is EXACTLY your Firebase Auth uid (find it in Authentication > Users).
// The document's fields don't matter — just its existence is checked.
async function checkIsAdmin(uid) {
  try {
    const adminDoc = await getDoc(doc(db, "admins", uid));
    return adminDoc.exists();
  } catch (error) {
    console.error("Admin check failed:", error);
    return false;
  }
}

/* ---------------------------------------------
   ADMIN LOGIN PAGE
--------------------------------------------- */
const adminLoginForm = document.getElementById("adminLoginForm");

if (adminLoginForm) {
  adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const messageBox = document.getElementById("formMessage");
    const submitBtn = adminLoginForm.querySelector("button[type='submit']");

    messageBox.textContent = "";
    messageBox.className = "form-message";
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const isAdmin = await checkIsAdmin(userCredential.user.uid);

      if (!isAdmin) {
        // Not an admin — sign them straight back out. Don't let a valid
        // TruthLens login double as admin access.
        await signOut(auth);
        messageBox.textContent = "This account doesn't have admin access.";
        messageBox.classList.add("error");
        return;
      }

      messageBox.textContent = "Welcome back. Redirecting...";
      messageBox.classList.add("success");

      setTimeout(() => {
        window.location.href = "admin-dashboard.html";
      }, 700);

    } catch (error) {
      messageBox.textContent = getFriendlyErrorMessage(error.code);
      messageBox.classList.add("error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Login to Admin Panel \u2192";
    }
  });
}

/* ---------------------------------------------
   ROUTE PROTECTION
   Add data-admin-protected="true" to <body> on any
   page that should require a logged-in admin.
--------------------------------------------- */
const isProtectedAdminPage = document.body.hasAttribute("data-admin-protected");

if (isProtectedAdminPage) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "admin-login.html";
      return;
    }

    const isAdmin = await checkIsAdmin(user.uid);

    if (!isAdmin) {
      // A regular TruthLens user wandered in with a direct link — boot them.
      await signOut(auth);
      window.location.href = "admin-login.html";
      return;
    }

    const adminName = document.getElementById("adminName");
    const adminEmail = document.getElementById("adminEmail");
    const adminWelcome = document.getElementById("adminWelcome");

    if (adminName) adminName.textContent = user.displayName || "Admin";
    if (adminEmail) adminEmail.textContent = user.email;
    if (adminWelcome) adminWelcome.textContent = `Welcome, ${user.displayName || "Admin"}`;
  });
}

/* ---------------------------------------------
   LOGOUT (any page with #adminLogoutBtn)
--------------------------------------------- */
const adminLogoutBtn = document.getElementById("adminLogoutBtn");

if (adminLogoutBtn) {
  adminLogoutBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    await signOut(auth);
    window.location.href = "admin-login.html";
  });
}