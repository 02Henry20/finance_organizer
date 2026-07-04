VaultPilot redesign package

Implemented changes:
1. Reworked the visual design into a cleaner broker/banking app style inspired by Wise/Revolut-style rounded cards, pill navigation, and brighter account-focused portfolio cards.
2. Moved Export CSV from the top bar to Settings > Data.
3. Fixed account creation handling with visible error toasts and added optional IBAN, account/depot number, BIC, and transfer aliases.
4. Integrated holdings into Accounts. Broker accounts can now hold both cash/liquidity and assets.
5. Expanded default categories and keyword rules, and rules are displayed grouped by target category.
6. Removed the Firebase security rules card from Settings.
7. Appearance now says only Dark mode / Light mode.
8. Added online FX refresh via free no-key exchange-rate endpoints with cached fallback rates.
9. Removed the top + Entry button.
10. Improved sync status handling so Firestore cache is not shown as offline when the browser is online.
11. Removed the visible Create account button from the auth screen.
12. Removed the visible Reset password button from the auth screen.
13. Added hard account deletion with two confirmation prompts. Hidden accounts are excluded from account lists and cards.

Notes:
- Assets are still stored in the existing assets collection for compatibility, but the user-facing UI now shows them inside broker accounts.
- If Firebase still shows permission errors, check that Firestore rules allow apps/finance-organizer/users/<uid>/... for the signed-in user.
