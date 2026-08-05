/* ------------------------------------------------------------
   ⭐ CHẶN BACK: không được quay lại test/review
------------------------------------------------------------ */
history.pushState(null, "", window.location.href);
window.onpopstate = () => {
  window.location.href = "index.html";
};

/* ------------------------------------------------------------
   ⭐ LẤY TÊN FILE TEST
------------------------------------------------------------ */
const params = new URLSearchParams(window.location.search);
const file = params.get("file");
let latestAttemptId = null;

if (!file) {
  document.getElementById("score-box").innerText = "Error: missing test file.";
  throw new Error("Missing file param in URL");
}

let answers = {};
let questions = [];
let score = 0;

function getTestDurationSeconds(testFile = "") {
  const category = String(testFile || "").split("/").filter(Boolean)[0] || "";
  const isMathCategory = category === "math" || category === "math_cramming";
  return isMathCategory ? 35 * 60 : 32 * 60;
}

function buildHistoryAnswers(rawAnswers = {}, testFile = "", remainingTime = null) {
  const historyAnswers = { ...(rawAnswers || {}) };
  const totalTimeSeconds = getTestDurationSeconds(testFile);
  const parsedRemainingTime = Number(remainingTime);

  if (Number.isFinite(parsedRemainingTime) && parsedRemainingTime >= 0) {
    const normalizedRemaining = Math.max(0, Math.min(totalTimeSeconds, Math.floor(parsedRemainingTime)));
    const timeSpentSeconds = Math.max(0, totalTimeSeconds - normalizedRemaining);
    historyAnswers.__meta_total_time_seconds = totalTimeSeconds;
    historyAnswers.__meta_time_spent_seconds = timeSpentSeconds;
  }

  return historyAnswers;
}

function decodeQuestions(rawQuestions = []) {
  if (typeof window.decodeQuestionPayload === "function") {
    return window.decodeQuestionPayload(rawQuestions);
  }
  return rawQuestions;
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

/* ------------------------------------------------------------
   ⭐ LOAD + CHẤM ĐIỂM + LƯU LỊCH SỬ
------------------------------------------------------------ */
async function loadScore() {
  try {
    const state = await fetch(`/api/test-state?file=${file}`).then((r) => r.json());
    if (!state.hasData) {
      document.getElementById("score-box").innerText =
        "No saved progress found for this test.";
      return;
    }

    answers = state.answers || {};
    const historyAnswers = buildHistoryAnswers(answers, file, state.remainingTime);


    const data = await fetch(`/api/parsed-test?file=${encodeURIComponent(file)}`).then((r) => r.json());
    questions = decodeQuestions(data.questions);

    calculateScore();
    renderScore();

    const total = questions.length;

    // ⭐ Lưu lịch sử
    await fetch("/api/test-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, score, totalQuestions: total, answers: historyAnswers }),
      credentials: "same-origin",
    });

    // ⭐ Lấy attempt mới nhất
    const hx = await fetch(`/api/test-history?file=${file}`).then((r) => r.json());
    if (hx.history && hx.history.length > 0) {
      latestAttemptId = hx.history[0].id;
    }

    // ⭐ Reset state
    await fetch("/api/test-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file }),
      credentials: "same-origin",
    });

  } catch (err) {
    console.error("Error loading score:", err);
    document.getElementById("score-box").innerText = "Error loading score data.";
  }
}

/* ------------------------------------------------------------
   ⭐ CHẤM ĐIỂM
------------------------------------------------------------ */
function calculateScore() {
  score = 0;
  questions.forEach((q) => {
    if (isCorrectAnswer(q, answers[q.id])) {
      score++;
    }
  });
}

/* ------------------------------------------------------------
   ⭐ RENDER SCORE + MESSAGE
------------------------------------------------------------ */
function renderScore() {
  const total = questions.length;

  // ⭐ Message trên cùng
  const message = getMessage(score);
  document.getElementById("score-message").innerHTML = `
    <div style="font-size:20px; font-weight:600; color:#059669; margin-bottom:6px;">
      ${message}
    </div>
  `;

  // ⭐ Box điểm
  const box = document.getElementById("score-box");
  box.innerHTML = `
    <div style="font-size:26px; font-weight:700; margin-bottom:10px;">
      ${score} / ${total}
    </div>
    <div style="font-size:17px; color:#4b5563; margin-bottom:12px;">
      Bạn trả lời đúng <b>${score}</b> / <b>${total}</b> câu hỏi.
    </div>
  `;
}

/* ------------------------------------------------------------
   ⭐ MESSAGE THEO MỨC ĐIỂM
------------------------------------------------------------ */
function getMessage(score) {
  const total = questions.length;
  const percent = (score / total) * 100;
  if (percent >= 90) {
    return "Bạn đang Aura-farming đấy! Tiếp tục duy trì nhé.";
  }
  if (percent >= 80) {
    return "Bạn đích thực là một Sigma SAT";
  }
  if (percent >= 60) {
    return "Cố lên! Bạn sắp trở thành Sigma SAT rồi";
  }
  return "Beta quá! Bạn cần nỗ lực thêm";
}

/* ------------------------------------------------------------
   ⭐ NÚT TRANG CHỦ
------------------------------------------------------------ */
document.getElementById("back-home-btn").onclick = () => {
  window.location.href = "index.html";
};

/* ------------------------------------------------------------
   ⭐ NÚT XEM CHI TIẾT
------------------------------------------------------------ */
document.getElementById("detail-btn").onclick = () => {
  if (!latestAttemptId) {
    alert("Không tìm thấy lịch sử làm bài.");
    return;
  }

  window.location.href =
    "past_exam.html?attempt=" +
    latestAttemptId +
    "&file=" +
    encodeURIComponent(file);
};

/* ------------------------------------------------------------
   ⭐ RUN
------------------------------------------------------------ */
loadScore();
