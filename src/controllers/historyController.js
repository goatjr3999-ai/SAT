// src/controllers/historyController.js
const db = require("../utils/db");
const { getVNTime } = require("../utils/time");
const { parseTestFile } = require("../utils/testParser");

function normalizeAnswer(value) {
  return String(value ?? "").trim();
}

function isNumericAnswer(value) {
  return /^-?\d+(\.\d+)?$/.test(String(value ?? "").trim());
}

function isCorrectAnswer(question, rawAnswer) {
  const normalizedAnswer = normalizeAnswer(rawAnswer);
  const normalizedCorrect = normalizeAnswer(question?.correct);

  if (!normalizedAnswer || !normalizedCorrect) return false;

  if (question?.type === "grid") {
    if (isNumericAnswer(normalizedAnswer) && isNumericAnswer(normalizedCorrect)) {
      return Number(normalizedAnswer) === Number(normalizedCorrect);
    }
    return normalizedAnswer === normalizedCorrect;
  }

  return normalizedAnswer === normalizedCorrect;
}

// POST /api/test-history
async function saveTestHistory(req, res) {
  const userId = req.session.userId;
  const { file, score, totalQuestions, answers } = req.body;

  const answers_json = JSON.stringify(answers || {});

  try {
    // INSERT + RETURNING id
    const insertResult = await db.query(
      `
      INSERT INTO test_history (user_id, test_file, score, total_questions, answers_json, taken_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
      [userId, file, score, totalQuestions, answers_json, getVNTime()]
    );

    const insertedId = insertResult.rows[0].id;

    // Ghi heatmap
    const today = getVNTime().split(" ")[0]; // YYYY-MM-DD

    // Mỗi lần nộp bài tính là 1 lần luyện tập trong heatmap
    const solvedCount = 1;

    await db.query(
      `
      INSERT INTO user_activity (user_id, date, problems_solved)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, date)
      DO UPDATE SET
        problems_solved = user_activity.problems_solved + EXCLUDED.problems_solved
    `,
     [userId, today, solvedCount]
    );

    await db.query(
      `DELETE FROM study_plan_tasks WHERE user_id = $1 AND test_file = $2`,
      [userId, file]
    );
    
    res.json({ ok: true, id: insertedId });
  } catch (err) {
    console.error("INSERT test_history error:", err);
    return res
      .status(500)
      .json({ error: "Lưu lịch sử thất bại", detail: err.message });
  }
}

// GET /api/test-history
async function getTestHistory(req, res) {
  const userId = req.session.userId;
  const file = req.query.file;

  try {
    const result = await db.query(
      `
      SELECT id, score, total_questions, taken_at
      FROM test_history
      WHERE user_id = $1 AND test_file = $2
      ORDER BY taken_at DESC
      LIMIT 50
    `,
      [userId, file]
    );

    res.json({ history: result.rows });
  } catch (err) {
    console.error("getTestHistory error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// GET /api/review-detail/:attemptId
async function getReviewDetail(req, res) {
  const userId = req.session.userId;
  const attemptId = req.params.attemptId;

  try {
    const result = await db.query(
      `
      SELECT id, test_file, answers_json, score, total_questions, taken_at
      FROM test_history
      WHERE id = $1 AND user_id = $2
    `,
      [attemptId, userId]
    );

    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "Attempt not found" });

    const errorLogsResult = await db.query(
      `
      SELECT question_id, log_text
      FROM wrong_answer_error_logs
      WHERE user_id = $1 AND test_file = $2
    `,
      [userId, row.test_file]
    );

    const errorLogs = {};
    errorLogsResult.rows.forEach((logRow) => {
      errorLogs[String(logRow.question_id)] = logRow.log_text || "";
    });

    const classResult = await db.query(
      `SELECT class_id FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    let classStats = null;
    const classId = classResult.rows[0]?.class_id || null;

    if (classId) {
      const classNameResult = await db.query(
        `SELECT name FROM classes WHERE id = $1 LIMIT 1`,
        [classId]
      );

      const scoreStatsResult = await db.query(
        `
        SELECT
          AVG(th.score)::float AS avg_score,
          MAX(th.score) AS max_score,
          COUNT(*)::int AS attempts_count
        FROM test_history th
        INNER JOIN users u ON u.id = th.user_id
        WHERE u.class_id = $1
          AND u.is_admin = 0
          AND th.test_file = $2
      `,
        [classId, row.test_file]
      );

      const topAttemptResult = await db.query(
        `
        SELECT th.score, u.username
        FROM test_history th
        INNER JOIN users u ON u.id = th.user_id
        WHERE u.class_id = $1
          AND u.is_admin = 0
          AND th.test_file = $2
        ORDER BY th.score DESC, th.taken_at ASC
        LIMIT 1
      `,
        [classId, row.test_file]
      );

      classStats = {
        classId,
        className: classNameResult.rows[0]?.name || null,
        avgScore: Number(scoreStatsResult.rows[0]?.avg_score || 0),
        maxScore: Number(scoreStatsResult.rows[0]?.max_score || 0),
        attemptsCount: Number(scoreStatsResult.rows[0]?.attempts_count || 0),
        topStudentUsername: topAttemptResult.rows[0]?.username || null,
      };
    }

    res.json({
      file: row.test_file,
      answers: JSON.parse(row.answers_json),
      score: row.score,
      totalQuestions: row.total_questions,
      taken_at: row.taken_at,
      errorLogs,
      classStats,
    });
  } catch (err) {
    console.error("getReviewDetail error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// GET /api/test-state
async function getTestState(req, res) {
  const file = req.query.file;
  const userId = req.session.userId;

  try {
    const result = await db.query(
      `SELECT * FROM test_progress WHERE user_id = $1 AND test_file = $2`,
      [userId, file]
    );
    const row = result.rows[0];

    if (!row) {
      return res.json({
        hasData: false,
        answers: {},
        reviewList: [],
        highlights: {},
        eliminatedChoices: {},
        currentIndex: 0,
        remainingTime: null,
      });
    }

    res.json({
      hasData: true,
      answers: JSON.parse(row.answers || "{}"),
      reviewList: JSON.parse(row.review_list || "[]"),
      highlights: JSON.parse(row.highlights || "{}"),
      eliminatedChoices: JSON.parse(row.eliminated_choices || "{}"),
      currentIndex: row.current_index || 0,
      remainingTime: row.remaining_time || null,
    });
  } catch (err) {
    console.error("getTestState error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// POST /api/test-state
async function saveTestState(req, res) {
  const userId = req.session.userId;
  const {
    file,
    answers,
    eliminatedChoices,
    reviewList,
    highlights,
    currentIndex,
    remainingTime,
  } = req.body;

  try {
    await db.query(
      `
      INSERT INTO test_progress (user_id, test_file, answers, review_list, highlights, eliminated_choices, current_index, remaining_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, test_file) DO UPDATE SET
        answers = EXCLUDED.answers,
        review_list = EXCLUDED.review_list,
        highlights = EXCLUDED.highlights,
        eliminated_choices = EXCLUDED.eliminated_choices,
        current_index = EXCLUDED.current_index,
        remaining_time = EXCLUDED.remaining_time,
        updated_at = CURRENT_TIMESTAMP
    `,
      [
        userId,
        file,
        JSON.stringify(answers),
        JSON.stringify(reviewList),
        JSON.stringify(highlights || {}),
        JSON.stringify(eliminatedChoices || {}),
        currentIndex,
        remainingTime,
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("saveTestState error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// GET /api/test-completed
async function checkTestCompleted(req, res) {
  const userId = req.session.userId;
  const file = req.query.file;

  try {
    const result = await db.query(
      `
      SELECT score, total_questions
      FROM test_history
      WHERE user_id = $1 AND test_file = $2
      ORDER BY taken_at DESC
      LIMIT 1
    `,
      [userId, file]
    );

    const row = result.rows[0];
    res.json({
      completed: !!row,
      lastScore: row ? Number(row.score) : null,
      lastTotal: row ? Number(row.total_questions) : null,
    });
  } catch (err) {
    console.error("checkTestCompleted error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// POST /api/test-statuses
async function getTestStatuses(req, res) {
  const userId = req.session.userId;
  const files = Array.isArray(req.body?.files) ? req.body.files : [];

  const normalizedFiles = Array.from(
    new Set(
      files
        .map((file) => String(file || "").trim())
        .filter(Boolean)
    )
  );

  if (normalizedFiles.length === 0) {
    return res.json({ statuses: {} });
  }

  try {
    const progressResult = await db.query(
      `
      SELECT test_file
      FROM test_progress
      WHERE user_id = $1 AND test_file = ANY($2::text[])
    `,
      [userId, normalizedFiles]
    );

    const completedResult = await db.query(
      `
      SELECT DISTINCT ON (test_file) test_file, score, total_questions
      FROM test_history
      WHERE user_id = $1 AND test_file = ANY($2::text[])
      ORDER BY test_file, id DESC
    `,
      [userId, normalizedFiles]
    );

    const inProgressSet = new Set(progressResult.rows.map((row) => row.test_file));
    const completedMap = new Map(
      completedResult.rows.map((row) => [
        row.test_file,
        {
          completed: true,
          lastScore: Number(row.score),
          lastTotal: Number(row.total_questions),
        },
      ])
    );

    const statuses = {};
    normalizedFiles.forEach((file) => {
      const completed = completedMap.get(file);
      statuses[file] = {
        inProgress: inProgressSet.has(file),
        completed: !!completed,
        lastScore: completed?.lastScore ?? null,
        lastTotal: completed?.lastTotal ?? null,
      };
    });

    return res.json({ statuses });
  } catch (err) {
    console.error("getTestStatuses error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// POST /api/test-reset
async function resetTest(req, res) {
  const userId = req.session.userId;
  const { file } = req.body;

  try {
    await db.query(
      `DELETE FROM test_progress WHERE user_id = $1 AND test_file = $2`,
      [userId, file]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("resetTest error:", err);
    return res
      .status(500)
      .json({ error: "Lỗi server khi reset test" });
  }
}

// GET /api/heatmap
async function getHeatmap(req, res) {
  const userId = req.session.userId;

  res.set("Cache-Control", "no-store");

  try {
    const result = await db.query(
      `
      SELECT date, problems_solved
      FROM user_activity
      WHERE user_id = $1
      ORDER BY date ASC
    `,
      [userId]
    );

    const activity = result.rows.map((row) => {
      const dateObj = row.date instanceof Date ? row.date : new Date(row.date);
      const dateStr = dateObj.toLocaleDateString("sv-SE", {
        timeZone: "Asia/Ho_Chi_Minh",
      });

      return {
        date: dateStr,
        problems_solved: row.problems_solved,
      };
    });

    res.json({ activity });
  } catch (err) {
    console.error("getHeatmap error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

// GET /api/wrong-answers
async function getWrongAnswers(req, res) {
  const userId = req.session.userId;
  const pageSize = 10;
  let page = parseInt(req.query.page || "1", 10);

  if (Number.isNaN(page) || page < 1) page = 1;

  try {
    const errorLogResult = await db.query(
      `
      SELECT test_file, question_id, log_text
      FROM wrong_answer_error_logs
      WHERE user_id = $1
    `,
      [userId]
    );

    const errorLogByQuestion = new Map();
    errorLogResult.rows.forEach((row) => {
      const key = `${row.test_file}::${row.question_id}`;
      errorLogByQuestion.set(key, row.log_text || "");
    });

    const latestAttempts = await db.query(
      `
      SELECT DISTINCT ON (test_file) id, test_file, answers_json, taken_at
      FROM test_history
      WHERE user_id = $1
      ORDER BY test_file, taken_at DESC, id DESC
    `,
      [userId]
    );

    const tests = [];

    latestAttempts.rows.forEach((row) => {
      let answers;
      try {
        answers = JSON.parse(row.answers_json || "{}");
      } catch (err) {
        console.error("Invalid answers_json for attempt", row.id, err);
        return;
      }

      let parsed;
      try {
        parsed = parseTestFile(row.test_file);
      } catch (err) {
        console.error("parseTestFile failed for", row.test_file, err);
        return;
      }

      const wrongQuestions = parsed.questions.reduce((acc, q) => {
        const rawAnswer = answers[q.id];
        const normalizedAnswer =
          rawAnswer === undefined || rawAnswer === null
            ? null
            : String(rawAnswer).trim();

        const hasAnswer = normalizedAnswer !== null && normalizedAnswer !== "";
        const isCorrect = hasAnswer && isCorrectAnswer(q, normalizedAnswer);
        if (isCorrect) return acc;

        acc.push({
          id: q.id,
          question: q.question,
          choices: q.choices,
          correct: q.correct,
          userAnswer: hasAnswer ? normalizedAnswer : null,
          omitted: !hasAnswer,
          type: q.type,
          image: q.image,
          errorLog:
            errorLogByQuestion.get(`${row.test_file}::${q.id}`) || "",
        });

        return acc;
      }, []);

      if (wrongQuestions.length > 0) {
        tests.push({
          testFile: row.test_file,
          attemptId: row.id,
          taken_at: row.taken_at,
          wrongQuestions,
        });
      }
    });

    tests.sort((a, b) => new Date(b.taken_at || 0) - new Date(a.taken_at || 0));

    const totalTests = tests.length;
    const totalPages = totalTests > 0 ? Math.ceil(totalTests / pageSize) : 1;
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const start = (safePage - 1) * pageSize;
    const paginatedTests = tests.slice(start, start + pageSize);

    res.json({
      page: safePage,
      pageSize,
      totalTests,
      totalPages,
      tests: paginatedTests,
    });
  } catch (err) {
    console.error("getWrongAnswers error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// POST /api/wrong-answers/error-log
async function saveWrongAnswerErrorLog(req, res) {
  const userId = req.session.userId;
  const { testFile, questionId, logText } = req.body || {};

  if (!testFile || !Number.isInteger(Number(questionId))) {
    return res.status(400).json({ error: "Thiếu testFile hoặc questionId hợp lệ" });
  }

  const normalizedLogText = String(logText || "").slice(0, 5000);

  try {
    await db.query(
      `
      INSERT INTO wrong_answer_error_logs (user_id, test_file, question_id, log_text, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, test_file, question_id)
      DO UPDATE SET log_text = EXCLUDED.log_text, updated_at = CURRENT_TIMESTAMP
    `,
      [userId, testFile, Number(questionId), normalizedLogText]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("saveWrongAnswerErrorLog error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}


module.exports = {
  saveTestHistory,
  getTestHistory,
  getReviewDetail,
  getTestState,
  saveTestState,
  checkTestCompleted,
  getTestStatuses,
  resetTest,
  getHeatmap,
  getWrongAnswers,
  saveWrongAnswerErrorLog,
};
