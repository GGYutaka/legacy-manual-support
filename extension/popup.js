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

// 配布元 (GitHub) の最新リリースを確認し、新しい版があれば案内する
const REPO = "GGYutaka/legacy-manual-support";
const current = chrome.runtime.getManifest().version;
document.getElementById("ver").textContent = `バージョン ${current}`;
const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
fetch(`https://api.github.com/repos/${REPO}/releases/latest`).then((r) => r.ok ? r.json() : null).then((rel) => {
  const latest = rel?.tag_name?.replace(/^v/, "");
  if (!latest || !newer(latest, current)) return;
  document.getElementById("latest").textContent = latest;
  document.getElementById("updateLink").href = rel.html_url;
  document.getElementById("update").hidden = false;
}).catch(() => {});

// 表示できない資料の報告: 開いているFAINESページの場所を入れた Issue フォームを開く (送信前に本人が内容を確認できる)
document.getElementById("report").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url?.startsWith("https://faines.jaspa.or.jp/") ? tab.url.replace(/[?#].*$/, "") : "";
  const q = new URLSearchParams({ template: "display_problem.yml", title: "表示できない資料: ", url,
                                  version: `${current} / ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || ""}` });
  chrome.tabs.create({ url: `https://github.com/${REPO}/issues/new?${q}` });
};
