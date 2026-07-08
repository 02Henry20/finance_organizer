$ErrorActionPreference = "Stop"

$appPath = Join-Path $PSScriptRoot "js\app.js"
if (!(Test-Path $appPath)) {
  throw "Missing js\app.js. Copy this script into the Finance Organizer repo root and run it there."
}

$app = Get-Content -Raw -Encoding UTF8 $appPath

$restorePattern = '(?s)  tbody\.querySelectorAll\("\[data-restore-skipped\]"\)\.forEach\(button => button\.addEventListener\("click",\s*(?:async\s*)?\(\) => \{.*?updateUnifiedImportSummary\(\);\s*\}\)\);\r?\n'
$restoreReplacement = @'
  tbody.querySelectorAll("[data-restore-skipped]").forEach(button => button.addEventListener("click", async () => {
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
    const base = String(restored.id || restored.externalId || `tx_${Date.now()}`).replace(/_dup\d+$/i, "");
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
'@

if ($app -notmatch 'Add duplicate transaction\?') {
  if ($app -notmatch $restorePattern) {
    throw "Could not find the skipped-import Add back handler in js\app.js. Upload your current js\app.js and I will patch it directly."
  }
  $app = [regex]::Replace($app, $restorePattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $restoreReplacement }, 1)
}

$accountReparsePatch = @'

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
'@

if ($app -notmatch 'attachV72ImportAccountReparse') {
  $app = $app.TrimEnd() + "`r`n" + $accountReparsePatch + "`r`n"
}

Set-Content -Encoding UTF8 -NoNewline -Path $appPath -Value $app
Write-Host "Applied v72 app fixes to js\app.js"
