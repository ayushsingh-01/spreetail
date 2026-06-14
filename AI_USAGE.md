# AI USAGE - Tooling and Corrections Log

This document records the AI tools, key prompts, and specific corrections made during the development of the Spreetail Shared Expenses application.

---

## AI Tools Used
*   **Primary Development Collaborator:** Antigravity (Google DeepMind Advanced Agentic Coding) using Gemini 3.5 Flash.
*   **Key Interface:** Terminal command executions, file read/write operations, and web searches for Next.js options.

---

## Key Prompts & Iterations
1.  **Initial Goal Ingestion:**
    *   *Prompt:* Read the assignment PDF and `Expenses Export.csv` and implement the application.
    *   *Action:* Extracted the text contents of the PDF via `view_file` OCR. Analysed the CSV structure and manually mapped all 12+ data anomalies.
2.  **Implementation Plan Review:**
    *   *Prompt:* Created an implementation plan detailing the SQLite schema, API routes, and CSV resolution stepper UI, which was approved by the user.

---

## Concrete Cases of AI Errors and Corrections

### Case 1: Directory Naming Conflict in Next.js Setup
*   **What the AI produced wrong:** The AI attempted to bootstrap the Next.js application by executing:
    ```bash
    npx -y create-next-app@latest ./ --js --eslint --app --src-dir --no-tailwind --import-alias "@/*" --use-npm --disable-git --yes
    ```
    Since the current working directory was `Z:\Spreetail\Expense`, `create-next-app` attempted to name the package `Expense` in `package.json`. This crashed the script.
*   **How it was caught:** The command failed with exit code 1:
    ```
    Could not create a project called "Expense" because of npm naming restrictions:
        * name can no longer contain capital letters
    ```
*   **What was changed:** We resolved the error by manually creating a clean `package.json` with `shared-expenses-app` as the name, then running `npm install`. This bypassed the directory naming restrictions, avoided boilerplate clutter, and ensured the setup remained transparent.

---

### Case 2: Incorrect Property Key Reference in Duplicate Detection
*   **What the AI produced wrong:** In `src/lib/parser.js`, the AI implemented the date matching check for duplicates as:
    ```javascript
    const sameDate = rowA.parsedDate === rowB.parsedDate;
    ```
    However, the row objects returned by `parseCSVData` stored the cleaned date under the `date` key, not `parsedDate`. Because both evaluations resolved to `undefined`, the check `undefined === undefined` evaluated to `true`. This caused the script to match any records with similar descriptions across different days.
*   **How it was caught:** We ran `node verification_test.mjs`. The test output flagged 7 conflicts including "Groceries BigBasket" entries in February, March, and April as duplicate conflicts, which was incorrect as they were distinct monthly grocery bills.
*   **What was changed:** Modified the duplicate detection logic in `src/lib/parser.js` to reference the correct property `row.date`.

---

### Case 3: Inadequate Description Similarity Heuristics
*   **What the AI produced wrong:** The initial duplicate detector used a basic substring containment check on the alphanumeric cleaned description (`descA.includes(descB) || descB.includes(descA)`). This check failed to detect Dev's duplicate dinners:
    *   `"Dinner at Marina Bites"` (cleaned to `dinneratmarinabites`)
    *   `"dinner - marina bites"` (cleaned to `dinnermarinabites`)
    Because of the filler word "at", neither string was a substring of the other, so the duplicate dinner was missed.
*   **How it was caught:** We ran `node verification_test.mjs` after fixing Case 2. The script output `Found 0 duplicate/conflict pairs`, meaning it missed the Marina Bites duplicate dinners on February 8th.
*   **What was changed:** Refactored the duplicate matching logic in `src/lib/parser.js` to split description strings into words, filter out common short filler words (words of length <= 2 like "at", or words like "the", "for"), and check if the remaining keyword arrays share a significant overlap. This successfully detected both the Marina Bites exact duplicate and the Thalassa dinner amount conflict.
