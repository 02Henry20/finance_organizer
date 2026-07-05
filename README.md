# Capito stable rollback package

This package reverts the app code to the last known working Capito build and only adds:
- the selected Capito icon pack in `icons/`
- the updated `manifest.webmanifest`
- corrected icon/head links in `index.html`
- a safer service worker cache name
- `cache-reset.html` for clearing stale browser caches if needed

The tutorial patches were removed because they appear to be the likely cause of the broken Firebase/login behavior.

Deploy the files in this folder exactly as-is.
