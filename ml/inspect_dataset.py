import pandas as pd
import os

# Build an absolute path to the dataset folder, based on THIS script's location,
# instead of relying on the current working directory (which can vary depending
# on how you run the script - terminal vs VS Code's Run button, etc.)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(SCRIPT_DIR, "..", "dataset")

fake_path = os.path.join(DATASET_DIR, "Fake.csv")
true_path = os.path.join(DATASET_DIR, "True.csv")

# Load both CSV files into pandas DataFrames (think of a DataFrame as a spreadsheet in Python)
fake_df = pd.read_csv(fake_path)
true_df = pd.read_csv(true_path)

print("=" * 50)
print("FAKE NEWS DATASET")
print("=" * 50)
print(f"Shape (rows, columns): {fake_df.shape}")
print(f"Columns: {list(fake_df.columns)}")
print("\nFirst 3 rows:")
print(fake_df.head(3))
print("\nMissing values per column:")
print(fake_df.isnull().sum())

print("\n" + "=" * 50)
print("REAL NEWS DATASET")
print("=" * 50)
print(f"Shape (rows, columns): {true_df.shape}")
print(f"Columns: {list(true_df.columns)}")
print("\nFirst 3 rows:")
print(true_df.head(3))
print("\nMissing values per column:")
print(true_df.isnull().sum())