let questions = [];
let current = 0;

// answers: { questionId: "A" }
let answers = {};
// eliminatedChoices: { questionId: ["A", "C"] }
let eliminatedChoices = {};
// review list: [ questionIndex ]
let reviewList = [];
// highlights: { questionId: { passage: [ { start, end, color } ], question: [ { start, end, color } ] } }
let highlights = {};
let pendingSelection = null;
const DEFAULT_HIGHLIGHT_COLOR = "yellow";
const HIGHLIGHT_TARGETS = {
  passage: "passage",
  question: "question",
  choices: "choices",
};
const CHOICE_OPTIONS = ["A", "B", "C", "D"];
const MOBILE_BREAKPOINT = 768;
const mobileLayoutMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
let mobileLayoutState = null;
const bottomBarUserEl = document.getElementById("bottom-bar-user");

async function loadBottomBarUser() {
  if (!bottomBarUserEl) return;
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (!res.ok) {
      bottomBarUserEl.textContent = "";
      return;
    }
    const me = await res.json();
    const name = me?.googleName || me?.username || me?.email || "";
    bottomBarUserEl.textContent = name;
  } catch (error) {
    console.error("Failed to load user info:", error);
    if (bottomBarUserEl) bottomBarUserEl.textContent = "";
  }
}

if (typeof window.loadCipherFont === "function") {
  window.loadCipherFont();
}

loadBottomBarUser();

function syncMobileSinglePaneLayout(source = "manual") {
  const leftPane = document.getElementById("left-pane");
  const rightPane = document.getElementById("right-pane");
  if (!leftPane || !rightPane) return;

  const imageWrapper = document.getElementById("question-image-wrapper");
  const passage = document.getElementById("passage");
  const mathGridDirections = document.getElementById("math-grid-directions");
  if (!imageWrapper || !passage || !mathGridDirections) return;

  let mobileMergedPane = document.getElementById("mobile-merged-pane");
  const viewportWidth = Math.min(
    window.innerWidth || Infinity,
    document.documentElement?.clientWidth || Infinity,
    window.visualViewport?.width || Infinity
  );
  const mediaQueryMobile = mobileLayoutMediaQuery.matches;
  const fallbackMobile = viewportWidth <= MOBILE_BREAKPOINT;
  const isMobile = mediaQueryMobile || fallbackMobile;
  const nextState = isMobile ? "mobile" : "desktop";

  if (mobileLayoutState !== nextState) {
    mobileLayoutState = nextState;
    console.log(
      `[SAT Test Layout] switched to ${nextState.toUpperCase()} mode (source: ${source}, width: ${Math.round(viewportWidth)}px, mq: ${mediaQueryMobile}, fallback: ${fallbackMobile})`
    );
  } else {
    console.log(
      `[SAT Test Layout] still ${nextState.toUpperCase()} mode (source: ${source}, width: ${Math.round(viewportWidth)}px, mq: ${mediaQueryMobile}, fallback: ${fallbackMobile})`
    );
  }

  if (isMobile) {
    document.body.classList.add("mobile-single-pane");
    if (!mobileMergedPane) {
      mobileMergedPane = document.createElement("div");
      mobileMergedPane.id = "mobile-merged-pane";
      rightPane.insertBefore(mobileMergedPane, rightPane.firstChild);
    }

    mobileMergedPane.append(imageWrapper, passage, mathGridDirections);
    return;
  }

  document.body.classList.remove("mobile-single-pane");
  leftPane.append(imageWrapper, passage, mathGridDirections);

  if (mobileMergedPane) {
    mobileMergedPane.remove();
  }
}


function normalizeCipherQuestions(rawQuestions = []) {
  return (rawQuestions || []).map((q) => ({
    ...q,
    cipherQuestion: q.question || "",
    cipherChoices: {
      A: q.choices?.A || "",
      B: q.choices?.B || "",
      C: q.choices?.C || "",
      D: q.choices?.D || "",
    },
  }));
}

function decodeCipherText(text = "") {
  if (typeof window.decodeProtectedText === "function") {
    return window.decodeProtectedText(text);
  }
  return String(text || "");
}

function encodePlainText(text = "") {
  if (typeof window.encodeText === "function") {
    return window.encodeText(text);
  }
  return String(text || "");
}

function renderCipher(el, encoded) {
  if (typeof window.renderCipherHtml === "function") {
    window.renderCipherHtml(el, encoded);
  } else if (el) {
    el.textContent = encoded || "";
  }
}

function formatPlainText(raw = "") {
  let text = String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__([^_]+?)__/g, "<u>$1</u>");
  text = text.replace(/\*(.+?)\*/g, "<i>$1</i>");
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/\n\n+/g, "<br><br>")
    .replace(/\n/g, "<br>");

  return text;
}

function renderPlainHtml(el, rawText) {
  if (!el) return;
  el.innerHTML = formatPlainText(rawText);
  el.classList.remove("cipher-text");
}

function normalizeQuestionText(rawText = "") {
  return String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

function removeTopicLine(rawText = "") {
  return normalizeQuestionText(rawText)
    .split("\n")
    .filter((line) => !/^\s*\[[^\]]+\]\s*$/.test(line))
    .join("\n");
}



function typesetMath(elements = []) {
  const targets = elements.filter(Boolean);
  if (!targets.length) return;

  const queueTargets = () => {
    window.__mathJaxQueue = window.__mathJaxQueue || [];
    window.__mathJaxQueue.push(targets);
  };

  const runTypeset = () => {
    if (!window.MathJax) return;
    if (typeof window.MathJax.typesetPromise === "function") {
      window.MathJax.typesetPromise(targets);
    } else if (typeof window.MathJax.typeset === "function") {
      window.MathJax.typeset(targets);
    } else {
      queueTargets();
    }
  };

  if (window.MathJax?.startup?.promise) {
    window.MathJax.startup.promise.then(runTypeset);
    return;
  }

  if (!window.MathJax) {
    queueTargets();
    return;
  }

  runTypeset();
}

function showAccessMessage(message) {
  const container = document.getElementById("container");
  if (container) {
    container.innerHTML = `<div class="pro-locked">${message}</div>`;
  }
  const bottomBar = document.getElementById("bottom-bar");
  if (bottomBar) bottomBar.classList.add("hidden");
  const timerBar = document.getElementById("top-timer-bar");
  if (timerBar) timerBar.classList.add("hidden");
}

/* ----------------------------------------------------------
   LẤY THÔNG TIN TỪ URL
---------------------------------------------------------- */
const params = new URLSearchParams(window.location.search);
const file = params.get("file");            // tên file test
const gotoParam = params.get("goto");       // có thể là số hoặc "LAST"
const categoryFromFile = file ? file.split("/")[0] : null;

function formatTestName(testFile = "") {
  const cleaned = String(testFile || "").replace(
    /^(?:real_tests|practice_tests|starter|cramming|math|math_cramming)\//,
    ""
  );
  return cleaned || "SAT Test";
}

const timerTitleEl = document.getElementById("timer-title");
if (timerTitleEl) {
  timerTitleEl.textContent = formatTestName(file);
}

const isMathCategory = categoryFromFile === "math" || categoryFromFile === "math_cramming";

if (isMathCategory) {
  document.body.classList.add("math-section");
}

document.getElementById("save-exit-btn").onclick = () => {
  // Dừng đếm giờ
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  // Lưu state rồi mới thoát
  saveState()
    .finally(() => {
      // Nếu biết category (file có dạng "category/name"), quay lại trang practice tương ứng
      const dest = categoryFromFile
        ? `practice.html?category=${encodeURIComponent(categoryFromFile)}`
        : "practice.html";
      window.location.href = dest;
    });
};

const calculatorToggleBtn = document.getElementById("calculator-toggle-btn");
const highlightToggleBtn = document.getElementById("highlight-toggle-btn");
const calculatorPanel = document.getElementById("calculator-panel");
const calculatorHeader = document.getElementById("calculator-header");
const calculatorExtendBtn = document.getElementById("calculator-extend-btn");
const calculatorCloseBtn = document.getElementById("calculator-close-btn");
const desmosContainer = document.getElementById("desmos-calculator");
let desmosCalculator = null;
const CALCULATOR_DEFAULT_WIDTH = 320;
const CALCULATOR_EXTENDED_WIDTH = 640;
let isAutoHighlightEnabled = false;

function setAutoHighlightEnabled(enabled) {
  isAutoHighlightEnabled = Boolean(enabled);
  if (!highlightToggleBtn) return;
  highlightToggleBtn.classList.toggle("active", isAutoHighlightEnabled);
  highlightToggleBtn.setAttribute("aria-pressed", String(isAutoHighlightEnabled));
}

if (highlightToggleBtn) {
  highlightToggleBtn.addEventListener("click", () => {
    setAutoHighlightEnabled(!isAutoHighlightEnabled);
    if (isAutoHighlightEnabled) {
      hideHighlightMenu();
    }
  });
}

function ensureDesmosCalculator() {
  if (desmosCalculator || !desmosContainer || !window.Desmos) return;
  desmosCalculator = Desmos.GraphingCalculator(desmosContainer, {
    expressions: true,
    settingsMenu: false,
    keypad: true,
  });
}

if (calculatorToggleBtn && calculatorPanel) {
  calculatorToggleBtn.addEventListener("click", () => {
    const isHidden = calculatorPanel.classList.toggle("hidden");
    if (!isHidden) {
      ensureDesmosCalculator();
    }
  });
}

if (calculatorCloseBtn && calculatorPanel) {
  calculatorCloseBtn.addEventListener("click", () => {
    calculatorPanel.classList.add("hidden");
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function keepPanelInBounds() {
  if (!calculatorPanel) return;
  const rect = calculatorPanel.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width;
  const maxTop = window.innerHeight - rect.height;
  const nextLeft = clamp(rect.left, 0, Math.max(0, maxLeft));
  const nextTop = clamp(rect.top, 0, Math.max(0, maxTop));
  calculatorPanel.style.left = `${nextLeft}px`;
  calculatorPanel.style.top = `${nextTop}px`;
  calculatorPanel.style.right = "auto";
}

if (calculatorExtendBtn && calculatorPanel) {
  calculatorExtendBtn.addEventListener("click", () => {
    const currentWidth = calculatorPanel.getBoundingClientRect().width;
    const nextWidth =
      currentWidth >= CALCULATOR_EXTENDED_WIDTH
        ? CALCULATOR_DEFAULT_WIDTH
        : CALCULATOR_EXTENDED_WIDTH;
    calculatorPanel.style.width = `${nextWidth}px`;
    keepPanelInBounds();
  });
}

if (calculatorHeader && calculatorPanel) {
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const onMouseMove = (event) => {
    if (!isDragging) return;
    const rect = calculatorPanel.getBoundingClientRect();
    const nextLeft = clamp(
      event.clientX - dragOffsetX,
      0,
      window.innerWidth - rect.width
    );
    const nextTop = clamp(
      event.clientY - dragOffsetY,
      0,
      window.innerHeight - rect.height
    );
    calculatorPanel.style.left = `${nextLeft}px`;
    calculatorPanel.style.top = `${nextTop}px`;
    calculatorPanel.style.right = "auto";
  };

  const onMouseUp = () => {
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };

  calculatorHeader.addEventListener("mousedown", (event) => {
    isDragging = true;
    const rect = calculatorPanel.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

let gotoIndex = null;
if (gotoParam === "LAST") {
  gotoIndex = "LAST";
} else if (!isNaN(parseInt(gotoParam))) {
  gotoIndex = parseInt(gotoParam);
}

/* ----------------------------------------------------------
   TIMER
---------------------------------------------------------- */

let timerHidden = false;

const timerToggleBtn = document.getElementById("timer-toggle");
const timerValueEl = document.getElementById("timer-value");

function setTimerHidden(hidden) {
  timerHidden = hidden;
  if (timerToggleBtn) {
    timerToggleBtn.textContent = timerHidden ? "Show" : "Hide";
  }
  updateTimerUI(timeLimit);
}

if (timerToggleBtn) {
  timerToggleBtn.addEventListener("click", () => {
    setTimerHidden(!timerHidden);
  });
}

const DEFAULT_TIME_LIMIT_SECONDS = isMathCategory ? 35 * 60 : 32 * 60;
const AUTO_SAVE_INTERVAL_SECONDS = 20;
let timeLimit = DEFAULT_TIME_LIMIT_SECONDS;
let timerInterval = null;
let elapsedSinceLastAutoSave = 0;
let questionTimeSpentSeconds = {};
let activeQuestionId = null;
let activeQuestionStartedAt = null;

function getSafeQuestionId(value) {
  return value === null || value === undefined ? null : String(value);
}

function normalizeQuestionTimeMeta(rawMeta = {}) {
  const normalized = {};
  if (!rawMeta || typeof rawMeta !== "object") return normalized;

  Object.entries(rawMeta).forEach(([questionId, seconds]) => {
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    normalized[String(questionId)] = parsed;
  });

  return normalized;
}

function syncQuestionTimeMetaToAnswers() {
  answers.__meta_question_time_seconds = Object.fromEntries(
    Object.entries(questionTimeSpentSeconds).map(([questionId, seconds]) => [
      questionId,
      Math.max(0, Math.round(Number(seconds) || 0)),
    ])
  );
}

function flushActiveQuestionTime() {
  if (!activeQuestionId || !activeQuestionStartedAt) return;

  const now = Date.now();
  const elapsed = (now - activeQuestionStartedAt) / 1000;
  if (elapsed > 0) {
    questionTimeSpentSeconds[activeQuestionId] =
      (Number(questionTimeSpentSeconds[activeQuestionId]) || 0) + elapsed;
    syncQuestionTimeMetaToAnswers();
  }

  activeQuestionStartedAt = now;
}

function setActiveQuestionTrackingByIndex(index) {
  flushActiveQuestionTime();

  const question = questions[index];
  activeQuestionId = getSafeQuestionId(question?.id);
  activeQuestionStartedAt = document.hidden || !activeQuestionId ? null : Date.now();
}

function hydrateQuestionTimeFromAnswers() {
  questionTimeSpentSeconds = normalizeQuestionTimeMeta(
    answers?.__meta_question_time_seconds
  );
  syncQuestionTimeMetaToAnswers();
}

function getTestStatePayload() {
  return {
    file,
    answers,
    eliminatedChoices,
    reviewList,
    highlights,
    currentIndex: current,
    remainingTime: timeLimit,
  };
}


function startTimer() {
  updateTimerUI(timeLimit);

  timerInterval = setInterval(() => {
    timeLimit--;
    elapsedSinceLastAutoSave++;

    updateTimerUI(timeLimit);
    if (elapsedSinceLastAutoSave >= AUTO_SAVE_INTERVAL_SECONDS) {
      elapsedSinceLastAutoSave = 0;
      saveState();
    }

    if (timeLimit <= 0) {
      clearInterval(timerInterval);
      window.location.href = "score.html?file=" + file;
    }
  }, 1000);
}

function updateTimerUI(seconds) {
  if (seconds < 0) seconds = 0;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  const display = `${min}:${sec < 10 ? "0" + sec : sec}`;

  if (!timerValueEl) return;
  if (timerHidden) {
    timerValueEl.innerText = "--:--";
    return;
  }
  timerValueEl.innerText = display;
}

/* ----------------------------------------------------------
   SAVE STATE -> LƯU TRÊN DB
---------------------------------------------------------- */
function saveState() {
  flushActiveQuestionTime();

  const payload = getTestStatePayload();

  if (activeQuestionId && !document.hidden) {
    activeQuestionStartedAt = Date.now();
  }

  return fetch("/api/test-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Save state error:", err));
}

/* ----------------------------------------------------------
   LOAD TEST + LOAD STATE TỪ DB
---------------------------------------------------------- */
async function load() {
  // 1. Lấy đề
  const res = await fetch(`/api/parsed-test?file=${encodeURIComponent(file)}`);
  if (!res.ok) {
    let errMsg = "Không thể tải đề thi.";
    try {
      const err = await res.json();
      if (err?.error) errMsg = err.error;
    } catch (e) {
      /* ignore */
    }
    showAccessMessage(errMsg);
    return;
  }
  const data = await res.json();
  questions = normalizeCipherQuestions(data.questions);
  document.getElementById("total-question").innerText = questions.length;

  // 2. Lấy state từ database
  let state = null;
  try {
    state = await fetch(`/api/test-state?file=${file}`).then((r) => r.json());
  } catch (e) {
    console.error("Error loading state from DB:", e);
  }

  if (state && state.hasData) {
    answers = state.answers || {};
    eliminatedChoices = state.eliminatedChoices || {};
    reviewList = state.reviewList || [];
    highlights = state.highlights || {};
    current = state.currentIndex || 0;
    if (typeof state.remainingTime === "number" && state.remainingTime > 0) {
      timeLimit = state.remainingTime;
      if (isMathCategory && timeLimit === 32 * 60) {
        timeLimit = 35 * 60;
      }
    }
  } else {
    // nếu chưa có state, bắt đầu mới
    answers = {};
    eliminatedChoices = {};
    reviewList = [];
    highlights = {};
    current = 0;
    timeLimit = DEFAULT_TIME_LIMIT_SECONDS;
  }
  hydrateQuestionTimeFromAnswers();

  // 3. Nếu có goto (từ review)
  if (gotoIndex !== null) {
    if (gotoIndex === "LAST") {
      current = questions.length - 1;
    } else if (gotoIndex >= 0 && gotoIndex < questions.length) {
      current = gotoIndex;
    }
  }

  // 4. Đảm bảo current nằm trong [0, questions.length-1]
  if (current < 0 || current >= questions.length) {
    current = 0;
  }

  // 5. Render lần đầu + start timer
  render();
  renderGrid();
  setActiveQuestionTrackingByIndex(current);
  startTimer();
}

/* ----------------------------------------------------------
   LOAD ẢNH — CHỈ HÀM NÀY LÀ MỚI
---------------------------------------------------------- */

let imageRequestId = 0;
const questionImageCache = new Map();
let lastRenderedQuestionId = null;
async function loadQuestionImage(question) {
  const imgWrapper = document.getElementById("question-image-wrapper");
  const imgEl = document.getElementById("question-image");

  // Nếu HTML chưa có wrapper/img → không làm gì, tránh crash
  if (!imgWrapper || !imgEl) return;

  if (!question || typeof question.id !== "number") {
    imgEl.removeAttribute("src");
    imgWrapper.classList.add("hidden");
    return;
  }

  const { id: questionId, image: declaredImagePath } = question;


  if (questionImageCache.has(questionId)) {
    const cachedPath = questionImageCache.get(questionId);
    if (cachedPath) {
      imgEl.src = cachedPath;
      imgEl.alt = `Question ${questionId} illustration`;
      imgWrapper.classList.remove("hidden");
      if (isMathCategory) {
        const questionTextEl = document.getElementById("question-text");
        if (questionTextEl?.parentElement) {
          questionTextEl.parentElement.insertBefore(
            imgWrapper,
            questionTextEl.nextSibling
          );
        }
      }
    } else {
      imgEl.removeAttribute("src");
      imgWrapper.classList.add("hidden");
    }
    return;
  }

  imageRequestId += 1;
  const requestId = imageRequestId;
  imgWrapper.dataset.imageRequestId = String(requestId);
  imgWrapper.dataset.questionId = String(questionId);


  const resolvedPath = declaredImagePath || null;

  if (String(requestId) !== imgWrapper.dataset.imageRequestId) {
    return;
  }

  questionImageCache.set(questionId, resolvedPath);


  if (resolvedPath) {
    imgEl.src = resolvedPath;
    imgEl.alt = `Question ${questionId} illustration`;
    imgWrapper.classList.remove("hidden");
    if (isMathCategory) {
      const questionTextEl = document.getElementById("question-text");
      if (questionTextEl?.parentElement) {
        questionTextEl.parentElement.insertBefore(
          imgWrapper,
          questionTextEl.nextSibling
        );
      }
    }
  } else {
    imgEl.removeAttribute("src");
    imgWrapper.classList.add("hidden");
  }
}

/* ----------------------------------------------------------
   HIGHLIGHT HELPERS
---------------------------------------------------------- */
function getOffsetsWithinPassage(range, root) {
  const preSelectionRange = range.cloneRange();
  preSelectionRange.selectNodeContents(root);
  preSelectionRange.setEnd(range.startContainer, range.startOffset);
  const start = preSelectionRange.toString().length;

  const selectionRange = range.cloneRange();
  selectionRange.selectNodeContents(root);
  selectionRange.setEnd(range.endContainer, range.endOffset);
  const end = selectionRange.toString().length;

  const maxLen = root.textContent.length;
  const normalizedStart = Math.max(0, Math.min(start, maxLen));
  const normalizedEnd = Math.max(0, Math.min(end, maxLen));

  if (normalizedStart === normalizedEnd) return null;

  return {
    start: Math.min(normalizedStart, normalizedEnd),
    end: Math.max(normalizedStart, normalizedEnd),
  };
}

function findTextPosition(root, target) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node;
  while ((node = walker.nextNode())) {
    const next = offset + node.textContent.length;
    if (target <= next) {
      return { node, offset: target - offset };
    }
    offset = next;
  }
  return null;
}

function normalizeHighlightRanges(ranges) {
  return (ranges || [])
    .filter((r) => typeof r?.start === "number" && typeof r?.end === "number")
    .map((r) => ({
      start: r.start,
      end: r.end,
      color: r.color || DEFAULT_HIGHLIGHT_COLOR,
    }));
}

function normalizeChoiceHighlights(choices = {}) {
  const normalized = {};
  CHOICE_OPTIONS.forEach((option) => {
    normalized[option] = normalizeHighlightRanges(choices?.[option]);
  });
  return normalized;
}

function ensureHighlightBuckets(questionId) {
  const existing = highlights[questionId];

  if (Array.isArray(existing)) {
    highlights[questionId] = {
      passage: normalizeHighlightRanges(existing),
      question: [],
      choices: normalizeChoiceHighlights(),
    };
  } else if (!existing || typeof existing !== "object") {
    highlights[questionId] = {
      passage: [],
      question: [],
      choices: normalizeChoiceHighlights(),
    };
  } else {
    highlights[questionId] = {
      passage: normalizeHighlightRanges(existing.passage),
      question: normalizeHighlightRanges(existing.question),
      choices: normalizeChoiceHighlights(existing.choices),
    };
  }

  return highlights[questionId];
}

function wrapRangeInMark(root, start, end, color = DEFAULT_HIGHLIGHT_COLOR) {
  if (end <= start) return;
  const startPos = findTextPosition(root, start);
  const endPos = findTextPosition(root, end);
  if (!startPos || !endPos) return;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);

  const mark = document.createElement("mark");
  mark.className = `highlight highlight-${color}`;
  mark.dataset.highlightStart = String(start);
  mark.dataset.highlightEnd = String(end);
  mark.dataset.highlightColor = color;

  // Use extractContents + insertNode instead of surroundContents to avoid
  // InvalidStateError when the range only partially selects non-text nodes
  // (e.g., formatting tags). This approach safely wraps the selected content
  // without requiring perfectly aligned boundaries.
  const contents = range.extractContents();
  mark.appendChild(contents);
  range.insertNode(mark);
}

function mergeRanges(list) {
  const sorted = normalizeHighlightRanges(list).sort((a, b) => a.start - b.start);  

  const merged = [];
  sorted.forEach((r) => {
    if (!merged.length) {
      merged.push({ start: r.start, end: r.end, color: r.color });
      return;
    }
    const last = merged[merged.length - 1];
    if (r.color === last.color && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end, color: r.color });
    }
  });

  return merged;
}

function applyHighlightsForQuestion(questionId) {
  const buckets = ensureHighlightBuckets(questionId);
  const passageEl = document.getElementById("passage");
  const questionTextEl = document.getElementById("question-text");
  const choiceTextEls = document.querySelectorAll(".choice-text[data-choice-option]");

  if (passageEl && buckets.passage.length) {
    buckets.passage.forEach((r) =>
      wrapRangeInMark(passageEl, r.start, r.end, r.color)
    );
  }

  if (questionTextEl && buckets.question.length) {
    buckets.question.forEach((r) =>
      wrapRangeInMark(questionTextEl, r.start, r.end, r.color)
    );
  }

  if (choiceTextEls.length && buckets.choices) {
    const choiceMap = {};
    choiceTextEls.forEach((el) => {
      const option = el.dataset.choiceOption;
      if (option) choiceMap[option] = el;
    });

    Object.entries(buckets.choices).forEach(([option, ranges]) => {
      const targetEl = choiceMap[option];
      if (!targetEl || !ranges?.length) return;
      ranges.forEach((r) => wrapRangeInMark(targetEl, r.start, r.end, r.color));
    });
  }
}

function hideHighlightMenu() {
  const menu = document.getElementById("highlight-menu");
  if (menu) {
    menu.classList.add("hidden");
  }
  pendingSelection = null;
}

function positionHighlightMenu(rect) {
  const menu = document.getElementById("highlight-menu");
  if (!menu) return;

  const top = rect.bottom + window.scrollY + 8;
  const left = rect.left + window.scrollX + rect.width / 2;
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.classList.remove("hidden");
}

function handleHighlightSelection(rootEl, targetKey, option = null) {
  const selection = window.getSelection();
  if (!rootEl || !selection || selection.rangeCount === 0) {
    hideHighlightMenu();
    return;
  }

  if (selection.isCollapsed) {
    hideHighlightMenu();
    return;
  }

  const range = selection.getRangeAt(0);
  if (!rootEl.contains(range.commonAncestorContainer)) {
    hideHighlightMenu();
    return;
  }

  const offsets = getOffsetsWithinPassage(range, rootEl);
  if (!offsets) {
    hideHighlightMenu();
    return;
  }

  pendingSelection = { offsets, targetKey, option, source: "selection" };

  if (isAutoHighlightEnabled) {
    applyHighlightAction("highlight", DEFAULT_HIGHLIGHT_COLOR);
    selection.removeAllRanges();
    return;
  }
  positionHighlightMenu(range.getBoundingClientRect());
}

function openHighlightEditorForMark(markEl, targetKey, option = null) {
  if (!markEl) return;
  const start = Number(markEl.dataset.highlightStart);
  const end = Number(markEl.dataset.highlightEnd);
  const color = markEl.dataset.highlightColor || DEFAULT_HIGHLIGHT_COLOR;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return;
  }

  const rect = markEl.getBoundingClientRect();
  pendingSelection = {
    offsets: { start, end },
    targetKey,
    option,
    source: "existing",
  };
  positionHighlightMenu(rect);
}

function applyHighlightAction(action, color = DEFAULT_HIGHLIGHT_COLOR) {
  if (!pendingSelection) return;

  const q = questions[current];
  if (!q) {
    hideHighlightMenu();
    return;
  }

  const qId = q.id;
  const buckets = ensureHighlightBuckets(qId);
  const { offsets, targetKey, option, source } = pendingSelection;
  const updateTargetRanges = (rangeList) => {
    const currentRanges = normalizeHighlightRanges(rangeList);

    if (action === "erase") {
      return currentRanges.filter(
        (r) => offsets.end <= r.start || offsets.start >= r.end
      );
    }
    

    if (source === "existing") {
      const withoutCurrent = currentRanges.filter(
        (r) => !(r.start === offsets.start && r.end === offsets.end)
      );
      withoutCurrent.push({ ...offsets, color });
      return mergeRanges(withoutCurrent);
    }
    currentRanges.push({ ...offsets, color });
    return mergeRanges(currentRanges);
  };

  if (targetKey === HIGHLIGHT_TARGETS.choices && option) {
    if (!buckets.choices) buckets.choices = normalizeChoiceHighlights();
    if (!buckets.choices[option]) buckets.choices[option] = [];
    buckets.choices[option] = updateTargetRanges(buckets.choices[option]);
  } else {
    if (!buckets[targetKey]) buckets[targetKey] = [];
    buckets[targetKey] = updateTargetRanges(buckets[targetKey]);
  }

  hideHighlightMenu();
  render();
  saveState();
}

/* ----------------------------------------------------------
   ELIMINATION HELPERS
---------------------------------------------------------- */
function toggleChoiceElimination(questionId, option) {
  if (!eliminatedChoices[questionId]) eliminatedChoices[questionId] = [];

  const idx = eliminatedChoices[questionId].indexOf(option);
  let nowEliminated = false;
  if (idx >= 0) {
    eliminatedChoices[questionId].splice(idx, 1);
  } else {
    eliminatedChoices[questionId].push(option);
    nowEliminated = true;
  }

  if (nowEliminated && answers[questionId] === option) {
    delete answers[questionId];
  }

  render();
  renderGrid();
  saveState();
}

function isChoiceEliminated(questionId, option) {
  return (eliminatedChoices[questionId] || []).includes(option);
}

function clearEliminationForOption(questionId, option) {
  if (!eliminatedChoices[questionId]) return;
  eliminatedChoices[questionId] = eliminatedChoices[questionId].filter(
    (o) => o !== option
  );
}

function isGridQuestion(question = {}) {
  return question.type === "grid";
}

function normalizeGridAnswer(value) {
  return String(value || "").trim();
}

function setGridAnswer(questionId, value) {
  const normalized = normalizeGridAnswer(value);
  if (normalized) {
    answers[questionId] = normalized;
  } else {
    delete answers[questionId];
  }
  renderGrid();
  saveState();
}

function renderGridAnswerInput(question = {}) {
  const box = document.getElementById("choices");
  if (!box) return;

  box.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "grid-answer-wrapper";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "grid-answer-input";
  input.value = answers[question.id] || "";
  input.autocomplete = "off";
  input.inputMode = "decimal";
  input.addEventListener("input", (event) => {
    setGridAnswer(question.id, event.target.value);
  });

  wrapper.appendChild(input);
  box.appendChild(wrapper);
}


/* ----------------------------------------------------------
   RENDER MAIN UI
---------------------------------------------------------- */
function render() {
  const q = questions[current];
  if (!q) return;
  const questionChanged = lastRenderedQuestionId !== q.id;
  const isMathMultipleChoice = isMathCategory && q.type !== "grid";
  document.body.classList.toggle("math-mc", isMathMultipleChoice);
  const isMathGrid = isMathCategory && isGridQuestion(q);
  document.body.classList.toggle("math-grid", isMathGrid);

  hideHighlightMenu();

  // --- Bookmark ---
  const icon = document.getElementById("bookmark-icon");
  const text = document.getElementById("mark-text");

  if (reviewList.includes(current)) {
    icon.src = "/bookmark/bookmark-outline-red.svg";
    text.textContent = "Marked for Review";
  } else {
    icon.src = "/bookmark/bookmark-outline-gray.svg";
    text.textContent = "Mark for Review";
  }

  // --- Tách passage và question ---
  const decodedQuestion = decodeCipherText(q.cipherQuestion);
  const displayQuestion = removeTopicLine(decodedQuestion);
  const lines = displayQuestion.split("\n");
  let questionPrompt = "";
  let passage = "";
  if (isMathCategory) {
    questionPrompt = displayQuestion;
    passage = "";
  } else {
    questionPrompt = lines[0] || "";
    passage = lines.slice(1).join("\n");
  }

  const passageEl = document.getElementById("passage");
  const questionTextEl = document.getElementById("question-text");
  const questionContentEl = document.getElementById("question-content");
  const mathGridDirectionsEl = document.getElementById("math-grid-directions");
  const questionImageWrapper = document.getElementById("question-image-wrapper");
  const leftPane = document.getElementById("left-pane");

  const mobileMergedPane = document.getElementById("mobile-merged-pane");
  const isMobileSinglePane = document.body.classList.contains("mobile-single-pane");

  if (questionImageWrapper && questionContentEl && leftPane) {
    if (isMobileSinglePane && mobileMergedPane) {
      mobileMergedPane.prepend(questionImageWrapper);
    } else if (isMathGrid) {
      questionContentEl.prepend(questionImageWrapper);
    } else {
      leftPane.prepend(questionImageWrapper);
    }
  }

  renderPlainHtml(passageEl, passage);
  renderPlainHtml(questionTextEl, questionPrompt);

  if (mathGridDirectionsEl) {
    mathGridDirectionsEl.classList.toggle("hidden", !isMathGrid);
  }
  if (passageEl) {
    passageEl.classList.toggle("hidden", isMathGrid);
  }
  if (questionImageWrapper && questionChanged) {
    questionImageWrapper.classList.add("hidden");
  }

  document.getElementById("q-number-text").innerText = current + 1;
  document.getElementById("current-question").innerText = current + 1;

  // --- ẢNH CÂU HỎI (GỌI HÀM MỚI) ---
  if (questionChanged) {
    loadQuestionImage(q);
  }


  // --- Đáp án ---
  const box = document.getElementById("choices");
  box.innerHTML = "";

  if (isGridQuestion(q)) {
    renderGridAnswerInput(q);
    applyHighlightsForQuestion(q.id);
    typesetMath([passageEl, questionContentEl]);
    lastRenderedQuestionId = q.id;
    return;
  }

  CHOICE_OPTIONS.forEach((opt) => {
    const isEliminated = isChoiceEliminated(q.id, opt);
    const wrapper = document.createElement("div");
    wrapper.className =
      "choice" +
      (answers[q.id] === opt ? " selected" : "") +
      (isEliminated ? " eliminated" : "");

    wrapper.onclick = () => {
      clearEliminationForOption(q.id, opt);
      answers[q.id] = opt;
      render();
      renderGrid();
      saveState();
    };

    const label = document.createElement("b");
    label.className = "choice-label";
    label.textContent = opt;

    const span = document.createElement("span");
    renderPlainHtml(span, decodeCipherText(q.cipherChoices?.[opt] || ""));

    const textWrap = document.createElement("span");
    textWrap.className = "choice-text";
    textWrap.dataset.choiceOption = opt;

    ["mouseup", "touchend"].forEach((evt) => {
      textWrap.addEventListener(evt, () =>
        handleHighlightSelection(textWrap, HIGHLIGHT_TARGETS.choices, opt)
      );
    });

    textWrap.appendChild(label);
    textWrap.appendChild(span);

    wrapper.appendChild(textWrap);

    const eliminateBtn = document.createElement("button");
    eliminateBtn.type = "button";
    eliminateBtn.className = "eliminate-btn";
    eliminateBtn.textContent = opt;
    eliminateBtn.setAttribute("aria-label", `Loại đáp án ${opt}`);
    eliminateBtn.classList.toggle("active", isEliminated);
    eliminateBtn.onclick = (event) => {
      event.stopPropagation();
      toggleChoiceElimination(q.id, opt);
    };

    wrapper.appendChild(eliminateBtn);
    
    box.appendChild(wrapper);
  });

  applyHighlightsForQuestion(q.id);
  typesetMath([passageEl, questionContentEl]);
  lastRenderedQuestionId = q.id;
}

/* ----------------------------------------------------------
   GRID RENDER
---------------------------------------------------------- */
function renderGrid() {
  const grid = document.getElementById("question-grid");
  if (!grid) return;

  grid.innerHTML = "";

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const div = document.createElement("div");
    div.className = "q-item";
    div.textContent = i + 1;

    if (i === current) div.classList.add("current");
    if (answers[q.id]) div.classList.add("answered");
    if (reviewList.includes(i)) div.classList.add("marked");

    div.onclick = () => {
      setActiveQuestionTrackingByIndex(i);
      current = i;
      hidePopover();
      render();
      renderGrid();
      saveState();
    };

    grid.appendChild(div);
  }
}

/* ----------------------------------------------------------
   NEXT / BACK
---------------------------------------------------------- */
document.getElementById("next-btn").onclick = () => {
  if (current < questions.length - 1) {
    setActiveQuestionTrackingByIndex(current + 1);
    current++;
    render();
    renderGrid();
    saveState();
  } else {
    // Đi hết -> sang review
    flushActiveQuestionTime();
    syncQuestionTimeMetaToAnswers();
    activeQuestionStartedAt = null;
    window.location.href = "review.html?file=" + file;
  }
};

document.getElementById("back-btn").onclick = () => {
  if (current > 0) {
    setActiveQuestionTrackingByIndex(current - 1);
    current--;
    render();
    renderGrid();
    saveState();
  }
};
/* ----------------------------------------------------------
   POPUP
---------------------------------------------------------- */
const popover = document.getElementById("question-popover");

function hidePopover() {
  popover.classList.add("hidden");
}

/* ----------------------------------------------------------
   MARK FOR REVIEW BUTTON (KHÔI PHỤC)
---------------------------------------------------------- */
document.getElementById("mark-review-btn").onclick = () => {
  if (reviewList.includes(current)) {
    // Bỏ mark
    reviewList = reviewList.filter(i => i !== current);
  } else {
    // Thêm mark
    reviewList.push(current);
    
  }

  // Cập nhật UI
  render();
  renderGrid();
  saveState();
};

document.getElementById("question-toggle-btn").onclick = () => {
  popover.classList.toggle("hidden");
};

document.getElementById("close-popover").onclick = hidePopover;

const passageEl = document.getElementById("passage");
const questionTextEl = document.getElementById("question-text");

["mouseup", "touchend"].forEach((evt) => {
  if (passageEl) {
    passageEl.addEventListener(evt, () =>
      handleHighlightSelection(passageEl, HIGHLIGHT_TARGETS.passage)
    );
  }

  if (questionTextEl) {
    questionTextEl.addEventListener(evt, () =>
      handleHighlightSelection(questionTextEl, HIGHLIGHT_TARGETS.question)
    );
  }
});

if (passageEl) {
  passageEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const markEl = target.closest("mark.highlight");
    if (!markEl) return;
    event.stopPropagation();
    openHighlightEditorForMark(markEl, HIGHLIGHT_TARGETS.passage);
  });
}

if (questionTextEl) {
  questionTextEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const markEl = target.closest("mark.highlight");
    if (!markEl) return;
    event.stopPropagation();
    openHighlightEditorForMark(markEl, HIGHLIGHT_TARGETS.question);
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const markEl = target.closest("mark.highlight");
  if (!markEl) return;

  const choiceText = markEl.closest(".choice-text[data-choice-option]");
  if (!choiceText) return;

  const option = choiceText.dataset.choiceOption;
  if (!option) return;

  event.stopPropagation();
  openHighlightEditorForMark(markEl, HIGHLIGHT_TARGETS.choices, option);
});

const highlightColorButtons = document.querySelectorAll("[data-highlight-color]");
const eraseActionBtn = document.getElementById("erase-action");
highlightColorButtons.forEach((btn) => {
  btn.onclick = (e) => {
    e.stopPropagation();
    const color = btn.getAttribute("data-highlight-color") || DEFAULT_HIGHLIGHT_COLOR;
    applyHighlightAction("highlight", color);
  };
});

if (eraseActionBtn) {
  eraseActionBtn.onclick = (e) => {
    e.stopPropagation();
    applyHighlightAction("erase");
  };
}

["mousedown", "touchstart"].forEach((evt) => {
  document.addEventListener(evt, (event) => {
    const menu = document.getElementById("highlight-menu");
    if (!menu) return;
    if (!menu.contains(event.target)) {
      hideHighlightMenu();
    }
  });
});

/* ----------------------------------------------------------
   GO REVIEW
---------------------------------------------------------- */
document.getElementById("go-review-btn").onclick = () => {
  flushActiveQuestionTime();
  syncQuestionTimeMetaToAnswers();
  activeQuestionStartedAt = null;
  window.location.href = "review.html?file=" + file;
};

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    flushActiveQuestionTime();
    activeQuestionStartedAt = null;
    saveState();
    return;
  }

  activeQuestionStartedAt = activeQuestionId ? Date.now() : null;
});

window.addEventListener("beforeunload", () => {
  flushActiveQuestionTime();
  syncQuestionTimeMetaToAnswers();
  activeQuestionStartedAt = null;

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(getTestStatePayload())], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/test-state", blob);
    }
  } catch (error) {
    console.error("beforeunload save error:", error);
  }
});

const directionsBtn = document.getElementById("direction");
const overlay = document.getElementById("directions-overlay");
const closeBtn = document.getElementById("close-directions");
const panel = document.querySelector(".directions-panel");

directionsBtn.addEventListener("click", () => {
  overlay.classList.remove("hidden");
});

closeBtn.addEventListener("click", () => {
  overlay.classList.add("hidden");
});

overlay.addEventListener("click", () => {
  overlay.classList.add("hidden");
});

panel.addEventListener("click", (e) => {
  e.stopPropagation();
});

syncMobileSinglePaneLayout("initial-load");
if (typeof mobileLayoutMediaQuery.addEventListener === "function") {
  mobileLayoutMediaQuery.addEventListener("change", () =>
    syncMobileSinglePaneLayout("media-query-change")
  );
} else if (typeof mobileLayoutMediaQuery.addListener === "function") {
  mobileLayoutMediaQuery.addListener(() =>
    syncMobileSinglePaneLayout("media-query-change")
  );
}
window.addEventListener("resize", () => syncMobileSinglePaneLayout("resize"));
window.debugMobileLayout = () => {
  syncMobileSinglePaneLayout("debug-call");
  const viewportWidth = Math.min(
    window.innerWidth || Infinity,
    document.documentElement?.clientWidth || Infinity,
    window.visualViewport?.width || Infinity
  );
  const mediaQueryMobile = mobileLayoutMediaQuery.matches;
  const fallbackMobile = viewportWidth <= MOBILE_BREAKPOINT;
  return {
    mode: mediaQueryMobile || fallbackMobile ? "mobile" : "desktop",
    width: Math.round(viewportWidth),
    mediaQueryMobile,
    fallbackMobile,
    hasMobileClass: document.body.classList.contains("mobile-single-pane"),
    hasMergedPane: Boolean(document.getElementById("mobile-merged-pane")),
  };
};

/* ----------------------------------------------------------
   LOAD PAGE
---------------------------------------------------------- */
load();
