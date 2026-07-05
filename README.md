# Capito complete stable package

Deploy this folder exactly as-is.

Included:
- Working Capito app code based on the stable login version.
- New Capito icon artwork in the login/start screen and top-left header.
- Full `icons/` folder with favicon, Apple touch icon, Android round icons and Android maskable icons.
- Updated `manifest.webmanifest` using the new icon pack.
- Bank CSV recognition for Wise, Revolut, Sparkasse and generic CSV/TSV.
- Exact duplicate transaction filtering during import.
- Broker position import for Smartbroker XLSX/CSV exports into a selected broker account.
- `cache-reset.html` helper if a browser keeps an older broken service-worker cache.

If an old browser build is still stuck, open `/cache-reset.html`, click **Reset local app cache**, then open `/index.html` again.
