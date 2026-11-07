const DEFAULTS = { ieCompat: true, pdfViewer: true };
const msg = (t) => { document.getElementById("msg").textContent = t; };

chrome.storage.local.get(Object.keys(DEFAULTS)).then((s) => {
  for (const k of Object.keys(DEFAULTS)) {
    const el = document.getElementById(k);
    el.checked = s[k] ?? DEFAULTS[k];
    el.onchange = async () => {
      await chrome.storage.local.set({ [k]: el.checked });
      msg("設定しました。開いているページは再読み込みしてください。");
    };
  }
});

// IEモードの自動判定結果はページ側 (faines.jaspa.or.jp) の localStorage にあるので、開いているタブで消す
document.getElementById("reset").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://faines.jaspa.or.jp/")) { msg("FAINESのページを開いた状態で押してください。"); return; }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => { for (const k of Object.keys(localStorage)) if (k.startsWith("fainesIE:") || k.startsWith("fainesIEnav:")) localStorage.removeItem(k); },
  });
  msg("リセットしました。");
};

// 利用規約・報告の受付 (コードは置いていない公開リポジトリ)。更新はストアから自動で行われる
const INFO_REPO = "GGYutaka/legacy-manual-support-info";
const current = chrome.runtime.getManifest().version;
document.getElementById("ver").textContent = `バージョン ${current}`;

// 表示できない資料の報告: 開いているFAINESページの場所を入れた Issue フォームを開く (送信前に本人が内容を確認できる)
document.getElementById("report").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url?.startsWith("https://faines.jaspa.or.jp/") ? tab.url.replace(/[?#].*$/, "") : "";
  const q = new URLSearchParams({ template: "display_problem.yml", title: "表示できない資料: ", url,
                                  version: `${current} / ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || ""}` });
  chrome.tabs.create({ url: `https://github.com/${INFO_REPO}/issues/new?${q}` });
};
