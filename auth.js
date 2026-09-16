import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  reload,
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Turns Firebase's technical error codes into friendly messages for the user
function getFriendlyErrorMessage(errorCode) {
  switch (errorCode) {
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try logging in instead.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
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

/* ---------------------------------------------
   USER PROFILE SYNC (for the admin dashboard)
   Creates/updates a users/{uid} doc every time someone
   registers, logs in, or signs in with Google. This is
   what lets the admin dashboard count and list users
   without needing a backend (the browser can't list
   Firebase Auth users directly).
--------------------------------------------- */
async function syncUserProfile(user) {
  if (!user) return;

  try {
    const userRef = doc(db, "users", user.uid);
    const existing = await getDoc(userRef);

    if (!existing.exists()) {
      await setDoc(userRef, {
        name: user.displayName || "",
        email: user.email || "",
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp()
      });
    } else {
      // Keep createdAt as-is, just refresh the profile + last-seen time.
      await setDoc(userRef, {
        name: user.displayName || existing.data().name || "",
        email: user.email || "",
        lastLogin: serverTimestamp()
      }, { merge: true });
    }
  } catch (error) {
    // Non-critical — don't block the user's login/registration over this.
    console.error("Failed to sync user profile:", error);
  }
}

// Checks the users/{uid} doc for a disabled flag, set by an admin
// on the Manage Users page. Used to block disabled accounts at login
// and on protected pages, since the browser can't disable a Firebase
// Auth account directly (that requires the Admin SDK).
async function checkIsDisabled(uid) {
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    return userDoc.exists() && userDoc.data().disabled === true;
  } catch (error) {
    console.error("Disabled-account check failed:", error);
    return false;
  }
}

/* ---------------------------------------------
   FORGOT PASSWORD PAGE
--------------------------------------------- */
const forgotPasswordForm = document.getElementById("forgotPasswordForm");

if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const messageBox = document.getElementById("formMessage");

    messageBox.textContent = "";
    messageBox.className = "form-message";

    try {
      await sendPasswordResetEmail(auth, email);
      // Note: we show the same success message even if the email doesn't exist.
      // This is intentional — it prevents anyone from using this form to check
      // which emails have accounts on our app (a common security practice).
      messageBox.textContent = "If an account exists for that email, a reset link has been sent.";
      messageBox.classList.add("success");
    } catch (error) {
      messageBox.textContent = getFriendlyErrorMessage(error.code);
      messageBox.classList.add("error");
    }
  });
}

/* ---------------------------------------------
   REGISTER PAGE
--------------------------------------------- */
const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const messageBox = document.getElementById("formMessage");

    messageBox.textContent = "";
    messageBox.className = "form-message";

    if (password !== confirmPassword) {
      messageBox.textContent = "Passwords do not match.";
      messageBox.classList.add("error");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });
      await sendEmailVerification(userCredential.user);
      await syncUserProfile(userCredential.user);

      messageBox.textContent = "Account created! Check your email to verify before logging in.";
      messageBox.classList.add("success");

      setTimeout(() => {
        window.location.href = "verify-email.html";
      }, 2000);

    } catch (error) {
      messageBox.textContent = getFriendlyErrorMessage(error.code);
      messageBox.classList.add("error");
    }
  });
}

/* ---------------------------------------------
   GOOGLE SIGN-IN (works on login.html and register.html)
--------------------------------------------- */
const googleSignInBtn = document.getElementById("googleSignInBtn");

if (googleSignInBtn) {
  googleSignInBtn.addEventListener("click", async () => {
    const provider = new GoogleAuthProvider();
    const messageBox = document.getElementById("formMessage");

    try {
      const result = await signInWithPopup(auth, provider);

      // Google accounts are already verified by Google itself, so we don't
      // need to run them through our own email verification flow -
      // user.emailVerified is automatically true for Google sign-ins.
      await syncUserProfile(result.user);

      if (await checkIsDisabled(result.user.uid)) {
        await signOut(auth);
        if (messageBox) {
          messageBox.textContent = "This account has been disabled. Contact support if you think this is a mistake.";
          messageBox.className = "form-message error";
        }
        return;
      }

      window.location.href = "dashboard.html";

    } catch (error) {
      if (error.code === "auth/popup-closed-by-user") {
        // User just closed the popup - not a real error, no need to alert
        return;
      }
      console.error("Google sign-in error:", error);
      if (messageBox) {
        messageBox.textContent = "Unable to sign in with Google. Please try again.";
        messageBox.className = "form-message error";
      }
    }
  });
}
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const messageBox = document.getElementById("formMessage");

    messageBox.textContent = "";
    messageBox.className = "form-message";

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);

      // Reload the user first — emailVerified can be stale on the cached object
      await reload(userCredential.user);

      if (await checkIsDisabled(userCredential.user.uid)) {
        await signOut(auth);
        messageBox.textContent = "This account has been disabled. Contact support if you think this is a mistake.";
        messageBox.classList.add("error");
        return;
      }

      if (!userCredential.user.emailVerified) {
        messageBox.textContent = "Please verify your email before continuing. Redirecting...";
        messageBox.classList.add("error");
        setTimeout(() => {
          window.location.href = "verify-email.html";
        }, 1500);
        return;
      }

      await syncUserProfile(userCredential.user);

      messageBox.textContent = "Login successful! Redirecting...";
      messageBox.classList.add("success");

      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 1000);

    } catch (error) {
      messageBox.textContent = getFriendlyErrorMessage(error.code);
      messageBox.classList.add("error");
    }
  });
}

/* ---------------------------------------------
   VERIFY-EMAIL PAGE
--------------------------------------------- */
const continueBtn = document.getElementById("continueBtn");
const resendBtn = document.getElementById("resendBtn");

if (continueBtn || resendBtn) {
  // Show the logged-in user's email on the page, and remember them for the buttons below
  let currentUser = null;

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      const emailSpan = document.getElementById("userEmail");
      if (emailSpan) emailSpan.textContent = user.email;
    } else {
      // Nobody is logged in — send them to login instead
      window.location.href = "login.html";
    }
  });

  if (continueBtn) {
    continueBtn.addEventListener("click", async () => {
      const messageBox = document.getElementById("formMessage");
      messageBox.textContent = "";
      messageBox.className = "form-message";

      if (!currentUser) return;

      await reload(currentUser); // refresh verification status from Firebase's servers

      if (currentUser.emailVerified) {
        await syncUserProfile(currentUser);

        messageBox.textContent = "Verified! Redirecting to your dashboard...";
        messageBox.classList.add("success");
        setTimeout(() => {
          window.location.href = "dashboard.html";
        }, 1000);
      } else {
        messageBox.textContent = "Still not verified. Please click the link in your email first.";
        messageBox.classList.add("error");
      }
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      const messageBox = document.getElementById("formMessage");
      messageBox.textContent = "";
      messageBox.className = "form-message";

      if (!currentUser) return;

      try {
        await sendEmailVerification(currentUser);
        messageBox.textContent = "Verification email sent again. Check your inbox.";
        messageBox.classList.add("success");
      } catch (error) {
        messageBox.textContent = getFriendlyErrorMessage(error.code);
        messageBox.classList.add("error");
      }
    });
  }
}

/* ---------------------------------------------
   ROUTE PROTECTION (any page with <body data-protected="true">)
--------------------------------------------- */
const isProtectedPage = document.body.hasAttribute("data-protected");

if (isProtectedPage) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      // Nobody logged in at all — kick them to login
      window.location.href = "login.html";
      return;
    }

    await reload(user); // get the freshest verification status

    if (await checkIsDisabled(user.uid)) {
      await signOut(auth);
      window.location.href = "login.html";
      return;
    }

    if (!user.emailVerified) {
      // Logged in but never verified — kick them to verify-email
      window.location.href = "verify-email.html";
      return;
    }

    // User is logged in AND verified — safe to show this page.
    // If this particular page has profile elements (like the dashboard), fill them in.
    const welcomeMessage = document.getElementById("welcomeMessage");
    const profileName = document.getElementById("profileName");
    const profileEmail = document.getElementById("profileEmail");

    if (welcomeMessage) {
      const displayName = user.displayName || "there";
      welcomeMessage.textContent = `Welcome, ${displayName}!`;
    }
    if (profileName) profileName.textContent = user.displayName || "Not set";
    if (profileEmail) profileEmail.textContent = user.email;
  });
}

/* ---------------------------------------------
   LOGOUT (works on any page with a #logoutBtn)
--------------------------------------------- */
const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    await signOut(auth);
    window.location.href = "login.html";
  });
}