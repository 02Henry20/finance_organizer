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
