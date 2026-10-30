// FAINES PDF ビューア (pdf.js)
// Chrome標準のPDF表示は /Launch・/GoToR (別PDFへのしおり・リンク) を無視するため、トヨタ旧PDF形式などの
// 「表紙 → 目次 → 章ごとのPDF」が辿れない。ここでは別PDFへのリンクを同じビューアで開き直して辿れるようにする。
import * as pdfjsLib from "./pdfjs/build/pdf.min.mjs";

globalThis.pdfjsLib = pdfjsLib;
const { EventBus, PDFViewer, PDFLinkService, PDFFindController, LinkTarget } =
  await import("./pdfjs/web/pdf_viewer.mjs");

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/build/pdf.worker.min.mjs", import.meta.url).href;
const ASSET = (p) => new URL(`./pdfjs/${p}/`, import.meta.url).href;

const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg || ""; };

// ?file=… は転送規則からは生のURL (ef&ec.pdf のように & を含むこともある)、ビューア内の移動では符号化済みで来る
const fileUrl = (() => {
  const m = location.search.match(/^\?file=(.+)$/);
  if (!m) return null;
  const v = /^https?%3A/i.test(m[1]) ? decodeURIComponent(m[1]) : m[1];
  try { return new URL(v).href; } catch { return null; }
})();
const RAW_FLAG = "faines_raw=1";

// 生のPDF (Chrome標準表示) のURL。リダイレクト規則を外すための目印を付ける
function rawUrl(u) {
  const url = new URL(u);
  url.search += (url.search ? "&" : "?") + RAW_FLAG;
  return url.href;
}

function viewerUrl(pdfUrl, hash = "") {
  return `${location.pathname}?file=${encodeURIComponent(pdfUrl)}${hash ? "#" + hash : ""}`;
}

function isPdfUrl(u) {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) && /\.pdf$/i.test(url.pathname);
  } catch { return false; }
}

// 別PDF・外部URLへのリンクの開き方
function followUrl(u, newWindow, ev) {
  let abs;
  try { abs = new URL(u, fileUrl).href; } catch { return; }
  const url = new URL(abs);
  const hash = url.hash.slice(1);
  url.hash = "";
  if (isPdfUrl(url.href)) {
    if (url.href === new URL(fileUrl).href) {   // 同じPDF内
      if (hash) linkService.setHash(hash);
      return;
    }
    const target = viewerUrl(url.href, hash);
    if (newWindow || ev?.ctrlKey || ev?.metaKey || ev?.shiftKey) window.open(target, "_blank");
    else location.href = target;
    return;
  }
  if (/^https?:$/.test(url.protocol)) window.open(abs, "_blank", "noopener");
}

const container = $("viewerContainer");
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
// 注釈リンクのURL (GoToR/Launch → 相対ファイル名) を自前で辿る
linkService.addLinkAttributes = (link, url, newWindow = false) => {
  let abs = url;
  try { abs = new URL(url, fileUrl).href; } catch {}
  link.href = isPdfUrl(abs.split("#")[0]) ? viewerUrl(abs.split("#")[0], abs.split("#")[1] || "") : abs;
  link.title = abs;
  link.onclick = (ev) => { ev.preventDefault(); followUrl(url, newWindow, ev); return false; };
};
const findController = new PDFFindController({ eventBus, linkService });
const pdfViewer = new PDFViewer({
  container, viewer: $("viewer"), eventBus, linkService, findController,
  annotationMode: pdfjsLib.AnnotationMode.ENABLE,
});
linkService.setViewer(pdfViewer);

// ---- ツールバー ----
let pdfDoc = null;
eventBus.on("pagesinit", () => {
  pdfViewer.currentScaleValue = localStorage.getItem("fainesScale") || "page-width";
  if (location.hash.length > 1) linkService.setHash(location.hash.slice(1));
});
eventBus.on("pagechanging", ({ pageNumber }) => {
  $("pageNumber").value = pageNumber;
  $("btnPrev").disabled = pageNumber <= 1;
  $("btnNext").disabled = pageNumber >= pdfViewer.pagesCount;
  highlightOutline(pageNumber);
});
eventBus.on("scalechanging", ({ presetValue, scale }) => {
  const sel = $("scaleSelect");
  const v = presetValue || String(+scale.toFixed(2));
  if (![...sel.options].some((o) => o.value === v)) {
    const o = sel.querySelector("option.custom") || sel.appendChild(Object.assign(document.createElement("option"), { className: "custom" }));
    o.value = v; o.textContent = `${Math.round(scale * 100)}%`;
  }
  sel.value = v;
});
$("btnPrev").onclick = () => pdfViewer.previousPage();
$("btnNext").onclick = () => pdfViewer.nextPage();
$("pageNumber").onchange = (e) => { pdfViewer.currentPageNumber = Math.min(Math.max(1, e.target.value | 0), pdfViewer.pagesCount); };
$("btnZoomIn").onclick = () => pdfViewer.increaseScale();
$("btnZoomOut").onclick = () => pdfViewer.decreaseScale();
$("scaleSelect").onchange = (e) => {
  pdfViewer.currentScaleValue = e.target.value;
  try { localStorage.setItem("fainesScale", e.target.value); } catch {}
};
$("btnSidebar").onclick = () => {
  document.body.classList.toggle("no-sidebar");
  try { localStorage.setItem("fainesSidebar", document.body.classList.contains("no-sidebar") ? "0" : "1"); } catch {}
};
try { if (localStorage.getItem("fainesSidebar") === "0") document.body.classList.add("no-sidebar"); } catch {}
$("btnBack").onclick = () => history.back();
$("btnForward").onclick = () => history.forward();
$("btnRaw").onclick = () => { if (fileUrl) location.href = rawUrl(fileUrl); };

function find(again, previous = false) {
  const query = $("findInput").value;
  eventBus.dispatch("find", { source: null, type: again ? "again" : "", query, caseSensitive: false,
    entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
}
$("findInput").addEventListener("input", () => find(false));
$("findInput").addEventListener("keydown", (e) => { if (e.key === "Enter") find(true, e.shiftKey); });
eventBus.on("updatefindmatchescount", ({ matchesCount }) => {
  $("findMsg").textContent = matchesCount.total ? `${matchesCount.current}/${matchesCount.total}` : "";
});
eventBus.on("updatefindcontrolstate", ({ state, matchesCount }) => {
  if (state === 1) $("findMsg").textContent = "見つかりません";
  else if (matchesCount?.total) $("findMsg").textContent = `${matchesCount.current}/${matchesCount.total}`;
});
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); $("findInput").focus(); $("findInput").select(); }
  if (e.altKey && e.key === "ArrowLeft") history.back();
  if (e.altKey && e.key === "ArrowRight") history.forward();
});

// ---- しおり (目次) ----
const outlineEntries = []; // {el, page}
async function pageOfDest(dest) {
  try {
    if (typeof dest === "string") dest = await pdfDoc.getDestination(dest);
    if (!Array.isArray(dest)) return null;
    const ref = dest[0];
    if (Number.isInteger(ref)) return ref + 1;
    return (await pdfDoc.getPageIndex(ref)) + 1;
  } catch { return null; }
}

function renderOutline(items, parent, depth) {
  for (const it of items) {
    const item = document.createElement("div");
    item.className = "item" + (depth >= 1 && it.items?.length ? " collapsed" : "");
    const row = item.appendChild(document.createElement("div"));
    row.className = "row";
    const tg = row.appendChild(document.createElement("span"));
    tg.className = "toggle";
    const a = row.appendChild(document.createElement("a"));
    a.textContent = it.title || "(無題)";
    if (it.items?.length) {
      tg.textContent = item.classList.contains("collapsed") ? "▸" : "▾";
      tg.onclick = () => { item.classList.toggle("collapsed"); tg.textContent = item.classList.contains("collapsed") ? "▸" : "▾"; };
      renderOutline(it.items, Object.assign(item.appendChild(document.createElement("div")), { className: "children" }), depth + 1);
    }
    const url = it.url || it.unsafeUrl;
    if (it.dest) {
      a.onclick = () => linkService.goToDestination(it.dest);
      pageOfDest(it.dest).then((p) => p && outlineEntries.push({ el: a, page: p }));
    } else if (url) {
      a.classList.add("ext");
      a.title = new URL(url, fileUrl).href;
      a.onclick = (ev) => followUrl(url, it.newWindow, ev);
    } else {
      a.style.opacity = ".5";
      a.title = "このしおりは移動先がありません (スクリプト等)";
    }
    parent.appendChild(item);
  }
}

let lastHi = null;
function highlightOutline(page) {
  let best = null;
  for (const e of outlineEntries) if (e.page <= page && (!best || e.page >= best.page)) best = e;
  if (lastHi) lastHi.classList.remove("current");
  if (best) { best.el.classList.add("current"); lastHi = best.el; }
}

// ---- 読み込み ----
async function load() {
  if (!fileUrl) { status("PDFが指定されていません"); return; }
  $("docTitle").textContent = decodeURIComponent(new URL(fileUrl).pathname.split("/").slice(-3).join("/"));
  document.title = decodeURIComponent(new URL(fileUrl).pathname.split("/").pop());
  status("読み込み中…");
  let data;
  try {
    const res = await fetch(fileUrl, { credentials: "include" });
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder().decode(buf.slice(0, 1024));
    if (!res.ok || !head.includes("%PDF-")) {
      const login = /login|ログイン/i.test(head) || res.redirected;
      status(login ? "FAINESにログインしてから開き直してください。"
        : `PDFを取得できませんでした (HTTP ${res.status})。\nFAINESのメンテナンス中 (22:00〜7:00) の可能性があります。`);
      return;
    }
    data = buf;
  } catch (e) {
    status(`PDFを取得できませんでした: ${e.message}`);
    return;
  }
  try {
    pdfDoc = await pdfjsLib.getDocument({
      data, docBaseUrl: fileUrl,
      cMapUrl: ASSET("cmaps"), cMapPacked: true,
      standardFontDataUrl: ASSET("standard_fonts"), wasmUrl: ASSET("wasm"), iccUrl: ASSET("iccs"),
      enableXfa: true,
    }).promise;
  } catch (e) {
    status(`PDFを開けませんでした: ${e.message}`);
    return;
  }
  status("");
  pdfViewer.setDocument(pdfDoc);
  linkService.setDocument(pdfDoc, null);
  $("numPages").textContent = `/ ${pdfDoc.numPages}`;
  $("pageNumber").max = pdfDoc.numPages;
  const meta = await pdfDoc.getMetadata().catch(() => null);
  const title = meta?.info?.Title?.trim();
  if (title) { document.title = title; $("docTitle").textContent = title; }
  const outline = await pdfDoc.getOutline();
  if (outline?.length) renderOutline(outline, $("outline"), 0);
  else {
    $("outline").innerHTML = '<div class="empty">しおりはありません</div>';
    if (localStorage.getItem("fainesSidebar") !== "1") document.body.classList.add("no-sidebar");
  }
}

window.addEventListener("hashchange", () => linkService.setHash(location.hash.slice(1)));
load();
