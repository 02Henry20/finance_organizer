# Capito complete app package

Deploy the files in this folder exactly as-is.

Structure:
- `index.html`
- `styles.css`
- `manifest.webmanifest`
- `service-worker.js`
- `firebase-config.js`
- `cache-reset.html`
- `js/`
- `icons/`

Important:
- This build uses cache-busted module imports (`capito-v16`) to avoid old desktop service-worker caches mixing old and new JavaScript files.
- `service-worker.js` is network-first for HTML/CSS/JS/manifest files.
- If a desktop browser is still stuck on the old login screen after deploying, open `/cache-reset.html`, click **Reset local app cache**, then open `/index.html`.

Tutorial:
- Settings contains **Start guided tutorial**.
- Tutorial data is isolated in `js/tutorial-data.js`.
- Tutorial mode does not sync to Firebase and restores the real user state when closed.

Icons:
- All production icons are inside `icons/`.
- The manifest uses the icons in `icons/`, including Android round and maskable variants.
