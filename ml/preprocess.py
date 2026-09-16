import pandas as pd
import re
import os

# Build paths relative to THIS script's location (same trick as Phase 10,
# so this works no matter how/where you run it from)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(SCRIPT_DIR, "..", "dataset")

fake_path = os.path.join(DATASET_DIR, "Fake.csv")
true_path = os.path.join(DATASET_DIR, "True.csv")
output_path = os.path.join(DATASET_DIR, "processed_data.csv")


def clean_text(text):
    """
    Basic text cleanup before feeding it to TF-IDF later.
    - Lowercase everything (so 'Trump' and 'trump' count as the same word)
    - Remove URLs
    - Remove anything that isn't a letter or space (numbers, punctuation, symbols)
    - Collapse multiple spaces into one
    """
    text = text.lower()
    text = re.sub(r"http\S+|www\S+", " ", text)      # remove URLs
    text = re.sub(r"[^a-z\s]", " ", text)             # remove punctuation/numbers
    text = re.sub(r"\s+", " ", text).strip()          # collapse extra whitespace
    return text


print("Loading datasets...")

# IMPORTANT: only load the 4 real columns from Fake.csv, ignoring the
# 168 junk 'Unnamed' columns we discovered in Phase 10
fake_df = pd.read_csv(fake_path, usecols=["title", "text", "subject", "date"])
true_df = pd.read_csv(true_path, usecols=["title", "text", "subject", "date"])

print(f"Fake.csv loaded: {fake_df.shape[0]} rows")
print(f"True.csv loaded: {true_df.shape[0]} rows")

# Step 1: Add the label column
# 0 = FAKE, 1 = REAL  -- we'll use this exact mapping everywhere from now on
fake_df["label"] = 0
true_df["label"] = 1

# Step 2: Combine title + text into one "content" column
fake_df["content"] = fake_df["title"].fillna("") + " " + fake_df["text"].fillna("")
true_df["content"] = true_df["title"].fillna("") + " " + true_df["text"].fillna("")

# Step 3: Keep only what we need going forward
fake_df = fake_df[["content", "label"]]
true_df = true_df[["content", "label"]]

# Step 4: Merge both into one dataset
combined_df = pd.concat([fake_df, true_df], ignore_index=True)
print(f"Combined dataset: {combined_df.shape[0]} rows")

# Step 5: Drop any rows where content ended up empty
before = len(combined_df)
combined_df = combined_df[combined_df["content"].str.strip() != ""]
after = len(combined_df)
print(f"Dropped {before - after} rows with empty content")

# Step 6: Clean the text
print("Cleaning text (this may take a minute for large datasets)...")
combined_df["content"] = combined_df["content"].apply(clean_text)

# Step 6b: Some articles were almost entirely numbers/symbols and became
# empty strings AFTER cleaning (not before) - drop those too, otherwise
# they get saved as blank and reload as NaN, breaking TF-IDF later.
before_clean_drop = len(combined_df)
combined_df = combined_df[combined_df["content"].str.strip() != ""]
after_clean_drop = len(combined_df)
if before_clean_drop != after_clean_drop:
    print(f"Dropped {before_clean_drop - after_clean_drop} rows that became empty after cleaning")

# Step 7: Shuffle the dataset so fake/real rows are mixed, not grouped in blocks
combined_df = combined_df.sample(frac=1, random_state=42).reset_index(drop=True)

# Step 8: Save the final result
combined_df.to_csv(output_path, index=False)

print("\n" + "=" * 50)
print("DONE")
print("=" * 50)
print(f"Saved to: {output_path}")
print(f"Total rows: {len(combined_df)}")
print("Label counts:")
print(combined_df["label"].value_counts())
print("\nSample row:")
print(combined_df.iloc[0])