VaultPilot update

Implemented:
- Mobile settings controls now preserve unsaved selections during scroll/viewport re-renders.
- Primary currency now uses a datalist and validates against supported currency codes.
- Currency conversion refresh now uses the same interval as holding price refresh.
- Removed the manual Exchange Rates settings card and removed the Never refresh option.
- Changed Rules icon to a tag-style symbol and kept Settings as a gear.
- Moved Sign out into Settings > Data.
- Sync status is visible in the upper-right header on mobile and now says Synced without Firebase subtext.
- Added a Manage rules button to Import so mobile users can open the Rules view.
- Increased account card spacing and Rules/Categories spacing.
- Added Hidden accounts section and a jump button in Accounts.
- Added category color support with 16 app-matched colors; colors appear in category pills, rules, import previews, ledger rows and spending donut chart.
- Reduced desktop account-balance chart height while preserving mobile height.
- Removed the old Todo box from Home.
- Replaced the Actions card with a Review ledger panel that appears only when transactions need review.
- Service worker cache version updated to v4.

Notes:
- All JavaScript files were syntax-checked with node --check.
- Firebase live sync/auth could not be tested from this environment.
