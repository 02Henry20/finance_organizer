VaultPilot redesign update
==========================

Main changes in this package:

1. New layout and design direction
- Removed the old sidebar-first layout.
- Added a horizontal fintech-style navigation bar on desktop and bottom navigation on mobile.
- Reworked the dashboard into a home screen with a large balance card, quick actions, metric strip, account balance panel and insights.
- Updated visual language toward a cleaner Wise/Revolut-style account and broker layout.

2. Net worth card
- Removed the old explanatory text from the net worth box.

3. Portfolio comparison
- Liquidity, assets and debt now show absolute and percentage movement.
- Settings allow either:
  - rolling comparison, e.g. last 30 days
  - fixed date comparison
- Account and debt comparison is based on transactions up to the comparison date.
- Holding comparison uses current holding prices because historical price storage is not yet available.

4. Navigation icons
- Accounts uses a card icon.
- Settings uses the gear icon.
- Rules uses a separate routing/rules icon.

5. Holding price refresh
- Removed the visible manual holding-price refresh button.
- Added automatic holding quote refresh intervals in Settings.
- Manual assets are not refreshed.

6. JSON backup/import
- Settings now includes:
  - full JSON export for settings, accounts, categories, rules, transactions and assets
  - JSON import with merge mode
  - JSON import with replace mode and two confirmations
- CSV export remains available in Settings only.

7. Sync label
- Firestore cache metadata is no longer shown as offline while the browser is online.
- Online cache now shows as ready rather than stuck on connecting.

8. Settings cleanup
- Appearance labels are only Dark mode / Light mode.
- Firebase security rules marker/card stays removed.
