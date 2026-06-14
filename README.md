# Shared Expenses Application - Spreetail Assignment

A premium shared expenses manager and debt minimization application built with Next.js App Router and SQLite, designed to resolve messy group expenses with an interactive anomaly resolution wizard, running ledgers, and automated debt simplification.

---

## Technical Stack
*   **Frontend & Logic:** Next.js 15 (React 19) client components
*   **Database:** SQLite (`better-sqlite3`) executing raw SQL queries
*   **Styling:** Vanilla CSS implementing a modern dark glassmorphic design
*   **CSV Parsing:** `csv-parse` on API route streams
*   **AI Collaborator:** Antigravity (Google DeepMind Advanced Agentic Coding) using Gemini 3.5 Flash

---

## Core Features
1.  **Aisha's View (Debt Minimization):** Implements a greedy debt simplification algorithm to calculate the absolute minimum number of peer-to-peer settlement payments required to clear all debts.
2.  **Rohan's View (Running Ledger):** Shows a detailed ledger for any chosen member. Every single transaction they participated in is listed along with their exact share, preventing "magic numbers."
3.  **Sam's View (Membership Dates):** Relational memberships track start/end dates. March expenses do not affect Sam's balance since he moved in mid-April.
4.  **Meera's View (Interactive CSV Importer):** The step-by-step CSV ingestion wizard detects 16 types of data anomalies (payer aliases, decimal rounding, empty currencies, out-of-bounds dates, amount format formatting, negative refunds, and duplicate/conflict transactions) and allows the user to review and approve resolutions before write.

---

## Setup & Running Instructions

### 1. Installation
Clone the repository and install the dependencies:
```bash
npm install
```

### 2. Run Database Seeding
The SQLite database file (`database.sqlite`) is initialized and seeded automatically with default users (`Aisha`, `Rohan`, `Priya`, `Meera`, `Sam`, `Dev`, `Kabir`) and memberships when the application starts.

### 3. Run Parser Test (Isolation Check)
You can run our parser verification script to inspect all anomalies and duplicate conflicts detected in `Expenses Export.csv`:
```bash
node verification_test.mjs
```

### 4. Run Development Server
Start the Next.js dev server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## CSV Ingestion Walkthrough
1.  Navigate to the **CSV Ingestion Wizard** tab.
2.  Select or drag `Expenses Export.csv` into the upload zone.
3.  Review the flagged anomalies:
    *   **USD Rate:** Customize the exchange rate for USD rows (e.g. `83.0`).
    *   **Duplicates:** Choose which row to keep for Thalassa Dinner (Row 24 vs 25) and Marina Bites (Row 5 vs 6).
    *   **Percentages:** Approve weighted normalization for 110% Pizza/Brunch splits.
    *   **Missing Payer:** Select the payer for the house cleaning supplies.
    *   **Out of bounds:** Confirm Meera's exclusion from the April grocery split.
    *   **External Member:** Assign Kabir's parasailing cost to Dev or add him as a member.
4.  Click **Apply Resolutions & Import** to write atomically to the SQLite database.
5.  Go to the **Dashboard** or **Audit Ledger** tabs to verify balances.

---

## Deployment Guidelines (SQLite Persistence)

This application uses a local SQLite database (`database.sqlite`). When deploying, please take note of the following rules regarding local database persistence:

### 1. Serverless Platforms (e.g., Vercel, Netlify)
*   **Avoid standard SQLite on Vercel:** Vercel serverless functions are read-only and stateless. Any writes to `database.sqlite` will either throw write-permission errors or be reset when container instances recycle.
*   **Vercel Migration:** To deploy on Vercel, swap out the SQLite client in `src/lib/db.js` with a hosted serverless database like **Turso** (stateless/hosted SQLite) or a cloud database like Neon (PostgreSQL).

### 2. Persistent Container Hosting (e.g., Render, Railway, DigitalOcean, Fly.io)
*   **Recommended Strategy:** Deploy the Next.js application as a standard Node.js container or service (running `npm start` after `npm run build`), and attach a **Persistent Disk/Volume** (e.g., 1GB).
*   **Volume Mount Path:** Mount the volume path (e.g., `/data`) and point the database path in `src/lib/db.js` to `/data/database.sqlite` to ensure all flatmate transactions and anomaly logs are safely stored across restarts and builds.

