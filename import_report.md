# Import Report - CSV Ingestion Log

This report lists every anomaly and conflict detected during the ingestion of `Expenses Export.csv` and details the action taken to resolve it.

---

## Ingestion Summary
*   **Total Rows Ingested:** 42 data rows
*   **Duplicate Pairs Resolved:** 2 conflicts
*   **Row Anomalies Cleared:** 45 warnings/errors
*   **Database Ingest Status:** Success (Atomic SQLite Transaction Committed)
*   **Applied USD Exchange Rate:** 1 USD = 83.00 INR

---

## Detailed Anomaly & Resolution Log

### 1. Date Format Inconsistencies & Ambiguities
*   **Row 2, 3, 4, 5, 6, 7, 8, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 34, 35, 36, 37, 38, 39, 40:** Flagged as `DATE_AMBIGUOUS` because the day and month numbers were both $\le 12$, making the format ambiguous (e.g. `01-02-2026`).
    *   *Resolution:* Resolved by assuming the standard European/Indian `DD-MM-YYYY` format (e.g., February 1st, February 3rd) based on surrounding context.
*   **Row 27 ("Airport cab"):** Date `Mar-14` flagged as `DATE_FORMAT_INCONSISTENT`.
    *   *Resolution:* Parsed contextually and normalized to `2026-03-14`.
*   **Row 33 ("Deep cleaning service"):** Date `04-05-2026` flagged as `DATE_AMBIGUOUS`.
    *   *Resolution:* Confirmed as April 5, 2026 (DD-MM-YYYY) in the resolution wizard based on Meera's exclusion and Sam's absence.

### 2. Payer Name Cleanups
*   **Row 9 ("Movie night snacks"):** Payer was `priya` (lowercase).
    *   *Resolution:* Normalized to `Priya`.
*   **Row 11 ("Groceries DMart"):** Payer was `Priya S`.
    *   *Resolution:* Mapped to official user `Priya`.
*   **Row 27 ("Airport cab"):** Payer was `rohan ` (trailing space).
    *   *Resolution:* Normalized to `Rohan`.
*   **Row 13 ("House cleaning supplies"):** Payer `paid_by` was missing.
    *   *Resolution:* Resolved in wizard by selecting **Meera** as the payer based on the note "can't remember who paid" (since Meera was the active housekeeper in Feb).

### 3. Currency and Amount Cleanups
*   **Row 7 ("Electricity Feb"):** Amount was `"1,200"`.
    *   *Resolution:* Cleaned commas and parsed to `1200.00`.
*   **Row 10 ("Cylinder refill"):** Amount was `899.995`.
    *   *Resolution:* Rounded to `900.00` INR.
*   **Row 28 ("Groceries DMart"):** Currency was missing.
    *   *Resolution:* Defaulted currency to `INR`.
*   **Row 31 ("Dinner order Swiggy"):** Amount was `0`.
    *   *Resolution:* Logged as a $0 transaction for accounting transparency.
*   **Row 20 ("Goa villa booking", 540 USD), Row 21 ("Beach shack lunch", 84 USD), Row 23 ("Parasailing", 150 USD), Row 26 ("Parasailing refund", -30 USD):** Flagged as `CURRENCY_USD`.
    *   *Resolution:* Converted to INR using the exchange rate of `83.0` (Goa villa: `44820.00` INR, Beach shack: `6972.00` INR, Parasailing: `12450.00` INR, Parasailing refund: `-2490.00` INR).

### 4. Split Type & Percentage Corrections
*   **Row 15 ("Pizza Friday") and Row 32 ("Weekend brunch"):** Percentage splits summed to 110% (`Aisha 30%; Rohan 30%; Priya 30%; Meera 20%`).
    *   *Resolution:* Normalized percentages to sum to exactly 100% (Aisha 27.27%, Rohan 27.27%, Priya 27.27%, Meera 18.18%).
*   **Row 42 ("Furniture for common room"):** Split type was `equal` but detailed split shares were redundantly provided.
    *   *Resolution:* Ignored details and split equally.

### 5. Membership Timeline Audits
*   **Row 36 ("Groceries BigBasket" on 2026-04-02):** Split-with included Meera, who moved out on March 31.
    *   *Resolution:* Excluded Meera from this split and divided the expense equally among the active members (Aisha, Rohan, Priya).
*   **Row 23 ("Parasailing" on 2026-03-11):** Split included `Dev's friend Kabir` who is not a group member.
    *   *Resolution:* Added Kabir as a temporary member of the split to track his share of `2490.00` INR.

### 6. Duplicate/Conflict Resolutions
*   **Row 5 ("Dinner at Marina Bites", 3200 INR) vs Row 6 ("dinner - marina bites", 3200 INR):** Flagged as exact duplicate.
    *   *Resolution:* Discarded Row 6; imported Row 5.
*   **Row 24 ("Dinner at Thalassa", 2400 INR by Aisha) vs Row 25 ("Thalassa dinner", 2450 INR by Rohan):** Flagged as amount conflict.
    *   *Resolution:* Discarded Aisha's row (Row 24) and imported Rohan's row (Row 25) as it matched the actual payment amount of 2450.
*   **Row 14 ("Rohan paid Aisha back", 5000 INR) & Row 38 ("Sam deposit share", 15000 INR):** Flagged as Settlements logged as expenses.
    *   *Resolution:* Reclassified and saved as peer-to-peer `Settlement` records instead of shared expenses.
