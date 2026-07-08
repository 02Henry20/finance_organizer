Capito v72 mobile reports + duplicate prompt follow-up

Copy the files from this folder into the same places in your Finance Organizer repo:

- root files stay in the repo root: index.html, styles.css, firebase-config.js, manifest.webmanifest, service-worker.js, firebase.json, firestore.rules
- js files go into js/: charts.js, finance.js, firebase.js, importer.js, market.js, store.js

Then run this from the Finance Organizer repo root in PowerShell:

powershell -ExecutionPolicy Bypass -File .\apply-v72-app-fixes.ps1

That script patches your existing js/app.js because the Finance Organizer app.js was not available as a clean file here.

Fixes included:
- mobile Reports controls are pinned to:
  row 1: Month/Year input | Compare year
  row 2: Month/Year toggle | Recalc
- mobile category split charts get a taller drawing area without the old empty bottom space
- exact duplicate add-back still gets _dup2/_dup3 ids so it survives saving
- exact duplicate add-back now prompts before adding
- changing the target import account after selecting a file reparses the file so rules, account matching, filters and duplicate checks update for the new account
