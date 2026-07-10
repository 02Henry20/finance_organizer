# Capito

Capito is a private finance organizer for people who want one calm place for
cash, bank transactions, broker holdings, rules, reports, and backups.

It is built as a lightweight browser app: open it, sign in, import your exports,
review what changed, and keep your money picture understandable without turning
personal finance into a second job.

## What It Does

Capito brings everyday banking and investing into one dashboard.

- Tracks checking, savings, cash, broker, asset, and debt accounts.
- Shows net worth, liquidity, assets, receivables, debt, and monthly cashflow.
- Stores transactions with account, category, currency, note, review status, and
  import metadata.
- Manages broker holdings with quantity, buy price, current price, manual or
  provider pricing, comparison dates, and stale-price warnings.
- Separates spendable cash from long-term assets so the overview stays useful.
- Supports hidden accounts for closed, archived, or rarely used balances.

## Import And Cleanup

The import flow is designed for real exported bank files, not perfect demo data.

Supported transaction imports:

- Wise currency statements and legacy Wise CSV exports.
- Revolut CSV and consolidated XLSX/CSV statements.
- Sparkasse CSV exports.
- Trade Republic CSV activity exports.
- Generic CSV/TSV files with date, amount, description, counterparty, and
  currency fields.

Supported broker imports:

- Smartbroker XLSX/CSV position exports.
- Trade Republic CSV holdings/activity exports.

Capito previews imports before committing them. Exact duplicate transactions are
skipped automatically, suspicious rows are marked for review, and filtered rows
can be added back manually when you intentionally want to keep them.

## Rules, Categories, And Review

Capito includes editable categories and keyword rules so repeated transactions
settle into the right place over time.

- Built-in categories cover income, housing, groceries, mobility, lifestyle,
  admin costs, personal spending, transfers, investing, and debt.
- Custom categories can have colors, icons, groups, and income/expense/transfer
  behavior.
- Rules can be searched, edited, prioritized, and reapplied.
- Internal transfers can be detected from account aliases and excluded from
  spending reports.
- Transactions that need attention appear in a review queue instead of silently
  disappearing into the ledger.

## Reports

The Reports view turns the ledger into a monthly operating picture.

- Income vs spending.
- Liquidity flow and absolute balance trends.
- Category split for income, spending, or both.
- Year-over-year monthly spending comparison.
- Broker holdings overview.
- Debt progression.

Display currencies and exchange rates can be configured, so accounts can keep
their native currency while reports stay readable in your preferred currency.

## Sync, Offline Use, And Backups

Capito uses Firebase Authentication and Firestore for private user data. It also
keeps working through the browser cache when the network is unavailable.

Data tools include:

- Full JSON export and import for accounts, transactions, categories, rules,
  settings, and holdings.
- Legacy CSV export for transactions.
- Data integrity repair for invalid categories, duplicate IDs, and exact
  duplicate transactions.
- Manual sync recovery actions: keep local data, merge local and cloud data, or
  take Firebase data.
- A service worker for app-shell caching.

## Market Data

Holdings can be priced manually or refreshed through Yahoo Finance lookups. The
app stores the working provider symbol and quote metadata so future refreshes are
faster and easier to diagnose.

There is also a helper script at
`test-data/yahoo_identifier_lookup.py` for testing Yahoo identifier searches and
generating Capito-compatible holding import JSON.

## Tech Stack

- Static HTML, CSS, and vanilla JavaScript modules.
- Firebase Auth and Firestore.
- Browser service worker for cached app-shell loading.
- Browser-side CSV/TSV parsing and lightweight XLSX extraction for imports.
- No build step required for local use.

## Project Structure

```text
.
|-- index.html              # App shell and views
|-- styles.css              # Full visual system and responsive layout
|-- manifest.webmanifest    # PWA metadata and install icons
|-- service-worker.js       # Offline/app-shell cache
|-- firebase-config.js      # Firebase project config
|-- firebase.json           # Firebase hosting config
|-- firestore.rules         # Firestore security rules
|-- js/
|   |-- app.js              # UI orchestration and event handling
|   |-- store.js            # Firebase persistence and app state
|   |-- finance.js          # Categorization, totals, reports, formatting
|   |-- importer.js         # Bank and broker file import parsing
|   |-- market.js           # Quotes, Yahoo lookup, and FX rates
|   `-- charts.js           # Canvas chart rendering
|-- icons/                  # PWA, favicon, and install icons
`-- test-data/
    `-- yahoo_identifier_lookup.py
```

## Run Locally

Because the app uses JavaScript modules and a service worker, serve the folder
from a local web server instead of opening `index.html` directly.

```bash
python -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/index.html
```

## Firebase Setup

Capito expects Firebase Auth and Firestore to be available.

1. Create a Firebase project.
2. Enable Authentication for the sign-in method you want to use.
3. Enable Firestore.
4. Put your Firebase web config in `firebase-config.js`.
5. Review `firestore.rules` before deploying.
6. Deploy with Firebase Hosting if you want the app online.

## Philosophy

Capito is meant to feel practical, private, and steady. It does not try to be a
bank replacement or a trading terminal. It helps answer the questions that matter
most day to day:

- How much money is actually liquid?
- What changed this month?
- Which transactions need review?
- Are my holdings and debts moving in the right direction?
- Can I restore or audit my data if sync gets weird?

That is the whole point: fewer loose spreadsheets, fewer mystery balances, and a
clearer relationship with your own money.
