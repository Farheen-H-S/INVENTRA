# Inventra Stock Reconciliation

Inventra is a small, usable inventory stock-taking application for a second-year web development project. It focuses on one workflow: load recorded quantities, enter a physical count, compare the two, and review the variances. It does not replace an accounting or ERP system.

## Project features

- Create an account, sign in and sign out.
- Add, edit, search, delete and CSV-import products.
- Start a dated reconciliation that snapshots the expected quantities.
- Save physical counts as work progresses and see count progress.
- Complete a reconciliation only after every product has a count.
- Calculate `variance = physical quantity - expected quantity` and label non-zero values **Requires review**.
- Add remarks to result rows, browse reconciliation history, export a CSV and print/save a report as PDF.
- Use the responsive interface on a desktop, tablet or phone.

The sample business and stock records are fictional demonstration data. The app records a variance; it does not infer why it happened.

## Requirements

- Node.js 22.5 or newer (the app uses Node's built-in SQLite module).
- npm, included with the Node.js installer.
- A current browser.

## Run on Windows

1. Install Node.js 22.5 or newer from the official Node.js website.
2. Extract this project folder and open PowerShell in that folder.
3. Install the two server packages:

   ```powershell
   npm install
   ```

4. Create the demo account and sample inventory:

   ```powershell
   npm run seed
   ```

5. Start the app:

   ```powershell
   npm start
   ```

   To use another port in PowerShell, set `$env:PORT = "3001"` before `npm start`.

6. Open `http://localhost:3000` in a browser.

Demo login: **demo@inventra.local** / **InventraDemo2026!**

To try CSV import, use `data/sample_inventory.csv`. The seed script already adds the same example products to the demo account. You can also create your own account from the sign-up form.

## Demonstration flow

1. Sign in with the demo account.
2. Open **Inventory**. Add a product or import `data/sample_inventory.csv`.
3. Open **Reconciliations** and create a count, for example, `September Stock Check`.
4. Enter actual quantities for products. Save each count; the progress indicator updates.
5. Complete the count when all products have a physical quantity.
6. Review matched items and items requiring review. Add a remark to explain what should be checked next.
7. Download the CSV report or use **Print / Save PDF**. Reopen **Reconciliations** to show history.

## CSV format

The importer expects a header row with these fields:

```csv
product_id,product_name,variant,expected_quantity
HW001,PVC Connector,20mm,120
EL024,Switch,16A,80
```

`product_id` is the SKU and must be unique within the business account. `variant` may be blank. The quantity must be a whole number greater than or equal to zero. Importing a SKU already in the account updates that product.

## Project structure

```text
Inventra-College-Project/
├── data/                  # Sample CSV; SQLite database is created here at runtime
├── public/                # Responsive single-page web interface
├── scripts/seed.js        # Creates the demo account and sample stock
├── src/
│   ├── auth.js            # Password hashing and session helpers
│   ├── csv.js             # CSV parsing and validation
│   └── db.js              # SQLite setup and schema
├── server.js              # Express routes and application server
└── package.json
```

## Design notes

- `users` own their products and reconciliations. API queries scope records to the signed-in user.
- A reconciliation stores a snapshot of each product's SKU, name, variant and expected quantity. Later inventory edits do not rewrite old results.
- Physical counts remain editable until the user completes the reconciliation.
- A variance is calculated only as `physical - expected`. Zero means **Matched**; any other result means **Requires review**. The application does not label stock as missing or decide the cause.
- Passwords use Node's built-in `scrypt` with a random salt. Sessions use random opaque tokens, store only token hashes in SQLite, and expire after seven days.
- SQLite is suitable for a local academic demonstration with one app process. A real multi-user client deployment should use a managed database, HTTPS, backups and institution/client security review.

## Submission notes

Replace the student, guide, institute and academic-year placeholders in the report and slide deck before submission. The client utility certificate is a blank form: an actual client representative must review the running application and complete/sign it. No real client or field validation is claimed in this project.

The `submission/` folder contains the editable project report, a seven-slide demonstration presentation and the blank client utility certificate template.
