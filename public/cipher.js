(function () {
  const PUA_START = 0xe000; // phải khớp với server
  const BASE_CHARS = Array.from({ length: 95 }, (_, i) =>
    String.fromCharCode(32 + i)
  );
  const EXTRA_CHARS = ["\n", "\r", "\t"];
  const CIPHER_ALPHABET = [...BASE_CHARS, ...EXTRA_CHARS];
  const ENCODE_MAP = new Map(
    CIPHER_ALPHABET.map((ch, idx) => [ch, idx])
  );
  const PUA_END = PUA_START + CIPHER_ALPHABET.length - 1;
  const CIPHER_FONT_FAMILY = "SigmaCipher";

  function encodeText(str = "") {
    return String(str)
      .split("")
      .map((ch) => {
        if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
          return ch;
        }
        const idx = ENCODE_MAP.get(ch);
        if (typeof idx !== "number") return ch;
        return String.fromCharCode(PUA_START + idx);
      })
      .join("");
  }

  function decodeProtectedText(str = "") {
    return String(str)
      .split("")
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (code >= PUA_START && code <= PUA_END) {
          return CIPHER_ALPHABET[code - PUA_START];
        }
        return ch;
      })
      .join("");
  }

  function basicFormatText(raw = "") {
    let text = String(raw || "")
      .replace("&amp;", "&")
      .replace("&lt;", "<")
      .replace("&gt;", ">");

    text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    text = text.replace(/__([^_]+?)__/g, "<u>$1</u>");
    text = text.replace(/\*(.+?)\*/g, "<i>$1</i>");
    text = text
      .replace(/\r\n/g, "\n")
      .replace(/\n\n+/g, "<br><br>")
      .replace(/\n/g, "<br>");

    return text;
  }

  function encodeTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest("[data-math]")) {
        continue;
      }
      node.nodeValue = encodeText(node.nodeValue);
    }
  }

  function wrapMathExpressions(root) {
    const pattern = /\\\((.+?)\\\)/g;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }

    nodes.forEach((textNode) => {
      const text = textNode.nodeValue;
      if (!text || !text.includes("\\(")) return;

      pattern.lastIndex = 0;
      let match;
      let lastIndex = 0;
      let hasMatch = false;
      const fragment = document.createDocumentFragment();

      while ((match = pattern.exec(text)) !== null) {
        hasMatch = true;
        const matchIndex = match.index;
        if (matchIndex > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.slice(lastIndex, matchIndex))
          );
        }

        const span = document.createElement("span");
        span.setAttribute("data-math", "true");
        span.className = "math-token";
        span.textContent = match[0];
        fragment.appendChild(span);

        lastIndex = matchIndex + match[0].length;
      }

      if (!hasMatch) return;

      if (lastIndex < text.length) {
        fragment.appendChild(
          document.createTextNode(text.slice(lastIndex))
        );
      }

      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }

  function buildCipherHtml(encoded = "") {
    const plain = decodeProtectedText(encoded || "");
    const formatted = basicFormatText(plain);
    const tmp = document.createElement("div");
    tmp.innerHTML = formatted;
    wrapMathExpressions(tmp);
    encodeTextNodes(tmp);
    return tmp.innerHTML;
  }

  function decodeQuestionPayload(questions = []) {
    return (questions || []).map((q) => ({
      ...q,
      question: decodeProtectedText(q.question || ""),
      choices: {
        A: decodeProtectedText(q.choices?.A || ""),
        B: decodeProtectedText(q.choices?.B || ""),
        C: decodeProtectedText(q.choices?.C || ""),
        D: decodeProtectedText(q.choices?.D || ""),
      },
    }));
  }

  function loadCipherFont() {
    if (!document.fonts || typeof document.fonts.load !== "function") {
      return Promise.resolve(false);
    }
    if (!window.__cipherFontPromise) {
      window.__cipherFontPromise = document.fonts
        .load(`16px "${CIPHER_FONT_FAMILY}"`)
        .then((fonts) => {
          window.__cipherFontReady = fonts && fonts.length > 0;
          return window.__cipherFontReady;
        })
        .catch(() => false);
    }
    return window.__cipherFontPromise;
  }

  function renderCipherText(el, encoded) {
    if (!el) return;
    el.textContent = encoded || "";
    el.classList.add("cipher-text");
  }

  function renderCipherHtml(el, encoded) {
    if (!el) return;
    el.innerHTML = buildCipherHtml(encoded || "");
    el.classList.add("cipher-text");
  }

  if (typeof document !== "undefined" && document.fonts) {
    loadCipherFont();
  }

  window.encodeText = encodeText;
  window.decodeProtectedText = decodeProtectedText;
  window.decodeQuestionPayload = decodeQuestionPayload;
  window.loadCipherFont = loadCipherFont;
  window.renderCipherText = renderCipherText;
  window.renderCipherHtml = renderCipherHtml;
  window.buildCipherHtml = buildCipherHtml;
})();
