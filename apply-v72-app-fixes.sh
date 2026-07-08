#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path
import re

path = Path("js/app.js")
if not path.exists():
    raise SystemExit("Missing js/app.js. Run this from the Finance Organizer repo root.")

app = path.read_text(encoding="utf-8")

restore_re = re.compile(r'''(?s)  tbody\.querySelectorAll\("\[data-restore-skipped\]"\)\.forEach\(button => button\.addEventListener\("click",\s*(?:async\s*)?\(\) => \{.*?updateUnifiedImportSummary\(\);\s*\}\)\);\r?\n''')
restore = '''  tbody.querySelectorAll("[data-restore-skipped]").forEach(button => button.addEventListener("click", async () => {
    const index = Number(button.dataset.restoreSkipped);
    const item = activePreview?.skipped?.[index];
    if (!item?.tx) return;
    const isExactDuplicate = item.duplicate || /exact duplicate/i.test(item.reason || "");
    if (isExactDuplicate) {
      const ok = await confirmDialog({
        title: "Add duplicate transaction?",
        message: "This row has the same account, date, amount, currency, description and counterparty as another transaction. Add it anyway as a separate reviewed transaction with a changed ID?",
        confirmLabel: "Add duplicate",
        cancelLabel: "Keep skipped"
      });
      if (!ok) return;
    }
    const knownIds = new Set([
      ...state.transactions.map(tx => tx.id),
      ...(activePreview?.transactions || []).map(tx => tx.id)
    ].filter(Boolean));
    const restored = { ...item.tx };
    const base = String(restored.id || restored.externalId || `tx_${Date.now()}`).replace(/_dup\\d+$/i, "");
    let candidate = base;
    if (knownIds.has(candidate)) {
      let counter = 2;
      candidate = `${base}_dup${counter}`;
      while (knownIds.has(candidate)) {
        counter += 1;
        candidate = `${base}_dup${counter}`;
      }
    }
    restored.id = candidate;
    restored.externalId = candidate;
    activePreview.transactions.push({ ...restored, review: true, reason: `Manually added back: ${item.reason || "filtered"}` });
    activePreview.skipped.splice(index, 1);
    toast("Row added back", isExactDuplicate ? "Duplicate kept with a changed ID and marked for review." : "It is now included in the import preview and marked for review.");
    renderImportPreview();
    updateUnifiedImportSummary();
  }));
'''

if "Add duplicate transaction?" not in app:
    app, count = restore_re.subn(restore, app, count=1)
    if count != 1:
        raise SystemExit("Could not find the skipped-import Add back handler in js/app.js. Upload your current js/app.js and I will patch it directly.")

account_patch = '''

// v72: if the target import account changes after a file was selected, re-run the file import
// so account matching, rules, filters and duplicate checks are recalculated for the new account.
function attachV72ImportAccountReparse() {
  const accountSelect = document.querySelector("#import-account");
  const fileInput = document.querySelector("#import-file");
  if (!accountSelect || !fileInput || accountSelect.dataset.v72ReparseAttached === "true") return;
  accountSelect.dataset.v72ReparseAttached = "true";
  accountSelect.addEventListener("change", () => {
    if (!fileInput.files || !fileInput.files.length) return;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachV72ImportAccountReparse);
} else {
  attachV72ImportAccountReparse();
}
'''

if "attachV72ImportAccountReparse" not in app:
    app = app.rstrip() + "\n" + account_patch + "\n"

path.write_text(app, encoding="utf-8", newline="")
print("Applied v72 app fixes to js/app.js")
PY
