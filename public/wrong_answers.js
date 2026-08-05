const wrongContainer = document.getElementById("wrong-tests-container");
const overlay = document.getElementById("wrong-overlay");
const paginationInfo = document.getElementById("wrong-page-info");
const prevPageBtn = document.getElementById("wrong-prev");
const nextPageBtn = document.getElementById("wrong-next");
const aiPanelBtn = document.getElementById("ai-panel-btn");
const aiPanelStatus = document.getElementById("ai-panel-status");
const aiPanelOutput = document.getElementById("ai-panel-output");
const wrongPracticeBtn = document.getElementById("wrong-practice-btn");

let testsData = [];
let currentTestIndex = 0;
let currentQuestionIndex = 0;
let currentPage = 1;
let totalPages = 1;
let errorLogSaveTimer = null;
let activeErrorLogKey = "";
let aiRequestInFlight = false;
let currentAiContext = null;

if (typeof window.loadCipherFont === "function") {
  window.loadCipherFont();
}

function encodePlainText(text = "") {
  if (typeof window.encodeText === "function") {
    return window.encodeText(text);
  }
  return String(text || "");
}

function decodeCipherText(text = "") {
  if (typeof window.decodeProtectedText === "function") {
    return window.decodeProtectedText(text);
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

function getTestName(testFile = "") {
  const parts = testFile.split("/");
  return parts[parts.length - 1] || testFile;
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

function splitQuestionAndPassage(fullText = "") {
  const lines = removeTopicLine(fullText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { question: "", passage: "" };
  }

  let questionLineIndex = lines.findIndex((line) => line.includes("?"));
  if (questionLineIndex === -1) {
    questionLineIndex = lines.length - 1;
  }

  return {
    question: lines[questionLineIndex] || "",
    passage: lines
      .filter((_, idx) => idx !== questionLineIndex)
      .join("\n"),
  };
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
    currentAiContext = null;
    return;
  }

  if (question.aiExplanation) {
    aiPanelBtn.disabled = true;
    aiPanelBtn.textContent = "Đã có giải thích";
    setAiPanelStatus("Đã lưu giải thích cho câu này.");
    setAiPanelOutput(question.aiExplanation);
    currentAiContext = context;
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

  const test = testsData[currentTestIndex];
  const question = test?.wrongQuestions?.[currentQuestionIndex];
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
      "AI hiện tại đang là bản beta launched, nếu mọi người có feedback có thể inbox cho mình nhée."
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

async function loadWrongTests(page = 1) {
  if (wrongContainer) wrongContainer.textContent = "Đang tải...";

  try {
    const res = await fetch(`/api/wrong-answers?page=${page}`, {
      credentials: "same-origin",
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || "Không tải được dữ liệu");
    }

    const rawTests = data.tests || [];
    testsData = rawTests.map((test) => ({
      ...test,
      wrongQuestions: (test.wrongQuestions || []).map((q) => {
        const encodedQuestion = encodePlainText(q.question || "");
        const encodedChoices = {
          A: encodePlainText(q.choices?.A || ""),
          B: encodePlainText(q.choices?.B || ""),
          C: encodePlainText(q.choices?.C || ""),
          D: encodePlainText(q.choices?.D || ""),
        };

        return {
          ...q,
          question: encodedQuestion,
          choices: encodedChoices,
          cipherQuestion: encodedQuestion,
          cipherChoices: encodedChoices,
        };
      }),
    }));
    currentPage = data.page || 1;
    totalPages = data.totalPages || 1;

    renderTests(data.totalTests || 0);
    updatePagination();
  } catch (err) {
    console.error("loadWrongTests error:", err);
    if (wrongContainer)
      wrongContainer.innerHTML = `<div class="wrong-empty">${err.message || "Không tải được dữ liệu."}</div>`;
  }
}

function renderTests(totalTests) {
  if (!wrongContainer) return;

  if (!testsData.length) {
    wrongContainer.innerHTML =
      '<div class="wrong-empty">Chưa có câu trả lời sai nào. Hãy làm thêm bài test để xem thống kê nhé!</div>';
    return;
  }

  wrongContainer.innerHTML = "";

  testsData.forEach((test, index) => {
    const card = document.createElement("div");
    card.className = "wrong-card";

    const header = document.createElement("div");
    header.className = "wrong-card-header";

    const titleWrapper = document.createElement("div");
    titleWrapper.className = "wrong-card-title";
    titleWrapper.textContent = getTestName(test.testFile);

    const meta = document.createElement("div");
    meta.className = "wrong-card-meta";
    meta.textContent = `${test.wrongQuestions.length} câu sai`;

    const count = document.createElement("div");
    count.className = "wrong-count";
    count.textContent = `${test.wrongQuestions.length} câu`;

    

    header.appendChild(titleWrapper);
    header.appendChild(meta);
    header.appendChild(count);

    const body = document.createElement("div");
    body.className = "wrong-card-body hidden";

    const list = document.createElement("div");
    list.className = "wrong-question-list";

    test.wrongQuestions.forEach((q, qIndex) => {
      const row = document.createElement("div");
      row.className = "wrong-question-row";

      const info = document.createElement("div");
      info.className = "wrong-question-info";

      const label = document.createElement("div");
      label.className = "wrong-question-label";
      label.textContent = `Question ${q.id}`;

      const answers = document.createElement("div");
      answers.className = "wrong-question-answers";
      answers.textContent = `Đáp án đúng: ${q.correct} • Bạn chọn: ${q.userAnswer || "-"}`;

      info.appendChild(label);
      info.appendChild(answers);

      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "summary-review-btn";
      viewBtn.textContent = "Review";
      viewBtn.addEventListener("click", () => openOverlay(index, qIndex));

      row.appendChild(info);
      row.appendChild(viewBtn);
      list.appendChild(row);
    });

    body.appendChild(list);

    const toggleBody = () => {
      const isHidden = body.classList.contains("hidden");
      body.classList.toggle("hidden", !isHidden);
    };
    header.addEventListener("click", () => toggleBody());

    card.appendChild(header);
    card.appendChild(body);

    wrongContainer.appendChild(card);
  });
}

function updatePagination() {
  if (paginationInfo) {
    paginationInfo.textContent = `Trang ${currentPage}/${totalPages || 1}`;
  }

  if (prevPageBtn) {
    prevPageBtn.disabled = currentPage <= 1;
  }

  if (nextPageBtn) {
    nextPageBtn.disabled = currentPage >= totalPages;
  }
}

function getErrorLogElements() {
  return {
    input: document.getElementById("wrong-error-log"),
    status: document.getElementById("wrong-error-log-status"),
  };
}

function setErrorLogStatus(text = "", type = "") {
  const { status } = getErrorLogElements();
  if (!status) return;
  status.textContent = text;
  status.classList.remove("saving", "saved", "error");
  if (type) status.classList.add(type);
}

async function saveErrorLogForCurrentQuestion(text) {
  const test = testsData[currentTestIndex];
  const question = test?.wrongQuestions?.[currentQuestionIndex];
  if (!test || !question) return;

  const requestKey = `${test.testFile}::${question.id}`;

  try {
    setErrorLogStatus("Đang lưu...", "saving");

    const res = await fetch('/api/wrong-answers/error-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        testFile: test.testFile,
        questionId: question.id,
        logText: text,
      }),
    });

    const data = await res.json();
    if (!res.ok || data?.error) {
      throw new Error(data?.error || 'Không thể lưu Error Log');
    }

    question.errorLog = text;
    if (activeErrorLogKey === requestKey) {
      setErrorLogStatus("Đã lưu", "saved");
    }
  } catch (err) {
    console.error('saveErrorLogForCurrentQuestion error:', err);
    setErrorLogStatus('Lưu thất bại, vui lòng thử lại.', 'error');
  }
}

function bindErrorLogInput(question) {
  const { input } = getErrorLogElements();
  if (!input) return;

  input.value = question?.errorLog || "";

  input.oninput = (event) => {
    const nextValue = event.target.value || "";
    if (question) question.errorLog = nextValue;

    if (errorLogSaveTimer) clearTimeout(errorLogSaveTimer);
    setErrorLogStatus('Đang chờ lưu...', 'saving');

    errorLogSaveTimer = setTimeout(() => {
      saveErrorLogForCurrentQuestion(nextValue);
    }, 450);
  };
}

function openOverlay(testIndex, questionIndex) {
  currentTestIndex = testIndex;
  currentQuestionIndex = questionIndex;

  renderOverlay();

  overlay?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeOverlay() {
  overlay?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  activeErrorLogKey = "";
  if (errorLogSaveTimer) clearTimeout(errorLogSaveTimer);
  errorLogSaveTimer = null;
  const { input } = getErrorLogElements();
  if (input) input.oninput = null;
  setErrorLogStatus("");
}

function renderOverlay() {
  const test = testsData[currentTestIndex];
  const question = test?.wrongQuestions?.[currentQuestionIndex];

  if (!test || !question) {
    closeOverlay();
    return;
  }

  activeErrorLogKey = `${test.testFile}::${question.id}`;

  const titleEl = document.getElementById("wrong-title");
  const metaEl = document.getElementById("wrong-meta");
  const positionEl = document.getElementById("wrong-position");
  const questionEl = document.getElementById("wrong-question");
  const choicesEl = document.getElementById("wrong-choices");
  const summaryEl = document.getElementById("wrong-summary");
  const imgWrapper = document.getElementById("wrong-image-wrapper");
  const imgEl = document.getElementById("wrong-image");

  if (titleEl) titleEl.textContent = `Question ${question.id} – ${getTestName(test.testFile)}`;
  const decodedQuestion = decodeCipherText(
    question.cipherQuestion || question.question || ""
  );
  const displayQuestion = removeTopicLine(decodedQuestion);
  const { question: questionPrompt, passage } = splitQuestionAndPassage(decodedQuestion);
  if (questionEl) renderPlainHtml(questionEl, displayQuestion);

  const plainChoices = ["A", "B", "C", "D"].reduce((acc, opt) => {
    acc[opt] = decodeCipherText(
      question.cipherChoices?.[opt] || question.choices?.[opt] || ""
    );
    return acc;
  }, {});

  updateAiPanel(question, {
    testFile: test.testFile,
    questionId: question.id,
    passage,
    question: questionPrompt,
    choices: plainChoices,
    correctAnswer: question.correct || "",
    questionType: question.type || "mcq",
  });

  if (choicesEl) {
    choicesEl.innerHTML = "";
      if (question.type === "grid") {
      const gridWrapper = document.createElement("div");
      gridWrapper.className = "grid-answer-display";
      gridWrapper.textContent = question.userAnswer || "—";
      if (!question.userAnswer || String(question.userAnswer).trim() === "") {
        gridWrapper.classList.add("unanswered");
      }
choicesEl.appendChild(gridWrapper);

      const correctWrapper = document.createElement("div");
      correctWrapper.className = "grid-correct-display";
      renderPlainHtml(
        correctWrapper,
        `Đáp án đúng: ${question.correct || "-"}`
      );
      choicesEl.appendChild(correctWrapper);
    } else {
      ["A", "B", "C", "D"].forEach((opt) => {
        const wrapper = document.createElement("div");
        wrapper.className = "choice";

        const label = document.createElement("div");
        label.className = "choice-label";
        label.textContent = opt;

        const text = document.createElement("div");
        text.className = "choice-text";
        const decodedChoice = decodeCipherText(
          question.cipherChoices?.[opt] || question.choices?.[opt] || ""
        );
        renderPlainHtml(text, decodedChoice);


        wrapper.appendChild(label);
        wrapper.appendChild(text);

        if (question.correct === opt && question.userAnswer === opt) {
          wrapper.classList.add("correct-user");
        } else if (question.correct === opt) {
          wrapper.classList.add("correct");
        } else if (question.userAnswer === opt) {
          wrapper.classList.add("wrong-user");
        }

        choicesEl.appendChild(wrapper);
      });
    } 
  }

  if (summaryEl) {
    summaryEl.textContent = `Đáp án đúng: ${question.correct}. Bạn chọn: ${
      question.userAnswer || "-"
    }.`;
  }

  if (question.image && imgWrapper && imgEl) {
    imgWrapper.classList.remove("hidden");
    imgEl.src = question.image;
    imgEl.alt = `Ảnh câu hỏi ${question.id}`;
  } else if (imgWrapper && imgEl) {
    imgWrapper.classList.add("hidden");
    imgEl.removeAttribute("src");
  }

  const prevBtn = document.getElementById("wrong-prev-btn");
  const nextBtn = document.getElementById("wrong-next-btn");

  bindErrorLogInput(question);
  setErrorLogStatus(question.errorLog ? "Đã lưu" : "", question.errorLog ? "saved" : "");


  if (prevBtn) prevBtn.disabled = currentQuestionIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentQuestionIndex >= test.wrongQuestions.length - 1;

  typesetMath([questionEl, choicesEl, summaryEl]);
}

function gotoQuestion(delta) {
  const test = testsData[currentTestIndex];
  if (!test) return;

  const nextIndex = currentQuestionIndex + delta;
  if (nextIndex < 0 || nextIndex >= test.wrongQuestions.length) return;

  currentQuestionIndex = nextIndex;
  renderOverlay();
}

if (prevPageBtn) {
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      loadWrongTests(currentPage - 1);
    }
  });
}

if (nextPageBtn) {
  nextPageBtn.addEventListener("click", () => {
    if (currentPage < totalPages) {
      loadWrongTests(currentPage + 1);
    }
  });
}


function startWrongPractice() {
  if (!testsData.length) return;

  const firstAvailableTestIndex = testsData.findIndex(
    (test) => Array.isArray(test.wrongQuestions) && test.wrongQuestions.length > 0
  );

  if (firstAvailableTestIndex < 0) return;

  currentTestIndex = firstAvailableTestIndex;
  currentQuestionIndex = 0;
  showQuestionOverlay(currentTestIndex, currentQuestionIndex);
}

const closeBtn = document.getElementById("wrong-close");
if (closeBtn) closeBtn.addEventListener("click", closeOverlay);

const overlayPrev = document.getElementById("wrong-prev-btn");
const overlayNext = document.getElementById("wrong-next-btn");
if (overlayPrev) overlayPrev.addEventListener("click", () => gotoQuestion(-1));
if (overlayNext) overlayNext.addEventListener("click", () => gotoQuestion(1));

if (overlay) {
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeOverlay();
  });
}

loadWrongTests();

if (aiPanelBtn) {
  aiPanelBtn.addEventListener("click", () => {
    requestAiExplanation();
  });
}

if (wrongPracticeBtn) {
  wrongPracticeBtn.addEventListener("click", startWrongPractice);
}