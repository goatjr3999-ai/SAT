// Lấy param từ URL: past_exam.html?attempt=3&file=Test%202&q=0
const params = new URLSearchParams(window.location.search);
const attemptId = params.get("attempt");
let currentIndex = parseInt(params.get("q") || "0", 10);
const hasQParam = params.has("q");              // ✅ mới
const fileFromQuery = params.get("file"); // tên folder test nếu có

if (!attemptId) {
  console.error("[PAST] Missing attempt id in URL");
  const main = document.querySelector(".past-main");
  if (main) main.innerHTML = "<p>Missing attempt id.</p>";
  throw new Error("Missing attempt id");
}

let questions = [];
let answers = {};
let fileName = "";
let currentTestFile = "";
let aiRequestInFlight = false;
let currentAiContext = null;
let errorLogsByQuestion = {};
let errorLogSaveTimer = null;
let activeErrorLogKey = "";
const aiPanelBtn = document.getElementById("ai-panel-btn");
const aiPanelStatus = document.getElementById("ai-panel-status");
const aiPanelOutput = document.getElementById("ai-panel-output");

if (typeof window.loadCipherFont === "function") {
  window.loadCipherFont();
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

function normalizeAnswer(value) {
  return String(value || "").trim();
}

function isNumericAnswer(value) {
  return /^-?\d+(\.\d+)?$/.test(String(value || "").trim());
}

function isCorrectAnswer(question, answer) {
  if (!question) return false;
  const normalizedAnswer = normalizeAnswer(answer);
  const normalizedCorrect = normalizeAnswer(question.correct);

  if (!normalizedAnswer || !normalizedCorrect) return false;

  if (question.type === "grid") {
    if (isNumericAnswer(normalizedAnswer) && isNumericAnswer(normalizedCorrect)) {
      return Number(normalizedAnswer) === Number(normalizedCorrect);
    }
    return normalizedAnswer === normalizedCorrect;
  }

  return normalizedAnswer === normalizedCorrect;
}

function decodeCipherText(text = "") {
  if (typeof window.decodeProtectedText === "function") {
    return window.decodeProtectedText(text);
  }
  return String(text || "");
}

function normalizeQuestionText(rawText = "") {
  return String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
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
function splitQuestionAndPassage(rawText = "") {
  const normalized = normalizeQuestionText(rawText);
  const lines = normalized.split("\n");
  if (lines.length <= 1) {
    return { question: normalized, passage: "" };
  }
  return {
    question: lines[0] || "",
    passage: lines.slice(1).join("\n"),
  };
}

function getAttemptTotalMinutes(testFile = "") {
  const category = String(testFile || "").split("/").filter(Boolean)[0] || "";
  const isMathCategory = category === "math" || category === "math_cramming";
  return isMathCategory ? 35 : 32;
}



function getAttemptElapsedMinutes(savedAnswers = {}, totalMinutes = 0) {
  const totalSeconds = Number(savedAnswers?.__meta_total_time_seconds);
  const spentSeconds = Number(savedAnswers?.__meta_time_spent_seconds);

  if (Number.isFinite(totalSeconds) && Number.isFinite(spentSeconds) && totalSeconds > 0) {
    const normalizedSpent = Math.max(0, Math.min(totalSeconds, spentSeconds));
    const elapsedMinutes = Math.round(normalizedSpent / 60);
    return Math.max(0, Math.min(totalMinutes, elapsedMinutes));
  }

  return 0;
}

function getQuestionElapsedSeconds(answersMeta = {}, questionCount = 0, totalMinutes = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(totalMinutes || 0) * 60));
  const spentSecondsMeta = Number(answersMeta?.__meta_time_spent_seconds);
  const elapsedSeconds = Number.isFinite(spentSecondsMeta)
    ? Math.max(0, Math.min(totalSeconds, Math.floor(spentSecondsMeta)))
    : 0;
  const questionTimeMeta = answersMeta?.__meta_question_time_seconds;
  const normalizedQuestionTimes =
    questionTimeMeta && typeof questionTimeMeta === "object"
      ? Object.entries(questionTimeMeta)
          .map(([questionId, seconds]) => ({
            questionId: String(questionId),
            seconds: Math.max(0, Math.round(Number(seconds) || 0)),
          }))
          .filter((entry) => entry.seconds > 0)
      : [];

  if (normalizedQuestionTimes.length > 0) {
    const totalQuestionElapsedSeconds = normalizedQuestionTimes.reduce(
      (sum, entry) => sum + entry.seconds,
      0
    );
    const longestQuestion = normalizedQuestionTimes.reduce((currentMax, entry) => {
      if (!currentMax || entry.seconds > currentMax.seconds) {
        return entry;
      }
      return currentMax;
    }, null);

    const averagePerQuestionSeconds = Math.round(
      totalQuestionElapsedSeconds / normalizedQuestionTimes.length
    );

    return {
      elapsedSeconds,
      averagePerQuestionSeconds,
      longestQuestionId: longestQuestion?.questionId || null,
      longestQuestionSeconds: longestQuestion?.seconds || 0,
    };
  }

  const safeQuestionCount = Math.max(0, Number(questionCount) || 0);
  const averagePerQuestionSeconds = safeQuestionCount > 0
    ? Math.round(elapsedSeconds / safeQuestionCount)
    : 0;

  return {
    elapsedSeconds,
    averagePerQuestionSeconds,
    longestQuestionId: safeQuestionCount > 0 ? 1 : null,
    longestQuestionSeconds: averagePerQuestionSeconds,
  };
}

function formatSecondsAsMinutesSeconds(totalSeconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes} phút ${seconds.toString().padStart(2, "0")} giây`;
}

function formatScore(score, totalQuestions) {
  const safeScore = Number(score);
  const safeTotal = Number(totalQuestions);
  if (!Number.isFinite(safeScore) || !Number.isFinite(safeTotal) || safeTotal <= 0) {
    return "—";
  }
  return `${safeScore} / ${safeTotal}`;
}

function renderTimeStatsPanel({ answersMeta = {}, questionCount = 0, totalMinutes = 0, score = null, totalQuestions = 0, classStats = null } = {}) {
  const panelEl = document.getElementById("attempt-time-stats");
  if (!panelEl) return;

  const {
    averagePerQuestionSeconds,
    longestQuestionId,
    longestQuestionSeconds,
  } = getQuestionElapsedSeconds(answersMeta, questionCount, totalMinutes);

  const averageClassScoreText = classStats
    ? formatScore(Math.round(Number(classStats.avgScore || 0) * 100) / 100, totalQuestions)
    : "Không thuộc lớp";

  const topClassScoreText = classStats
    ? `${formatScore(classStats.maxScore, totalQuestions)}${classStats.topStudentUsername ? `` : ""}`
    : "Không thuộc lớp";

  panelEl.classList.remove("hidden");
  panelEl.innerHTML = `
    <h3 class="attempt-time-stats-title">Thống kê thời gian</h3>
    <ul class="attempt-time-stats-list">
      <li class="attempt-time-stats-line">
        <span>Thời gian trung bình mỗi câu:</span>
        <strong>${formatSecondsAsMinutesSeconds(averagePerQuestionSeconds)}</strong>
      </li>
      <li class="attempt-time-stats-line">
        <span>Câu làm lâu nhất:</span>
        <strong>${longestQuestionId ? `Câu ${longestQuestionId} – ${formatSecondsAsMinutesSeconds(longestQuestionSeconds)}` : "—"}</strong>
      </li>
      <li class="attempt-time-stats-line">
        <span>Điểm của bạn:</span>
        <strong>${formatScore(score, totalQuestions)}</strong>
      </li>
      <li class="attempt-time-stats-line">
        <span>Điểm trung bình của lớp:</span>
        <strong>${averageClassScoreText}</strong>
      </li>
      <li class="attempt-time-stats-line">
        <span>Điểm cao nhất của lớp:</span>
        <strong>${topClassScoreText}</strong>
      </li>
    </ul>
  `;
}

function extractQuestionTopic(rawText = "") {
  const lines = normalizeQuestionText(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return "";

  const topicLine = lines.find((line) => /^\[[^\]]+\]$/.test(line));
  if (!topicLine) return "";

  return topicLine.slice(1, -1).trim();
}

function removeTopicLine(rawText = "") {
  return normalizeQuestionText(rawText)
    .split("\n")
    .filter((line) => !/^\s*\[[^\]]+\]\s*$/.test(line))
    .join("\n");
}

function getCategoryLabelFromFile(testFile = "") {
  const category = String(testFile || "").split("/").filter(Boolean)[0] || "";
  const categoryLabels = {
    real_tests: "Đề thi thật",
    practice_tests: "Đề luyện",
    starter: "Starter",
    cramming: "Cramming",
    math: "Math",
    math_cramming: "Math Cramming",
  };

  return categoryLabels[category] || "Luyện tập";
}

function renderTopicBreakdown(questionsList = []) {
  const topicBreakdownEl = document.getElementById("attempt-topic-breakdown");
  if (!topicBreakdownEl) return;

  const topicStats = new Map();
  questionsList.forEach((q) => {
    const topic = extractQuestionTopic(getPlainQuestionText(q));
    if (!topic) return;

    if (!topicStats.has(topic)) {
      topicStats.set(topic, { correct: 0, total: 0 });
    }

    const stats = topicStats.get(topic);
    stats.total += 1;
    if (isCorrectAnswer(q, q.userAnswer)) {
      stats.correct += 1;
    }
  });

  if (!topicStats.size) {
    topicBreakdownEl.classList.add("hidden");
    topicBreakdownEl.innerHTML = "";
    return;
  }

  topicBreakdownEl.classList.remove("hidden");
  topicBreakdownEl.innerHTML = `
     <h3 class="attempt-time-stats-title">
      <span>Thống kê câu sai</span>
    </h3>
    <ul class="attempt-time-stats-list">
      ${Array.from(topicStats.entries())
        .map(
          ([topic, stats]) => `
            <li class="attempt-time-stats-line">
              <span>${topic}:</span>
              <strong>${stats.correct} / ${stats.total}</strong>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function extractQuestionStem(rawText = "") {
  const lines = normalizeQuestionText(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const contentLines = lines.filter((line) => !/^\[[^\]]+\]$/.test(line));
  const questionLine = contentLines.find((line) => line.includes("?")) || contentLines[contentLines.length - 1] || "";

  if (!questionLine) return "";

  const firstQuestionMarkIndex = questionLine.indexOf("?");
  if (firstQuestionMarkIndex === -1) return questionLine;

  return questionLine.slice(0, firstQuestionMarkIndex + 1).trim();
}

function setAiPanelStatus(message = "") {
  if (!aiPanelStatus) return;
  if (!message) {
    aiPanelStatus.textContent = "";
    aiPanelStatus.classList.add("hidden");
    return;
  }
  aiPanelStatus.textContent = message;
  aiPanelStatus.classList.remove("hidden");
}

function setAiPanelOutput(message = "") {
  if (!aiPanelOutput) return;
  if (!message) {
    aiPanelOutput.textContent = "";
    aiPanelOutput.classList.add("hidden");
    return;
  }
  aiPanelOutput.textContent = message;
  aiPanelOutput.classList.remove("hidden");
}

function updateAiPanel(question, context) {
  if (!aiPanelBtn || !question) return;

  if (!context?.testFile) {
    aiPanelBtn.disabled = true;
    aiPanelBtn.textContent = "Không có dữ liệu đề";
    setAiPanelStatus("Thiếu thông tin đề để gọi AI.");
    setAiPanelOutput("");
    return;
  }

  if (question.aiExplanation) {
    aiPanelBtn.disabled = true;
    aiPanelBtn.textContent = "Đã có giải thích";
    setAiPanelStatus("Đã lưu giải thích cho câu này.");
    setAiPanelOutput(question.aiExplanation);
    return;
  }

  aiPanelBtn.disabled = false;
  aiPanelBtn.textContent = "Giải thích";
  setAiPanelStatus("Nhấn để lấy giải thích bằng AI.");
  setAiPanelOutput("");
  currentAiContext = context;
}

async function requestAiExplanation() {
  if (!aiPanelBtn || aiRequestInFlight) return;
  const question = questions[currentIndex];
  if (!question) return;

  if (question.aiExplanation) {
    setAiPanelOutput(question.aiExplanation);
    setAiPanelStatus("Đã lưu giải thích cho câu này.");
    aiPanelBtn.disabled = true;
    aiPanelBtn.textContent = "Đã có giải thích";
    return;
  }

  const context = currentAiContext;
  if (!context) return;

  aiRequestInFlight = true;
  aiPanelBtn.disabled = true;
  aiPanelBtn.textContent = "Đang lấy...";
  setAiPanelStatus("Gigachad thường đưa ra giải thích trong < 45 giây ...");
  setAiPanelOutput("");

  try {
    const res = await fetch("/api/ai-explanation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    });

    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || "Không thể lấy giải thích.");
    }

    question.aiExplanation = data.explanation;
    setAiPanelOutput(data.explanation);
    setAiPanelStatus(
      data.cached
        ? "AI hiện tại đang là bản beta launched, nếu mọi người có feedback có thể inbox cho mình nhée."
        : "AI hiện tại đang là bản beta launched, nếu mọi người có feedback có thể inbox cho mình nhée."
    );
    aiPanelBtn.textContent = "Đã có giải thích";
  } catch (error) {
    console.error("AI explain error:", error);
    setAiPanelStatus("Không thể lấy giải thích. Vui lòng thử lại.");
    aiPanelBtn.disabled = false;
    aiPanelBtn.textContent = "Giải thích";
  } finally {
    aiRequestInFlight = false;
  }
}

if (aiPanelBtn) {
  aiPanelBtn.addEventListener("click", () => {
    requestAiExplanation();
  });
}

function typesetMath(elements = []) {
  const targets = elements.filter(Boolean);
  if (!targets.length) return;

  const runTypeset = () => {
    if (!window.MathJax) return;
    if (typeof window.MathJax.typesetPromise === "function") {
      window.MathJax.typesetPromise(targets);
    } else if (typeof window.MathJax.typeset === "function") {
      window.MathJax.typeset(targets);
    }
  };

  if (window.MathJax?.startup?.promise) {
    window.MathJax.startup.promise.then(runTypeset);
    return;
  }
  if (!window.MathJax) {
    window.__mathJaxQueue = window.__mathJaxQueue || [];
    window.__mathJaxQueue.push(targets);
    return;
  }

  runTypeset();
}

function getPlainQuestionText(question = {}) {
  return decodeCipherText(question.cipherQuestion || question.question || "");
}

function updateExplanationSection(question = {}) {
  const explanationSection = document.getElementById("ai-explain-section");
  const explanationOutput = document.getElementById("ai-explain-output");

  if (!explanationSection || !explanationOutput) return;

  const plainExplanation = decodeCipherText(question.explanation || "").trim();

  if (!plainExplanation) {
    explanationSection.classList.add("hidden");
    explanationOutput.textContent = "";
    explanationOutput.classList.add("hidden");
    return;
  }

  explanationSection.classList.remove("hidden");
  explanationOutput.textContent = plainExplanation;
  explanationOutput.classList.remove("hidden");
}

function getErrorLogElements() {
  return {
    input: document.getElementById("past-error-log"),
    status: document.getElementById("past-error-log-status"),
  };
}

function setErrorLogStatus(text = "", type = "") {
  const { status } = getErrorLogElements();
  if (!status) return;

  status.textContent = text;
  status.classList.remove("saving", "saved", "error");
  if (type) status.classList.add(type);
}

async function saveErrorLogForQuestion(question, text) {
  if (!question || isCorrectAnswer(question, question.userAnswer)) return;

  const requestKey = `${currentTestFile}::${question.id}`;

  try {
    setErrorLogStatus("Đang lưu...", "saving");

    const res = await fetch('/api/wrong-answers/error-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        testFile: currentTestFile,
        questionId: question.id,
        logText: text,
      }),
    });

    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || 'Không thể lưu Error Log');
    }

    errorLogsByQuestion[String(question.id)] = text;
    question.errorLog = text;
    if (activeErrorLogKey === requestKey) {
      setErrorLogStatus("Đã lưu", "saved");
    }
  } catch (err) {
    console.error('saveErrorLogForQuestion error:', err);
    setErrorLogStatus('Lưu thất bại, vui lòng thử lại.', 'error');
  }
}

function bindErrorLogInput(question) {
  const { input } = getErrorLogElements();
  if (!input) return;

  const isWrongOrOmitted = !isCorrectAnswer(question, question?.userAnswer);
  input.disabled = !isWrongOrOmitted;

  if (!isWrongOrOmitted) {
    input.value = "";
    input.placeholder = "Chỉ lưu Error Log cho câu sai hoặc bỏ trống.";
    input.oninput = null;
    setErrorLogStatus("Câu này đúng, không cần Error Log.", "saved");
    activeErrorLogKey = "";
    return;
  }

  input.placeholder = "Error Log: Ý chính của đoạn, giải thích đáp án, lí do sai, ...";
  const existingLog = question?.errorLog || errorLogsByQuestion[String(question?.id)] || "";
  input.value = existingLog;
  question.errorLog = existingLog;

  activeErrorLogKey = `${currentTestFile}::${question.id}`;
  setErrorLogStatus(existingLog ? "Đã đồng bộ Error Log." : "", existingLog ? "saved" : "");

  input.oninput = (event) => {
    const nextValue = event.target.value || "";
    question.errorLog = nextValue;
    errorLogsByQuestion[String(question.id)] = nextValue;

    if (errorLogSaveTimer) clearTimeout(errorLogSaveTimer);
    setErrorLogStatus('Đang chờ lưu...', 'saving');

    errorLogSaveTimer = setTimeout(() => {
      saveErrorLogForQuestion(question, nextValue);
    }, 450);
  };
}


// ================== LOAD DATA ==================
async function loadPastExam() {
  try {
    console.log("[PAST] Loading meta for attempt", attemptId);
    const metaRes = await fetch(
      `/api/review-detail/${encodeURIComponent(attemptId)}`,
      { credentials: "same-origin" }
    );

    let meta;
    try {
      meta = await metaRes.json();
    } catch (e) {
      console.error("[PAST] Cannot parse meta JSON:", e);
      const main = document.querySelector(".past-main");
      if (main) main.innerHTML = "<p>Error: cannot parse server response.</p>";
      return;
    }

    if (!metaRes.ok || meta.error) {
      console.error("[PAST] Meta error:", meta.error || metaRes.status);
      const main = document.querySelector(".past-main");
      if (main) main.innerHTML =
        `<p style="color:#b91c1c;">${meta.error || "Cannot load attempt meta."}</p>`;
      return;
    }

    fileName = meta.file;
    answers = meta.answers || {};
    errorLogsByQuestion = meta.errorLogs || {};

    const testFile = fileFromQuery || fileName;
    currentTestFile = testFile;

    if (!testFile) {
      const main = document.querySelector(".past-main");
      if (main) main.innerHTML = "<p>Missing test file for this attempt.</p>";
      return;
    }

    console.log("[PAST] Loading questions from", testFile);

    const testRes = await fetch(
     `/api/parsed-test?file=${encodeURIComponent(testFile)}&mode=review`,
      { credentials: "same-origin" }
    );

    const testData = await testRes.json();
    if (!testRes.ok || testData.error) {
      console.error("[PAST] parsed-test error:", testData.error || testRes.status);
      const main = document.querySelector(".past-main");
      if (main) main.innerHTML =
        `<p style="color:#b91c1c;">${testData.error || "Cannot load test data."}</p>`;
      return;
    }

    const cipherQuestions = normalizeCipherQuestions(testData.questions);

    questions = cipherQuestions.map((q) => ({
      ...q,
      userAnswer: answers[q.id] ?? null,
      errorLog: errorLogsByQuestion[String(q.id)] || "",
    }));

    if (!questions.length) {
      const main = document.querySelector(".past-main");
      if (main) main.innerHTML = "<p>No questions found for this attempt.</p>";
      return;
    }

    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= questions.length) currentIndex = questions.length - 1;

    // ===== TÍNH SỐ CÂU ĐÚNG =====
    let correctCount = 0;
    questions.forEach((q) => {
      if (q.userAnswer && q.userAnswer === q.correct) correctCount++;
    });

    // ===== ĐỔ DỮ LIỆU VÀO PANEL INFO (KHÔNG CÒN SCORE) =====
    const nameEl = document.getElementById("attempt-test-name");
    if (nameEl) {
      // Hiển thị tên test không kèm tiền tố thư mục (ví dụ: real_tests/ hoặc practice_tests/)
      const rawName = fileFromQuery || meta.file || "SAT Test";
      const displayName = String(rawName).split("/").filter(Boolean).pop() || "SAT Test";
      nameEl.textContent = displayName;
    }

    const categoryEl = document.getElementById("attempt-category");
    if (categoryEl) {
      const categoryText = getCategoryLabelFromFile(fileFromQuery || meta.file || "");
      categoryEl.innerHTML = `
        <span class="attempt-category-label">Mục:</span>
        <span class="attempt-category-value">${categoryText}</span>
      `;
    }

    const totalMinutes = getAttemptTotalMinutes(fileFromQuery || meta.file || "");
    const elapsedMinutes = getAttemptElapsedMinutes(answers, totalMinutes);
    const timeEl = document.getElementById("attempt-time");
    if (timeEl) {
      timeEl.innerHTML = `
        <span class="attempt-time-label">Thời gian làm bài:</span>
        <span class="attempt-time-value">${elapsedMinutes} phút / ${totalMinutes} phút</span>
      `;
    }

    const correctEl = document.getElementById("attempt-correct");
    if (correctEl) {
      correctEl.innerHTML = `
        <span class="meta-label">Số câu đúng:</span>
        <span class="meta-value">${correctCount} / ${questions.length}</span>
      `;
    }

    renderTimeStatsPanel({
      answersMeta: answers,
      questionCount: questions.length,
      totalMinutes,
      score: meta.score,
      totalQuestions: meta.totalQuestions || questions.length,
      classStats: meta.classStats || null,
    });


    renderTopicBreakdown(questions);

    // Thời gian đã bị loại khỏi giao diện (không hiển thị)

    // render bảng + popup
    renderQuestion();
    renderSummaryTable();

    if (hasQParam) {
      openOverlay();
    }

  } catch (err) {
    console.error("[PAST] loadPastExam error:", err);
    const main = document.querySelector(".past-main");
    if (main) {
      main.innerHTML =
        "<p style='color:#b91c1c;'>Error loading review data.</p>";
    }
  }
}



// ================== RENDER 1 CÂU ==================
function renderQuestion() {
  const q = questions[currentIndex];
  if (!q) return;
  const isGrid = q.type === "grid";
  const isAnswered = q.userAnswer !== null && String(q.userAnswer).trim() !== "";
  const isCorrect = isCorrectAnswer(q, q.userAnswer);

  // Tiêu đề + vị trí
  const titleEl = document.getElementById("past-title");
  const posEl = document.getElementById("position-text");
  if (titleEl) titleEl.textContent = `Review Question ${q.id}`;
  if (posEl) posEl.textContent = `Question ${q.id} of ${questions.length}`;

  // Nội dung câu hỏi
  const qEl = document.getElementById("question-text");
  const decodedQuestion = decodeCipherText(q.cipherQuestion || "");
  const displayQuestion = removeTopicLine(decodedQuestion);
  if (qEl) {
    renderPlainHtml(qEl, displayQuestion);
  }
  const { question: questionPrompt, passage } = splitQuestionAndPassage(decodedQuestion);

  const plainChoices = ["A", "B", "C", "D"].reduce((acc, opt) => {
    acc[opt] = decodeCipherText(q.cipherChoices?.[opt] || "");
    return acc;
  }, {});

  updateAiPanel(q, {
    testFile: currentTestFile,
    questionId: q.id,
    passage,
    question: questionPrompt,
    choices: plainChoices,
    correctAnswer: q.correct || "",
    questionType: q.type || "mcq",
  });


  // Ảnh
  const imgWrapper = document.getElementById("question-image-wrapper");
  const imgEl = document.getElementById("question-image");
  if (imgWrapper && imgEl) {
    if (q.image) {
      imgEl.src = q.image;
      imgEl.alt = `Question ${q.id} illustration`;
      imgWrapper.classList.remove("hidden");
    } else {
      imgEl.removeAttribute("src");
      imgWrapper.classList.add("hidden");
    }
  }

  // Đáp án
  const box = document.getElementById("choices");
  if (box) {
    box.innerHTML = "";
    if (isGrid) {
      const gridWrapper = document.createElement("div");
      gridWrapper.className = "grid-answer-display";
      gridWrapper.textContent = q.userAnswer || "—";
      if (!isAnswered) gridWrapper.classList.add("unanswered");
      box.appendChild(gridWrapper);
       const correctWrapper = document.createElement("div");
      correctWrapper.className = "grid-correct-display";
      renderPlainHtml(
        correctWrapper,
        `Correct answer: ${q.correct || "-"}`
      );
      box.appendChild(correctWrapper);
    } else {
      ["A", "B", "C", "D"].forEach((opt) => {
        const wrapper = document.createElement("div");
        wrapper.className = "choice";

        const label = document.createElement("div");
        label.className = "choice-label";
        label.textContent = opt;

        const text = document.createElement("div");
        text.className = "choice-text";
        renderPlainHtml(text, decodeCipherText(q.cipherChoices?.[opt] || ""));

        wrapper.appendChild(label);
        wrapper.appendChild(text);

        if (!isAnswered) wrapper.classList.add("unanswered");

        if (q.correct === opt && q.userAnswer === opt) {
          wrapper.classList.add("correct-user");
        } else if (q.correct === opt) {
          wrapper.classList.add("correct");
        } else if (q.userAnswer === opt) {
          wrapper.classList.add("wrong-user");
        }

        box.appendChild(wrapper);
      });
    }
  }

  // Tóm tắt
  const summary = document.getElementById("summary-text");
  if (summary) {
    if (!isAnswered) {
       summary.textContent = `You did not answer this question. Correct answer: ${
        q.correct || "-"
      }.`;
    } else if (isCorrect) {
      summary.textContent = "You answered this question correctly.";
    } else {
      summary.textContent = `Correct answer: ${q.correct}. Your answer: ${q.userAnswer}.`;
    }
  }
  typesetMath([qEl, box, summary]);
  updateExplanationSection(q);
  bindErrorLogInput(q);
  renderNavigator();
}

// ================== BẢNG 4 CỘT ==================
// ================== BẢNG 4 CỘT ==================
// ================== BẢNG 4 CỘT ==================
// ================== BẢNG 4 CỘT ==================
function renderSummaryTable() {
  const tbody = document.getElementById("summary-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  questions.forEach((q, index) => {
    const tr = document.createElement("tr");
    const isAnswered = q.userAnswer !== null && String(q.userAnswer).trim() !== "";
    // No
    const tdNo = document.createElement("td");
    tdNo.textContent = q.id;
    tr.appendChild(tdNo);

    // Question
    const tdQ = document.createElement("td");
    tdQ.className = "summary-question-text";

    const fullQuestion = getPlainQuestionText(q);
    tdQ.textContent = extractQuestionStem(fullQuestion);
    tr.appendChild(tdQ);

    // Topic
    const tdTopic = document.createElement("td");
    const topic = extractQuestionTopic(fullQuestion);
    tdTopic.textContent = topic || "—";
    tdTopic.className = topic ? "summary-topic-text" : "summary-topic-text topic-empty";
    tr.appendChild(tdTopic);

    // Status
    const tdStatus = document.createElement("td");
    let statusText = "";
    if (!isAnswered) {
      statusText = "Omitted";
      tdStatus.classList.add("status-omitted");
    } else if (isCorrectAnswer(q, q.userAnswer)) {
      statusText = "Correct";
      tdStatus.classList.add("status-correct");
    } else {
      statusText = "Incorrect";
      tdStatus.classList.add("status-incorrect");
    }
    tdStatus.textContent = statusText;
    tr.appendChild(tdStatus);

    // Action button
    const tdAction = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Review";
    btn.className = "summary-review-btn";
    btn.onclick = () => {
      currentIndex = index;
      renderQuestion();
      updateUrlQuery();
      openOverlay();
    };
    tdAction.appendChild(btn);
    tr.appendChild(tdAction);

    tbody.appendChild(tr);
  });
}




// ================== NAVIGATOR BÊN PHẢI ==================
function renderNavigator() {
  const nav = document.getElementById("navigator");
  if (!nav) return;

  nav.innerHTML = "";

  questions.forEach((q, index) => {
    const div = document.createElement("div");
    div.className = "nav-item";
    div.textContent = q.id;

    if (!q.userAnswer) {
      div.classList.add("unanswered");
    } else if (q.userAnswer === q.correct) {
      div.classList.add("correct");
    } else {
      div.classList.add("wrong");
    }

    if (index === currentIndex) {
      div.classList.add("current");
    }

    div.onclick = () => {
      currentIndex = index;
      renderQuestion();
      updateUrlQuery();
    };

    nav.appendChild(div);
  });
}


// ================== NAVIGATION PREV/NEXT ==================
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");

if (prevBtn) {
  prevBtn.onclick = () => {
    if (currentIndex > 0) {
      currentIndex--;
      renderQuestion();
      updateUrlQuery();
    }
  };
}

if (nextBtn) {
  nextBtn.onclick = () => {
    if (currentIndex < questions.length - 1) {
      currentIndex++;
      renderQuestion();
      updateUrlQuery();
    }
  };
}

function navigateWithWrap(step) {
  if (!questions.length) return;
  const total = questions.length;
  currentIndex = (currentIndex + step + total) % total;
  renderQuestion();
  updateUrlQuery();
}

// ================== OVERLAY OPEN/CLOSE ==================
const overlayEl = document.getElementById("review-overlay");
const closeOverlayBtn = document.getElementById("close-overlay");

function openOverlay() {
  if (overlayEl) overlayEl.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeOverlay() {
  if (overlayEl) overlayEl.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

// ❗ Thêm tính năng click ra ngoài để đóng panel:
overlayEl.addEventListener("click", (e) => {
  if (e.target === overlayEl) {
    closeOverlay();
  }
});

if (closeOverlayBtn) {
  closeOverlayBtn.onclick = closeOverlay;
}

function isOverlayOpen() {
  return overlayEl && !overlayEl.classList.contains("hidden");
}

function handleArrowNavigation(event) {
  if (!isOverlayOpen()) return;
  if (event.key === "ArrowRight") {
    navigateWithWrap(1);
    event.preventDefault();
  } else if (event.key === "ArrowLeft") {
    navigateWithWrap(-1);
    event.preventDefault();
  }
}

document.addEventListener("keydown", handleArrowNavigation);

// ================== UPDATE URL ==================
function updateUrlQuery() {
  const url = new URL(window.location.href);
  url.searchParams.set("attempt", attemptId);
  url.searchParams.set("q", currentIndex.toString());
  if (fileFromQuery) url.searchParams.set("file", fileFromQuery);
  window.history.replaceState({}, "", url.toString());
}

// ================== RUN ==================
loadPastExam();
