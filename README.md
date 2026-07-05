# Capito stable update

Deploy the files in this folder exactly as-is.

Included in this build:
- Keeps the stable login/auth flow.
- Removes automatic default seeding of accounts, categories and rules.
- Delete all data now leaves accounts/categories/rules/transactions/holdings truly empty.
- Adds Settings → Check / repair sync for Firebase/offline-cache troubleshooting.
- Keeps account start balance as an editable starting point, not a transaction.
- Bank import recognizes Wise, Revolut, Sparkasse, Trade Republic and generic CSV/TSV.
- Broker position import recognizes Smartbroker XLSX/CSV and Trade Republic CSV.
- Exact duplicate transactions are skipped during import.
- New Capito icon is used on the start screen, header, manifest and favicon.

If a browser keeps old behavior, open `/cache-reset.html`, reset cache once, then open `/index.html`.


## Update: sync resolution, display currency, unified import

- Settings sync troubleshooting now has three manual resolution actions:
  - Keep local: upload the current local/offline state to Firebase.
  - Merge both: combine local and Firebase records, preferring newer records when IDs conflict.
  - Take Firebase: discard the local/offline view and reload server data.
- Accounts page has a Display currency selector. This affects account cards and the home balances chart display only; it does not change native account currencies.
- The import page now uses one unified file input. It auto-detects bank transactions and broker holdings from the same file when possible.


## v20 update

- Account display currency is now set independently per account card or in the account edit modal.
- Mobile Reports first box has been rearranged to keep Month/Year in the upper-right and Month/Compare Year below.
- Desktop sync troubleshooting has a wider, single-line button layout.


## v21 update

- Desktop sync troubleshooting buttons are below the explanation text.
- Account display currency is inside each account's gear menu.
- Display currency options are limited to main currency and the account's native currency.
- Removed the explanatory note below account display currency.


## v22 update

- Desktop broker positions modal keeps the two toggle groups side by side:
  - Since buy / Today
  - Amount / Percent


## v23 update

- Home card visual polish: centered change box, larger trend line, stronger net-worth number styling.
- Cashflow order changed to amount line first, label second.
- Header logo/wordmark enlarged.
- Removed category group input.
- Mobile Reports toolbar compacted.
- Removed Show currency from account gear menu.
- Mobile account gear menu is now a full pop menu with an X close button.
- Desktop gear menu closes when clicking the gear again.


## v24 update

- Net-worth number recolored for readability in both themes, without green glow.
- Removed the mobile account menu X button.
- Accounts toolbar simplified to centered actions with a larger Add account button.
- Accounts page kicker is now Money Containers.
- Duplicate page kickers were replaced with more meaningful labels.
- Mobile Reports toolbar layout corrected again.


## v25 update

- Net-worth number now has a visible accent color without the green light background.
- Desktop Reports toolbar shows only selectors.
- Mobile Reports keeps the Reports heading with green supertext.
- Mobile hidden-account toggle sits left of Add account when it appears.


## v26 update

- Net worth number uses the light-mode design treatment in both light and dark mode.


## v27 update

- Added Given / starting position option with a given date for holdings.
- Given holdings are treated as baseline positions in comparison snapshots.
- Positive position changes now show a plus sign.
- Cost basis total is calculated automatically from quantity × buy price.
- Current/manual price is disabled unless the provider is Manual.
- Broker position imports create starting/given holdings by default.


## v28 update

- Revolut CSV import now ignores PENDING/REVERTED rows and imports only COMPLETED rows.
- Revolut fees now keep their sign, so fee refunds increase the balance instead of decreasing it.
- Revolut Product is included in the import description/external ID.
