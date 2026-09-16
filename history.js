import { auth, db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Call this after getting a prediction back from Flask, to save it for the user.
// Exported so detector.js can use it.
export async function saveHistoryEntry(text, prediction, confidence) {
  const user = auth.currentUser;
  if (!user) return; // safety check - shouldn't happen since detector.html is protected

  try {
    await addDoc(collection(db, "history"), {
      userId: user.uid,
      text: text.slice(0, 300), // store a preview, not the whole article, to keep documents small
      prediction: prediction,
      confidence: confidence,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    // History saving is a "nice to have" - if it fails, don't block the user's result
    console.error("Failed to save history:", error);
  }
}

// Loads the current user's most recent history entries (used on history.html)
export async function loadHistory(maxItems = 20) {
  const user = auth.currentUser;
  if (!user) return [];

  const historyQuery = query(
    collection(db, "history"),
    where("userId", "==", user.uid),
    orderBy("createdAt", "desc"),
    limit(maxItems)
  );

  const snapshot = await getDocs(historyQuery);
  return snapshot.docs.map(doc => doc.data());
}

// Computes summary stats for the dashboard: total checks, fake count, real count.
// Uses getCountFromServer(), which asks Firestore to count matching documents
// SERVER-SIDE, without downloading every document - much faster and cheaper
// than fetching everything and counting in the browser.
export async function getHistoryStats() {
  const user = auth.currentUser;
  if (!user) return { total: 0, fake: 0, real: 0 };

  const historyRef = collection(db, "history");

  const totalQuery = query(historyRef, where("userId", "==", user.uid));
  const fakeQuery = query(historyRef, where("userId", "==", user.uid), where("prediction", "==", "FAKE"));
  const realQuery = query(historyRef, where("userId", "==", user.uid), where("prediction", "==", "REAL"));

  const [totalSnap, fakeSnap, realSnap] = await Promise.all([
    getCountFromServer(totalQuery),
    getCountFromServer(fakeQuery),
    getCountFromServer(realQuery)
  ]);

  return {
    total: totalSnap.data().count,
    fake: fakeSnap.data().count,
    real: realSnap.data().count
  };
}