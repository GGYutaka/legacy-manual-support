// FAINES IE互換レイヤー (ページのJSと同じ世界 MAIN で、document_start に全フレームへ注入)
// 古い整備書の閲覧画面は Internet Explorer 専用の機能 (ActiveX の MSXML, document.frames, attachEvent,
// selectNodes, XMLデータアイランド 等) を前提に作られており、Chrome では白紙・無反応になる。
// ここで不足している機能だけを補う。ActiveXObject を定義すると「IEなら〜」の分岐に入ってしまうため、
// ActiveXObject だけは「未定義エラーで止まったページ」を検知したときに限り有効にして再読み込みする。
(() => {
  "use strict";
  if (window.__fainesCompat) return;
  window.__fainesCompat = true;

  const TAG = "[FAINES互換]";
  const log = (...a) => { try { console.debug(TAG, ...a); } catch {} };
  const def = (obj, name, desc) => {
    if (!obj || name in obj) return;
    try { Object.defineProperty(obj, name, { configurable: true, ...desc }); } catch {}
  };
  const fn = (obj, name, f) => def(obj, name, { value: f, writable: true });

  // ---- IEモード (ActiveXObject) を有効にするかの判定: 資料ごと (URLの先頭8階層) に記憶 ----
  // 資料の区切り: ファイル名を除いたフォルダの先頭8階層 (浅い資料でもフレームごとに別扱いにならないように)
  const rootDir = location.pathname.split("/").slice(0, -1).slice(0, 9).join("/");
  const rootKey = "fainesIE:" + rootDir;
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const ieMode = (() => { try { return store?.getItem(rootKey) === "1"; } catch { return false; } })();
  // 「Internet Explorer で開いてください」と止める資料 (ブラウザ名・OSを確認するもの) は、IEのふりをする
  const navKey = "fainesIEnav:" + rootDir;
  const navMode = (() => { try { return store?.getItem(navKey) === "1"; } catch { return false; } })();

  // ======================= DOM 系 (常に追加して害のないもの) =======================
  // attachEvent / detachEvent / fireEvent
  const evMap = new WeakMap();
  for (const proto of [Element.prototype, Document.prototype, Window.prototype]) {
    fn(proto, "attachEvent", function (type, handler) {
      const name = String(type).replace(/^on/i, "");
      let m = evMap.get(this); if (!m) evMap.set(this, (m = new Map()));
      const key = name + "\0"; let list = m.get(key); if (!list) m.set(key, (list = new Map()));
      if (list.has(handler)) return true;
      const self = this;
      const w = function (e) { return handler.call(self, e); };
      list.set(handler, w);
      this.addEventListener(name, w, false);
      return true;
    });
    fn(proto, "detachEvent", function (type, handler) {
      const name = String(type).replace(/^on/i, "");
      const list = evMap.get(this)?.get(name + "\0");
      const w = list?.get(handler);
      if (w) { this.removeEventListener(name, w, false); list.delete(handler); }
    });
    fn(proto, "fireEvent", function (type, src) {
      const name = String(type).replace(/^on/i, "");
      const ev = new Event(name, { bubbles: true, cancelable: true });
      if (src) for (const k of ["keyCode", "button", "clientX", "clientY"]) if (k in src) try { Object.defineProperty(ev, k, { value: src[k] }); } catch {}
      return this.dispatchEvent(ev);
    });
  }

  // currentStyle / runtimeStyle
  def(Element.prototype, "currentStyle", { get() { return getComputedStyle(this); } });
  def(HTMLElement.prototype, "runtimeStyle", { get() { return this.style; } });
  fn(Element.prototype, "setCapture", function () {});
  fn(Element.prototype, "releaseCapture", function () {});
  fn(Document.prototype, "releaseCapture", function () {});
  def(Document.prototype, "parentWindow", { get() { return this.defaultView; } });
  fn(Document.prototype, "createStyleSheet", function (href) {
    const el = href ? Object.assign(this.createElement("link"), { rel: "stylesheet", href }) : this.createElement("style");
    (this.head || this.documentElement).appendChild(el);
    const sh = el.sheet || {};
    if (!("cssText" in sh)) try {
      Object.defineProperty(sh, "cssText", { get: () => el.textContent, set: (v) => { el.textContent = v; } });
    } catch {}
    sh.addRule ||= (sel, style) => el.sheet.insertRule(`${sel}{${style}}`, el.sheet.cssRules.length);
    return sh;
  });

  // document.all.tags / element.all
  const tagsFn = function (name) { return (this.__root || document).getElementsByTagName(name); };
  if (typeof HTMLAllCollection !== "undefined") fn(HTMLAllCollection.prototype, "tags", tagsFn);
  def(Element.prototype, "all", {
    get() {
      const list = this.getElementsByTagName("*");
      const root = this;
      return new Proxy(list, {
        get(t, p) {
          if (p === "tags") return (n) => root.getElementsByTagName(n);
          if (p === "item") return (i) => (typeof i === "number" ? t[i] : root.querySelector(`#${CSS.escape(i)},[name="${CSS.escape(i)}"]`));
          const v = Reflect.get(t, p);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
    },
  });

  // document.frames / window.frames.item
  // IE では document.frames("名前") のように関数呼び出しもできたので、関数を土台にした Proxy にする
  const framesOf = (w) => {
    const item = (n) => (typeof n === "number" ? w[n] : w.frames[n] || w.document.getElementsByName(n)[0]?.contentWindow);
    return new Proxy(function () {}, {
      apply: (t, self, args) => item(args[0]),
      get(t, p) {
        if (p === "item") return item;
        if (p === "length") return w.length;
        const v = w[p];
        return typeof v === "function" ? v.bind(w) : v;
      },
    });
  };
  def(Document.prototype, "frames", { get() { return this.defaultView ? framesOf(this.defaultView) : undefined; } });
  fn(window, "item", function (n) { return typeof n === "number" ? window[n] : window.frames[n]; });

  // 読み込み時に自動で開くポップアップ (日産ESMの index.html の onload="Open()" 等) は Chrome にブロックされる。
  // その場合は同じタブで開き、続く処理 (moveTo や window.open(未定義,"_self") で自分を閉じる等) は空振りさせる。
  const origOpen = window.open;
  window.open = function (url, name, features) {
    if ((url === undefined || url === null || url === "" || url === "about:blank") && String(name).toLowerCase() === "_self") return window;
    const w = origOpen.apply(this, arguments);
    if (w || window !== window.top || navigator.userActivation?.isActive) return w;
    if (url) {
      log("ポップアップがブロックされたので同じタブで開きます:", url);
      const target = new URL(url, location.href).href;
      setTimeout(() => location.assign(target), 0);
    }
    return window;
  };

  // window.navigate / execScript / showModalDialog / createPopup / clipboardData
  fn(window, "navigate", function (url) { location.href = url; });
  fn(window, "execScript", function (code) { return (0, eval)(String(code)); });
  if (typeof window.showModalDialog !== "function") {
    window.showModalDialog = function (url, args, features) {
      const f = String(features || "");
      const num = (k) => (f.match(new RegExp(k + "\\s*[:=]\\s*(\\d+)", "i")) || [])[1];
      const w = window.open(url, "_blank", `width=${num("dialogWidth") || 800},height=${num("dialogHeight") || 600},resizable=yes,scrollbars=yes`);
      try { if (w) w.dialogArguments = args; } catch {}
      return undefined;
    };
    window.showModelessDialog = window.showModalDialog;
  }
  fn(window, "createPopup", function () {
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;z-index:2147483647;background:#fff;border:1px solid #888;display:none;overflow:auto";
    const pop = {
      document: { body: div, write: (h) => { div.innerHTML += h; }, close() {} },
      isOpen: false,
      show(x, y, w, h) { (document.body || document.documentElement).appendChild(div); Object.assign(div.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px", display: "block" }); this.isOpen = true; },
      hide() { div.style.display = "none"; this.isOpen = false; },
    };
    document.addEventListener("mousedown", (e) => { if (!div.contains(e.target)) pop.hide(); }, true);
    return pop;
  });
  def(window, "clipboardData", { value: { setData: (t, v) => { navigator.clipboard?.writeText(String(v)); return true; }, getData: () => "" } });
  if (window.external && !window.external.AddFavorite) try { window.external.AddFavorite = () => {}; } catch {}

  // ======================= XML (MSXML の DOM 拡張) =======================
  const ser = () => new XMLSerializer();
  def(Node.prototype, "xml", { get() { return ser().serializeToString(this); } });
  // HTML要素は a.text / option.text 等が既にあるので、無いもの (XML要素・属性) にだけ効く
  def(Node.prototype, "text", {
    get() { return this.nodeType === 9 ? (this.documentElement?.textContent ?? "") : this.textContent; },
    set(v) { this.textContent = v; },
  });
  def(Node.prototype, "baseName", { get() { return this.localName; } });
  def(Node.prototype, "nodeTypedValue", { get() { return this.textContent; } });

  const nsMaps = new WeakMap();
  function setSelectionNamespaces(doc, v) {
    const m = {};
    for (const [, p, u] of String(v).matchAll(/xmlns(?::(\w+))?\s*=\s*['"]([^'"]*)['"]/g)) m[p || ""] = u;
    nsMaps.set(doc, m);
  }
  function resolver(node) {
    const doc = node.nodeType === 9 ? node : node.ownerDocument;
    const m = nsMaps.get(doc) || {};
    const native = doc.createNSResolver ? doc.createNSResolver(doc.documentElement || doc) : null;
    return (p) => m[p] ?? native?.lookupNamespaceURI?.(p) ?? null;
  }
  // XSLPattern (MSXML既定) の書き方を XPath に寄せる
  const fixXPath = (x) => String(x).replace(/\$(and|or|not|eq|ne|lt|le|gt|ge|ieq|ine)\$/gi, (_, o) =>
    ({ and: "and", or: "or", not: "not", eq: "=", ne: "!=", lt: "<", le: "<=", gt: ">", ge: ">=", ieq: "=", ine: "!=" })[o.toLowerCase()]);
  function nodeList(arr) {
    const list = arr.slice();
    let i = 0;
    list.item = (n) => list[n] ?? null;
    list.nextNode = () => list[i++] ?? null;
    list.reset = () => { i = 0; };
    return list;
  }
  fn(Node.prototype, "selectNodes", function (xp) {
    const doc = this.nodeType === 9 ? this : this.ownerDocument;
    const r = doc.evaluate(fixXPath(xp), this, resolver(this), XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const out = [];
    for (let i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i));
    return nodeList(out);
  });
  fn(Node.prototype, "selectSingleNode", function (xp) {
    const doc = this.nodeType === 9 ? this : this.ownerDocument;
    return doc.evaluate(fixXPath(xp), this, resolver(this), XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  });
  fn(Node.prototype, "transformNode", function (xsl) {
    const p = new XSLTProcessor();
    p.importStylesheet(xsl.nodeType === 9 ? xsl : xsl.ownerDocument);
    const doc = this.nodeType === 9 ? this : this.ownerDocument;
    const frag = p.transformToFragment(this, document.implementation.createHTMLDocument(""));
    if (!frag) return "";
    const d = document.createElement("div");
    d.appendChild(frag);
    return d.innerHTML || ser().serializeToString(frag);
  });
  fn(Node.prototype, "transformNodeToObject", function (xsl, out) {
    const p = new XSLTProcessor();
    p.importStylesheet(xsl.nodeType === 9 ? xsl : xsl.ownerDocument);
    const res = p.transformToDocument(this);
    if (out && res?.documentElement) out.loadXML(ser().serializeToString(res));
    return res;
  });

  // XMLDocument: async / load / loadXML / parseError / setProperty
  const XD = (typeof XMLDocument !== "undefined" ? XMLDocument : Document).prototype;
  const state = new WeakMap();
  const st = (d) => { let s = state.get(d); if (!s) state.set(d, (s = { async: true, readyState: 4, parseError: { errorCode: 0, reason: "", srcText: "", line: 0, linepos: 0, url: "" } })); return s; };
  def(XD, "async", { get() { return st(this).async; }, set(v) { st(this).async = !!v; } });
  def(XD, "parseError", { get() { return st(this).parseError; } });
  for (const k of ["validateOnParse", "resolveExternals", "preserveWhiteSpace"]) def(XD, k, { get() { return st(this)[k] ?? false; }, set(v) { st(this)[k] = v; } });
  fn(XD, "setProperty", function (k, v) { st(this)["prop:" + k] = v; if (k === "SelectionNamespaces") setSelectionNamespaces(this, v); });
  fn(XD, "getProperty", function (k) { return st(this)["prop:" + k]; });
  function fillFrom(target, src, errText) {
    while (target.firstChild) target.removeChild(target.firstChild);
    const pe = src?.getElementsByTagName("parsererror")[0];
    if (!src || pe) {
      Object.assign(st(target).parseError, { errorCode: -1, reason: pe?.textContent || errText || "parse error" });
      return false;
    }
    st(target).parseError.errorCode = 0;
    for (const n of Array.from(src.childNodes)) target.appendChild(target.importNode(n, true));
    return true;
  }
  fn(XD, "loadXML", function (s) {
    const doc = new DOMParser().parseFromString(String(s).replace(/^﻿/, ""), "text/xml");
    return fillFrom(this, doc);
  });
  const fireReady = (doc) => {
    const s = st(doc); s.readyState = 4;
    try { typeof doc.onreadystatechange === "function" && doc.onreadystatechange(); } catch (e) { setTimeout(() => { throw e; }); }
    try { typeof s.ondataavailable === "function" && s.ondataavailable(); } catch {}
  };
  fn(XD, "load", function (url) {
    const doc = this;
    const xhr = new XMLHttpRequest();
    const sync = !st(doc).async;
    st(doc).parseError.url = String(url);
    try {
      xhr.open("GET", url, !sync);
      xhr.overrideMimeType?.("text/xml");
      const done = () => {
        const ok = (xhr.status === 200 || xhr.status === 0) && xhr.responseText;
        const r = ok ? fillFrom(doc, new DOMParser().parseFromString(xhr.responseText.replace(/^﻿/, ""), "text/xml"))
                     : fillFrom(doc, null, `HTTP ${xhr.status}`);
        if (!sync) fireReady(doc);
        return r;
      };
      st(doc).readyState = 1;
      if (sync) { xhr.send(); return done(); }
      xhr.onload = done; xhr.onerror = () => { fillFrom(doc, null, "network error"); fireReady(doc); };
      xhr.send();
      return true;
    } catch (e) {
      fillFrom(doc, null, e.message);
      return false;
    }
  });

  // ======================= JScript 固有の組み込み (VBArray / Enumerator) =======================
  function vbArray(a) {
    const arr = Array.isArray(a) ? a : a?.toArray ? a.toArray() : [];
    return { toArray: () => arr.slice(), ubound: () => arr.length - 1, lbound: () => 0, getItem: (i) => arr[i], dimensions: () => 1, __vb: true };
  }
  if (typeof window.VBArray === "undefined") window.VBArray = function VBArray(a) { return vbArray(a); };
  if (typeof window.Enumerator === "undefined") {
    window.Enumerator = function Enumerator(coll) {
      const items = coll == null ? [] : coll.__vb ? coll.toArray() : typeof coll.length === "number" ? Array.from({ length: coll.length }, (_, i) => (coll.item ? coll.item(i) : coll[i])) : [...coll];
      let i = 0;
      return { atEnd: () => i >= items.length, moveNext() { i++; }, moveFirst() { i = 0; }, item: () => items[i] };
    };
  }

  // ======================= ActiveXObject (IEモードのときだけ) =======================
  function newXmlDoc() {
    const d = document.implementation.createDocument("", "", null);
    Object.defineProperty(d, "readyState", { configurable: true, get: () => st(d).readyState });
    let handler = null;
    Object.defineProperty(d, "onreadystatechange", { configurable: true, get: () => handler, set: (f) => { handler = f; } });
    Object.defineProperty(d, "ondataavailable", { configurable: true, get: () => st(d).ondataavailable, set: (f) => { st(d).ondataavailable = f; } });
    d.async = true;
    return d;
  }
  function xsltTemplate() {
    let sheet = null;
    return {
      set stylesheet(s) { sheet = s; }, get stylesheet() { return sheet; },
      createProcessor() {
        const params = [];
        const proc = {
          input: null, output: "",
          addParameter(n, v) { params.push([n, v]); },
          transform() {
            const p = new XSLTProcessor();
            p.importStylesheet(sheet.nodeType === 9 ? sheet : sheet.ownerDocument);
            for (const [n, v] of params) p.setParameter(null, n, v);
            const res = p.transformToDocument(proc.input);
            proc.output = res ? (res.documentElement?.outerHTML ?? ser().serializeToString(res)) : "";
            return true;
          },
        };
        return proc;
      },
    };
  }
  // Scripting.Dictionary (日産ESMの context.js 等が使う)
  function dictionary() {
    const m = new Map();
    const d = {
      CompareMode: 0,
      get Count() { return m.size; },
      Add(k, v) { if (m.has(k)) throw new Error("This key is already associated with an element of this collection"); m.set(k, v); },
      Exists: (k) => m.has(k),
      Item(k, ...v) { if (v.length) { m.set(k, v[0]); return; } return m.get(k); },
      Items: () => vbArray([...m.values()]),
      Keys: () => vbArray([...m.keys()]),
      Key(k, nk) { if (m.has(k)) { const v = m.get(k); m.delete(k); m.set(nk, v); } },
      Remove(k) { if (!m.delete(k)) throw new Error("Element not found"); },
      RemoveAll() { m.clear(); },
    };
    d.item = d.Item; d.exists = d.Exists; d.add = d.Add; d.remove = d.Remove;
    return d;
  }
  // プラグインの有無を調べるだけの生成 (Adobe Reader / SVG Viewer) は「ある」と答える
  const pluginStub = (name) => ({ GetVersions: () => "Accessibility=11.0;", getVersion: () => "11.0", __stub: name });
  function ActiveXObject(progId) {
    const id = String(progId).toLowerCase();
    if (/(xmldom|domdocument)/.test(id)) return newXmlDoc();
    if (/(xmlhttp|serverxmlhttp)/.test(id)) return new XMLHttpRequest();
    if (/xsltemplate/.test(id)) return xsltTemplate();
    if (id === "scripting.dictionary") return dictionary();
    if (/(acropdf|pdf\.pdfctrl|svgctl|adobe\.svg)/.test(id)) return pluginStub(progId);
    log("未対応のActiveX:", progId);
    throw new Error(`Automation server can't create object (${progId})`);
  }
  if (ieMode) {
    window.ActiveXObject = ActiveXObject;
    log("IEモードで表示中", rootKey);
  }

  if (navMode) {
    const nav = { appName: "Microsoft Internet Explorer", appVersion: "4.0 (compatible; MSIE 6.0; Windows NT 5.1)", platform: "Win32" };
    for (const [k, v] of Object.entries(nav)) try { Object.defineProperty(Navigator.prototype, k, { configurable: true, get: () => v }); } catch {}
    log("IEのブラウザ名で表示中", navKey);
  }
  // IEでは id だけを付けた frame/iframe も window.<id> でフレームのウィンドウとして参照できる
  function exposeFrame(el) {
    const id = el.id;
    if (!id || el.name === id || !(ieMode || navMode)) return;
    try { if (window[id] !== el) return; } catch { return; }
    try { Object.defineProperty(window, id, { configurable: true, get: () => el.contentWindow }); } catch {}
  }
  // 読み込み直し: 「直接開いたか (document.referrer が空か)」で初期化を分ける資料があるので、参照元を付けずに開き直す
  function reloadClean() {
    setTimeout(() => {
      try {
        const m = document.createElement("meta");
        m.name = "referrer"; m.content = "no-referrer";
        (document.head || document.documentElement).appendChild(m);
      } catch {}
      location.replace(location.href);
    }, 0);
  }
  const ieAlert = /Internet Explorer|Microsoft Windows/i;
  const origAlert = window.alert;
  window.alert = function (msg) {
    if (!navMode && ieAlert.test(String(msg))) {
      try {
        const k = "fainesIEnavreload:" + location.href;
        if (!sessionStorage.getItem(k)) {
          sessionStorage.setItem(k, "1");
          store?.setItem(navKey, "1");
          log("IE専用の確認で止まったページ → IEのブラウザ名で再読み込み");
          reloadClean();
          return;
        }
      } catch {}
    }
    return origAlert.apply(this, arguments);
  };

  // ActiveXObject が無くて止まったら、この資料をIEモードにして読み込み直す (資料ごとに1回)
  const needsIE = (msg) => /ActiveXObject is not defined|ActiveXObject is not a constructor/.test(String(msg));
  window.addEventListener("error", (e) => {
    if (ieMode || !needsIE(e.message || e.error)) return;
    try {
      const k = "fainesIEreload:" + location.href;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
      store?.setItem(rootKey, "1");
    } catch { return; }
    log("ActiveXObject が必要なページ → IEモードで再読み込み");
    setTimeout(() => location.reload(), 0);
  }, true);

  // ======================= XMLデータアイランド (<xml id=x src=...>) =======================
  function upgradeIsland(el) {
    if (el.__fainesIsland) return;
    el.__fainesIsland = true;
    const doc = newXmlDoc();
    doc.async = false;
    const src = el.getAttribute("src");
    if (src) doc.load(new URL(src, document.baseURI).href);
    else doc.loadXML(el.innerHTML.trim());
    for (const k of ["XMLDocument", "documentElement"]) Object.defineProperty(el, k, { configurable: true, get: () => (k === "XMLDocument" ? doc : doc.documentElement) });
    for (const k of ["selectNodes", "selectSingleNode", "transformNode", "load", "loadXML"]) el[k] = (...a) => doc[k](...a);
    Object.defineProperty(el, "xml", { configurable: true, get: () => doc.xml });
  }

  // ======================= 古いSVG/PDF埋め込みの修正 =======================
  function fixEmbed(el) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "image/svg-xml" || type === "image/svg") el.setAttribute("type", "image/svg+xml");
    // Adobe SVG Viewer の pluginspage 等は無視されるので何もしない
  }

  function scan(root) {
    if (!root.querySelectorAll) return;
    for (const el of root.querySelectorAll("xml")) upgradeIsland(el);
    for (const el of root.querySelectorAll("embed[type],object[type]")) fixEmbed(el);
    for (const el of root.querySelectorAll("frame[id],iframe[id]")) exposeFrame(el);
  }
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const tn = n.localName;
      if (tn === "xml") upgradeIsland(n);
      else if (tn === "embed" || tn === "object") fixEmbed(n);
      else if (tn === "frame" || tn === "iframe") exposeFrame(n);
      else if (n.firstElementChild) scan(n);
    }
  }).observe(document, { childList: true, subtree: true });
  // document.all.dataIsland.XMLDocument のように、パース直後のスクリプトから参照される場合に備えて
  // <xml> 要素の取得時にも変換する
  const origGetById = Document.prototype.getElementById;
  Document.prototype.getElementById = function (id) {
    const el = origGetById.call(this, id);
    if (el && el.localName === "xml") upgradeIsland(el);
    return el;
  };
})();
