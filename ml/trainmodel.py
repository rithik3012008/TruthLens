import pandas as pd
import os
import joblib
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report
)

# Build paths relative to this script's location
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(SCRIPT_DIR, "..", "dataset")
data_path = os.path.join(DATASET_DIR, "processed_data.csv")

# Where we'll save the trained model + vectorizer, so Flask can load them later
MODEL_DIR = os.path.join(SCRIPT_DIR, "..", "model")
os.makedirs(MODEL_DIR, exist_ok=True)  # creates the folder if it doesn't already exist
model_path = os.path.join(MODEL_DIR, "fake_news_model.pkl")
vectorizer_path = os.path.join(MODEL_DIR, "tfidf_vectorizer.pkl")

print("Loading processed dataset...")
df = pd.read_csv(data_path)
print(f"Loaded {len(df)} rows")

# Safety check: drop any rows where 'content' ended up missing/empty.
# This can happen if an article was almost entirely numbers/symbols and
# got stripped down to nothing during cleaning in Phase 11 - pandas reads
# an empty string back from CSV as NaN.
before = len(df)
df = df.dropna(subset=["content"])
df = df[df["content"].str.strip() != ""]
after = len(df)
if before != after:
    print(f"Dropped {before - after} rows with missing/empty content")

# ---------------------------------------------
# STEP 1: Train/Test Split
# ---------------------------------------------
# We split the data so the model NEVER sees the test set during training.
# This lets us check honestly afterward: "did it actually learn patterns,
# or did it just memorize the training data?"
#
# test_size=0.2 means 80% of the data trains the model, 20% is held back for testing.
# random_state=42 makes the split reproducible - same split every time we run this.
X_train, X_test, y_train, y_test = train_test_split(
    df["content"],
    df["label"],
    test_size=0.2,
    random_state=42,
    stratify=df["label"]  # keeps the fake/real ratio consistent in both splits
)

print(f"Training set: {len(X_train)} articles")
print(f"Test set: {len(X_test)} articles")

# ---------------------------------------------
# STEP 2: TF-IDF Vectorization
# ---------------------------------------------
# max_features limits the vocabulary to the 5000 most informative words,
# which keeps training fast and avoids the model getting distracted by rare words.
# stop_words='english' automatically removes common filler words (the, is, and, etc.)
vectorizer = TfidfVectorizer(max_features=5000, stop_words="english")

# IMPORTANT: fit_transform on TRAINING data only.
# "Fitting" means the vectorizer learns the vocabulary and word-importance scores.
# We must never let it "see" the test set during fitting - that would be cheating
# (the model would get an unfair sneak peek at test data).
X_train_tfidf = vectorizer.fit_transform(X_train)

# For the test set, we only TRANSFORM (using the vocabulary already learned above),
# never fit again.
X_test_tfidf = vectorizer.transform(X_test)

print(f"TF-IDF vocabulary size: {len(vectorizer.vocabulary_)}")

# ---------------------------------------------
# STEP 3: Train Logistic Regression
# ---------------------------------------------
print("Training Logistic Regression model...")
model = LogisticRegression(max_iter=1000)
model.fit(X_train_tfidf, y_train)

# ---------------------------------------------
# STEP 4: Full Model Evaluation (Phase 13)
# ---------------------------------------------
y_pred = model.predict(X_test_tfidf)

train_accuracy = accuracy_score(y_train, model.predict(X_train_tfidf))
test_accuracy = accuracy_score(y_test, y_pred)

# Note: pos_label=1 means "REAL" is the class we're measuring precision/recall FOR,
# since we defined label 1 = REAL, 0 = FAKE back in Phase 11.
precision = precision_score(y_test, y_pred, pos_label=1)
recall = recall_score(y_test, y_pred, pos_label=1)
f1 = f1_score(y_test, y_pred, pos_label=1)
cm = confusion_matrix(y_test, y_pred)

print("\n" + "=" * 50)
print("MODEL EVALUATION")
print("=" * 50)
print(f"Training accuracy: {train_accuracy:.4f}")
print(f"Test accuracy:     {test_accuracy:.4f}")
print(f"Precision (REAL):  {precision:.4f}")
print(f"Recall (REAL):     {recall:.4f}")
print(f"F1-score (REAL):   {f1:.4f}")

print("\nConfusion Matrix:")
print("                Predicted FAKE   Predicted REAL")
print(f"Actual FAKE          {cm[0][0]:<15} {cm[0][1]}")
print(f"Actual REAL          {cm[1][0]:<15} {cm[1][1]}")

print("\nFull classification report (both classes):")
print(classification_report(y_test, y_pred, target_names=["FAKE", "REAL"]))

# ---------------------------------------------
# Try it on a made-up example, just for fun / sanity check
# ---------------------------------------------
sample_text = ["scientists confirm the earth revolves around the sun"]
sample_tfidf = vectorizer.transform(sample_text)
prediction = model.predict(sample_tfidf)[0]
print(f"Sample prediction for a test sentence: {'REAL' if prediction == 1 else 'FAKE'}")

# ---------------------------------------------
# STEP 5: Save the model + vectorizer (Phase 14)
# ---------------------------------------------
# Both files are needed together - see the explanation in Phase 14 docs
# about why the vectorizer must be saved alongside the model.
joblib.dump(model, model_path)
joblib.dump(vectorizer, vectorizer_path)

print("\n" + "=" * 50)
print("MODEL SAVED")
print("=" * 50)
print(f"Model saved to:      {model_path}")
print(f"Vectorizer saved to: {vectorizer_path}")