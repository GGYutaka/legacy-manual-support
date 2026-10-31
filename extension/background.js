// 設定 (ポップアップで切替) に合わせて、IE互換スクリプトの登録と PDF→ビューアの転送規則を入れ替える
const DEFAULTS = { ieCompat: true, pdfViewer: true };
const MANUAL = "https://faines.jaspa.or.jp/enduser/system/files/*";
const SCRIPT_ID = "faines-ie-compat";

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

// 起動時・インストール時・設定変更が同時に走っても登録が重ならないよう、順番に処理する
let queue = Promise.resolve();
const serial = (f) => (queue = queue.then(f, f));

function applyIeCompat(on) {
  return serial(async () => {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    if (!on) return;
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID, js: ["ie_compat.js"], matches: [MANUAL],
      runAt: "document_start", allFrames: true, world: "MAIN", persistAcrossSessions: true,
    }]);
  });
}

function applyPdfViewer(on) {
  const viewer = chrome.runtime.getURL("viewer/viewer.html");
  const rules = [
    { // 「標準表示」ボタンで開いたPDFは転送しない
      id: 1, priority: 2, action: { type: "allow" },
      condition: { regexFilter: "^https://faines\\.jaspa\\.or\\.jp/.*[?&]faines_raw=1", resourceTypes: ["main_frame", "sub_frame", "object"] },
    },
    { // FAINESの整備書PDF → 拡張のビューア (別PDFへのしおり・リンクを辿れる)
      id: 2, priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: `${viewer}?file=\\0` } },
      condition: {
        regexFilter: "^https://faines\\.jaspa\\.or\\.jp/enduser/system/files/manual/[^?#]*\\.[Pp][Dd][Ff]$",
        resourceTypes: ["main_frame", "sub_frame", "object"],
      },
    },
  ];
  return serial(async () => {
    const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      // 追加する規則の id も必ず外してから入れる (同じ id の重複エラーを防ぐ)
      removeRuleIds: [...new Set([...old.map((r) => r.id), ...rules.map((r) => r.id)])],
      addRules: on ? rules : [],
    });
  });
}

async function applyAll() {
  const s = await settings();
  await Promise.all([
    applyIeCompat(s.ieCompat).catch((e) => console.error("IE互換の登録に失敗", e)),
    applyPdfViewer(s.pdfViewer).catch((e) => console.error("PDF転送規則の登録に失敗", e)),
  ]);
}

chrome.runtime.onInstalled.addListener(applyAll);
chrome.runtime.onStartup.addListener(applyAll);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("ieCompat" in changes) applyIeCompat(changes.ieCompat.newValue).catch((e) => console.error("IE互換の登録に失敗", e));
  if ("pdfViewer" in changes) applyPdfViewer(changes.pdfViewer.newValue).catch((e) => console.error("PDF転送規則の登録に失敗", e));
});
// サービスワーカーが起動するたびに状態を揃える (インストール・ブラウザ起動のイベントを取り逃しても効くように)
applyAll();
