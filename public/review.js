/* ------------------------------------------------------------
   ⭐ LẤY TÊN FILE TEST TỪ URL (bây giờ là TÊN FOLDER, vd: "Test 1")
------------------------------------------------------------ */
const params = new URLSearchParams(window.location.search);
const file = params.get("file");
const bottomBarUserEl = document.getElementById("bottom-bar-user");

function formatTestName(testFile = "") {
  const cleaned = String(testFile || "").replace(
    /^(?:real_tests|practice_tests|starter|cramming|math|math_cramming)\//,
    ""
  );
  return cleaned || "SAT Test";
}

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
    bottomBarUserEl.textContent = "";
  }
}


if (!file) {
  alert("Missing file test");
  throw new Error("Missing file");
}

const timerTitleEl = document.getElementById("timer-title");
if (timerTitleEl) {
  timerTitleEl.textContent = formatTestName(file);
}

loadBottomBarUser();

const MOBILE_BREAKPOINT = 768;
const mobileLayoutMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
let mobileLayoutState = null;

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


/* ------------------------------------------------------------
   ⭐ BIẾN TOÀN CỤC
------------------------------------------------------------ */
let answers = {};
let reviewList = [];
let totalQuestions = 0;
let remainingTime = 0;
let highlights = {};

/* ------------------------------------------------------------
   ⭐ LOAD STATE + LOAD ĐỀ
------------------------------------------------------------ */
async function load() {
  // 1) Lấy state từ database
  const state = await fetch(`/api/test-state?file=${encodeURIComponent(file)}`)
    .then(r => r.json());

  if (state.hasData) {
    answers = state.answers || {};
    reviewList = state.reviewList || [];
    highlights = state.highlights || {};
    remainingTime = state.remainingTime || 0;
  }

  // 2) Lấy đề để biết tổng số câu (theo FOLDER test)
   const res = await fetch(`/api/parsed-test?file=${encodeURIComponent(file)}`);
  const data = await res.json();
  totalQuestions = data.questions.length;

  // 3) Build grid sau khi có đủ thông tin
  buildGrid();

  // 4) Start timer (nếu còn thời gian)
  startTimer();
}

/* ------------------------------------------------------------
   ⭐ BUILD GRID
------------------------------------------------------------ */
function buildGrid() {
  const grid = document.getElementById("review-grid");
  grid.innerHTML = "";

  for (let i = 0; i < totalQuestions; i++) {
    const div = document.createElement("div");
    div.className = "q-item";
    div.innerText = i + 1;

    const qid = i + 1; // id câu trong answers

    if (answers[qid]) div.classList.add("answered");
    if (reviewList.includes(i)) div.classList.add("marked");

    div.onclick = () => goToQuestion(i);

    grid.appendChild(div);
  }
}

/* ------------------------------------------------------------
   ⭐ TIMER
------------------------------------------------------------ */
function startTimer() {
  updateTimerUI(remainingTime);

  // Nếu không còn thời gian (0 hoặc âm) thì không chạy countdown nữa,
  // chỉ hiển thị để review thôi.
  if (remainingTime <= 0) return;

  const intervalId = setInterval(() => {
    remainingTime--;

    updateTimerUI(remainingTime);

    // hết giờ → sang score
    if (remainingTime <= 0) {
      clearInterval(intervalId);
      window.location.href = `score.html?file=${encodeURIComponent(file)}`;
      return;
    }

    // CHỈ LƯU LẠI remainingTime + trạng thái lên DB
    fetch("/api/test-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file,
        answers,
        reviewList,
        highlights,
        currentIndex: -1, // review page không thay đổi câu hiện tại
        remainingTime
      })
    });
  }, 1000);
}

function updateTimerUI(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  const display = `${min}:${sec < 10 ? "0" + sec : sec}`;

  const tm = document.getElementById("timer-value");
  if (tm) tm.textContent = display;
}

/* ------------------------------------------------------------
   ⭐ CLICK SỐ CÂU → VỀ test.html
------------------------------------------------------------ */
function goToQuestion(index) {
  window.location.href = `test.html?file=${encodeURIComponent(file)}&goto=${index}`;
}

/* ------------------------------------------------------------
   ⭐ BUTTON NEXT → sang score
------------------------------------------------------------ */
document.getElementById("next-btn").onclick = () => {
  window.location.href = `score.html?file=${encodeURIComponent(file)}`;
};

/* ------------------------------------------------------------
   ⭐ BUTTON BACK → về câu đang dở trong test.html
------------------------------------------------------------ */
document.getElementById("back-btn").onclick = async () => {
  const state = await fetch(`/api/test-state?file=${encodeURIComponent(file)}`)
    .then((r) => r.json());
  const idx = state.currentIndex ?? 0;
  window.location.href = `test.html?file=${encodeURIComponent(file)}&goto=${idx}`;
};

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


/* ------------------------------------------------------------
   ⭐ RUN
------------------------------------------------------------ */
load();
