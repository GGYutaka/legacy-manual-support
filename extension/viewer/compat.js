// 古いブラウザ (更新されていない WebView など) 向けの補い。pdf.js より先に読み込む
// pdf.js はページの大きさを CSS の round() で指定する。round() に対応していないと高さが無効になり、ページが見えない。
// その場合は、書き込まれた round(down, 式, 刻み) を calc(式) に書き換える
if (!CSS.supports("width", "round(down, 1px, 1px)")) {
  const re = /round\(down,\s*([^,]+),\s*var\(--scale-round-[xy]\)\)/g;
  const fix = (el) => {
    const s = el.getAttribute("style");
    if (s && s.includes("round(down")) el.setAttribute("style", s.replace(re, "calc($1)"));
  };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") fix(m.target);
      else for (const n of m.addedNodes) if (n.nodeType === 1) { fix(n); n.querySelectorAll?.("[style]").forEach(fix); }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
}
