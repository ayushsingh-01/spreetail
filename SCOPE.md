# SCOPE - CSV Anomaly Log & Database Schema

This document details all 12+ deliberate data anomalies identified in `expenses_export.csv` and documents the policy applied to resolve each. It also outlines the relational database schema implemented.

---

## Identified Data Anomalies & Resolution Policies

Our parser detects, surfaces, and resolves the following deliberate data problems:

### 1. Payer Name Case Sensitivity
*   **Problem:** Row 9 specifies the payer as `priya` (lowercase) instead of standard capital casing.
*   **Policy:** Normalized to `Priya` automatically. Surfaces as a low-severity anomaly in the import report.

### 2. Trailing Spaces in User Names
*   **Problem:** Row 27 lists payer `rohan ` with a trailing space.
*   **Policy:** Trailing spaces are stripped automatically and matched to `Rohan`. Surfaces as a low-severity anomaly.

### 3. Payer Name Alias / Variation
*   **Problem:** Row 11 lists `Priya S` instead of `Priya`.
*   **Policy:** Mapped to official user list (`Priya`) using an alias lookup table. Surfaces as a low-severity anomaly.

### 4. Text Formatting in Amounts
*   **Problem:** Row 7 amount is formatted with a comma as a string: `"1,200"`.
*   **Policy:** Commas are stripped, and the value is parsed as a floating-point number (`1200.00`). Surfaces as a low-severity anomaly.

### 5. Numerical Rounding & Precision
*   **Problem:** Row 10 has a fractional amount with 3 decimal places (`899.995`).
*   **Policy:** Rounded to 2 decimal places (`900.00`) to maintain currency scale precision. Surfaces as a low-severity anomaly.

### 6. Missing Payer (`paid_by`)
*   **Problem:** Row 13 has a blank `paid_by` field with notes "can't remember who paid".
*   **Policy:** The parser flags this as a high-severity block. The import wizard halts and prompts the user to select the payer from the split participants list before allowing the database ingest.

### 7. Settlements Logged as Expenses
*   **Problem:** Row 14 (`Rohan paid Aisha back`, amount 5000, empty `split_type`) and Row 38 (`Sam deposit share`, amount 15000, equal split) are settlements, not shared group expenses.
*   **Policy:** The importer detects descriptions/notes containing keywords like "paid back" or "deposit" and classifies them as peer-to-peer `Settlements`. This directly alters the payer and payee balances, bypassing regular expense split logic.

### 8. Percentage Sum Errors
*   **Problem:** Row 15 (`Pizza Friday`) and Row 32 (`Weekend brunch`) splits sum to 110% (`Aisha 30%; Rohan 30%; Priya 30%; Meera 20%`).
*   **Policy:** The importer flags this as a high-severity error. The UI presents the user with a choice to auto-normalize the weights to sum to exactly 100% (Aisha 27.27%, Rohan 27.27%, Priya 27.27%, Meera 18.18%) or manually modify the percentages.

### 9. Foreign Currency Conversion (USD)
*   **Problem:** Rows 20, 21, 23, and 26 are logged in `USD`.
*   **Policy:** The parser flags `USD` currency. The UI allows the user to specify an exchange rate (defaulting to `83.0` INR per USD). The database stores the original currency/amount and the computed `converted_amount_inr` for transparent auditing.

### 10. Negative Expense Amounts (Refunds)
*   **Problem:** Row 26 is a refund of `-30` USD for parasailing.
*   **Policy:** Imported as a negative expense. This reduces the payer's credit and decreases the outstanding debts of the split participants by their respective shares, maintaining mathematical consistency.

### 11. Unrecognized/External Member
*   **Problem:** Row 23 (`Parasailing`) includes `Dev's friend Kabir` in the split, who is not a regular group member.
*   **Policy:** The UI flags this and prompts the user:
    *   **Option A (Default):** Add Kabir as a temporary member of the group/split.
    *   **Option B:** Reassign Kabir's share directly to Dev (meaning Dev absorbs his friend's expense).

### 12. Date Format Inconsistencies
*   **Problem:** Row 27 date is formatted as `Mar-14` instead of standard `DD-MM-YYYY`.
*   **Policy:** Parsed contextually using calendar month keywords. Assumes the year is 2026 based on surrounding entries. Normalizes to `2026-03-14`.

### 13. Missing Currency
*   **Problem:** Row 28 (`Groceries DMart`) has an empty currency column.
*   **Policy:** Automatically defaulted to `INR`. Surfaces as a medium-severity anomaly.

### 14. Zero Amount Expense
*   **Problem:** Row 31 (`Dinner order Swiggy`) has an amount of `0`.
*   **Policy:** Surfaced as a medium-severity warning. Allowed to import as a zero-value expense for ledger auditing, having no impact on user balances.

### 15. Date Format Ambiguity
*   **Problem:** Row 34 (`Deep cleaning service`) date is `04-05-2026` with notes "is this April 5 or May 4?".
*   **Policy:** Flagged as an ambiguous date. The UI displays a radio button letting the user resolve it to April 5th (standard DD-MM-YYYY) or May 4th.

### 16. Out-of-Bounds Group Membership
*   **Problem:** Row 36 (`Groceries BigBasket`) occurs on `2026-04-02` and splits with Meera. However, Meera moved out on March 31.
*   **Policy:** Flagged as a high-severity membership violation. The UI prompts the user to:
    *   **Option A (Default):** Exclude Meera from this specific split and distribute her share among the active members.
    *   **Option B:** Keep her in the split anyway (forcing her to pay for it).

---

## Relational Database Schema

We use **SQLite** as the database engine. Below is the SQL structure of the tables:

```sql
-- Users in the system
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  email TEXT
);

-- Expense sharing groups
CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT
);

-- Member timelines to support members joining and leaving over time
CREATE TABLE group_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at TEXT NOT NULL, -- YYYY-MM-DD
  left_at TEXT, -- YYYY-MM-DD (NULL if currently active)
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Core expenses table
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  converted_amount_inr REAL NOT NULL,
  paid_by_user_id INTEGER NOT NULL,
  split_type TEXT CHECK(split_type IN ('equal', 'unequal', 'percentage', 'share')) NOT NULL,
  expense_date TEXT NOT NULL, -- YYYY-MM-DD
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Splits for each expense, allocating costs per user
CREATE TABLE expense_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  raw_split_value REAL NOT NULL, -- raw percentage, share weight, or direct amount
  calculated_amount_inr REAL NOT NULL,
  FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Peer-to-peer settlement payments
CREATE TABLE settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  payer_id INTEGER NOT NULL,
  payee_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  converted_amount_inr REAL NOT NULL,
  settlement_date TEXT NOT NULL, -- YYYY-MM-DD
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (payee_id) REFERENCES users(id) ON DELETE CASCADE
);
```
