// src/utils/textCipher.js
// Biến chữ ASCII thường thành ký tự trong Private Use Area (PUA)
// để API trả về text đã "mã hóa" – client cần bộ giải mã/font mới đọc được.

const PUA_START = 0xe000; // U+E000

// Các ký tự ASCII in thường dùng (từ space 32 đến ~126) + xuống dòng / tab
const BASE_CHARS = Array.from({ length: 95 }, (_, i) =>
  String.fromCharCode(32 + i)
);
const EXTRA_CHARS = ["\n", "\r", "\t"];
const CIPHER_ALPHABET = [...BASE_CHARS, ...EXTRA_CHARS];
const PUA_END = PUA_START + CIPHER_ALPHABET.length - 1;

function encodeText(str = "") {
  return String(str)
    .split("")
    .map((ch) => {
      if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
        return ch;
      }
      const idx = CIPHER_ALPHABET.indexOf(ch);
      if (idx === -1) return ch;
      return String.fromCharCode(PUA_START + idx);
    })
    .join("");
}

function encodeQuestionPayload(questions = []) {
  return (questions || []).map((q) => ({
    ...q,
    question: encodeText(q.question || ""),
    choices: {
      A: encodeText(q.choices?.A || ""),
      B: encodeText(q.choices?.B || ""),
      C: encodeText(q.choices?.C || ""),
      D: encodeText(q.choices?.D || ""),
    },
    explanation: encodeText(q.explanation || ""),
  }));
}

module.exports = {
  encodeText,
  encodeQuestionPayload,
  PUA_START,
  PUA_END,
  CIPHER_ALPHABET,
};
