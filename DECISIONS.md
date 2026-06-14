# DECISIONS - Architecture and Design Log

This log documents the significant engineering and product decisions made during the development of the Spreetail Shared Expenses application, highlighting the options considered and the rationale for the final choices.

---

## 1. Tech Stack Selection (Next.js App Router + SQLite)
*   **Options Considered:**
    1.  **Vite (React) + Express + PostgreSQL:** Traditional client-server split with a robust containerized database.
    2.  **Next.js (React) + SQLite:** Full-stack metaframework with an embedded relational database.
*   **Decision:** **Next.js + SQLite**
*   **Rationale:**
    *   Next.js provides server-side API routes and client-side pages in a single, cohesive repository, simplifying local deployment and startup.
    *   SQLite is a fully relational SQL database that stores its data in a single local file (`database.sqlite`). This eliminates the need for the user to install, configure, or run a separate database container/service (like Postgres/MySQL), making the app extremely portable and immediate to run.
    *   Using SQLite meets the core requirement: *"Use relational DBs only."*

---

## 2. Query execution layer (Raw SQL via `better-sqlite3`)
*   **Options Considered:**
    1.  **Prisma ORM:** Modern typescript ORM.
    2.  **Raw SQL queries using `better-sqlite3` driver:** Hand-written SQL queries executed directly.
*   **Decision:** **Raw SQL queries using `better-sqlite3`**
*   **Rationale:**
    *   To prepare for the live live coding/interview session where evaluators can *"point at any line in your repository and ask why it exists,"* raw SQL provides 100% transparency. There are no hidden ORM magic queries, implicit schema definitions, or complex configuration layers.
    *   `better-sqlite3` is synchronous, incredibly fast, and simple to use in Next.js API routes without database pooling overhead.
    *   Transactions are declared explicitly via `db.transaction()`, making it easy to explain exactly how database atomicity is guaranteed during CSV ingest.

---

## 3. CSV Import Policy: Interactive Wizard vs. Silent Auto-Resolutions
*   **Options Considered:**
    1.  **Silent Guessing:** Implement heuristics to make the best guess and import silently (e.g., auto-assigning missing payers, auto-averaging percentages).
    2.  **Interactive Resolution Wizard (Chosen):** Parse the file, return all anomalies, and halt the ingest to let the user review and resolve ambiguities in the UI.
*   **Decision:** **Interactive Resolution Wizard**
*   **Rationale:**
    *   Silent guesses are flagged as failing answers in the assignment: *"A crashed import and a silent guess are both failing answers."*
    *   Flatmate Meera explicitly requested: *"Clean up the duplicates — but I want to approve anything the app deletes or changes."*
    *   An interactive wizard surfaces anomalies (like percentage mismatches, duplicate event logs, and ambiguous dates) to the screen, giving the user agency over how their money is divided. Once the user approves the resolutions, they are posted atomically to the database.

---

## 4. Duplicate and Conflict Detection Heuristics
*   **Options Considered:**
    1.  **Exact string matching on description:** Matches only if descriptions are character-identical.
    2.  **Word-token overlap comparison (Chosen):** Splits descriptions into words, filters out filler words (e.g., "at", "the", "for"), and checks if the remaining words overlap significantly.
*   **Decision:** **Word-token overlap comparison**
*   **Rationale:**
    *   Payer Dev logged `"Dinner at Marina Bites"` and `"dinner - marina bites"` on the same day. Payer Aisha logged `"Dinner at Thalassa"` and Rohan logged `"Thalassa dinner"`.
    *   An exact string comparison fails to match these due to punctuation, casing, word order, and filler words.
    *   Word token overlap identifies that both pairs refer to the exact same event and correctly flags them as duplicate/conflict anomalies for the user to resolve.

---

## 5. Debt Settlement Simplification Algorithm (Greedy Debt Minimization)
*   **Options Considered:**
    1.  **Bilateral Settlements:** Everyone pays back who they directly owe. Results in $O(N^2)$ transactions.
    2.  **Greedy Net Debt Minimization (Chosen):** Calculate the net balance of each user, separate into debtors and creditors, and greedily match the largest debtor with the largest creditor.
*   **Decision:** **Greedy Net Debt Minimization**
*   **Rationale:**
    *   Directly addresses Aisha's request: *"I just want one number per person. Who pays whom, how much, done."*
    *   Reduces the number of transactions to at most $N-1$ (where $N$ is the number of members), simplifying repayment. For example, if A owes B, and B owes C, A pays C directly.

---

## 6. Audit Trail Representation ("No Magic Numbers")
*   **Options Considered:**
    1.  **Display only net totals:** Show the user their final balance.
    2.  **Running Ledger (Chosen):** Display a full list of all expenses and settlements the user participated in, showing the date, total amount, payer, their share, and the resulting running balance.
*   **Decision:** **Running Ledger**
*   **Rationale:**
    *   Directly addresses Rohan's request: *"No magic numbers. If the app says I owe ₹2,300, I want to see exactly which expenses make that up."*
    *   Provides full accountability, allowing any user to audit their balance calculation by hand.
