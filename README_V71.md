Capito v71 mobile layout + duplicate import follow-up

Replace these files in your Finance Organizer app with the files in this folder:

- charts.js
- finance.js
- firebase.js
- importer.js
- market.js
- store.js
- firebase-config.js
- index.html
- manifest.webmanifest
- service-worker.js
- styles.css

Important app.js note:
The uploaded app.js available in this workspace was not the Finance Organizer app.js, so a full app.js replacement is not included here. To make the Add back button show the confirmation prompt, apply the replacement block in APP_JS_IMPORT_ADD_BACK_BLOCK.txt to your current Finance Organizer app.js.

The duplicate survival after saving is still hardened in importer.js and store.js:
exact duplicate add-back rows receive numeric _dup2/_dup3 ids, and batch import no longer silently overwrites same-id transactions.
