// src/controllers/testController.js
const db = require("../utils/db");
const {
  CATEGORY_DIRS,
  listCategory,
  getCategoryTotals,
} = require("../utils/tests");
const { ensureProFlag } = require("../utils/userSession.js");
const { parseTestFile } = require("../utils/testParser");
const { getTestMeta } = require("../utils/testMeta");
const { encodeQuestionPayload } = require("../utils/textCipher");

function toDateKey(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return match[0];
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

async function getUserClassIds(userId) {
  if (!userId) return [];
  const result = await db.query(
    `
      SELECT class_id
      FROM (
        SELECT uc.class_id
        FROM user_classes uc
        WHERE uc.user_id = $1
        UNION
        SELECT u.class_id
        FROM users u
        WHERE u.id = $1 AND u.class_id IS NOT NULL
      ) memberships
      ORDER BY class_id ASC
    `,
    [userId]
  );
  return result.rows.map((row) => row.class_id);
}

async function getTestDeadlines(classIds) {
  if (!Array.isArray(classIds) || classIds.length === 0) return new Map();
  const result = await db.query(
    `
      SELECT test_file, MIN(deadline) AS deadline
      FROM class_test_deadlines
      WHERE class_id = ANY($1::int[])
      GROUP BY test_file
    `,
    [classIds]
  );
  return new Map(result.rows.map((row) => [row.test_file, row.deadline]));
}

async function getDeadlineForTest(testFile, classIds) {
  if (!Array.isArray(classIds) || classIds.length === 0) return null;
  const result = await db.query(
    `
      SELECT MIN(deadline) AS deadline
      FROM class_test_deadlines
      WHERE test_file = $1 AND class_id = ANY($2::int[])
    `,
    [testFile, classIds]
  );
  return result.rows[0]?.deadline || null;
}

async function getFreeTestSet() {
  const result = await db.query(
    `SELECT test_file, access_level FROM pro_free_tests`,
    []
  );
  return new Map(
    result.rows.map((row) => [row.test_file, row.access_level || "all"])
  );
}

async function hasUserCompletedTest(userId, testFile) {
  if (!userId || !testFile) return false;
  const result = await db.query(
    `
      SELECT 1
      FROM test_history
      WHERE user_id = $1 AND test_file = $2
      LIMIT 1
    `,
    [userId, testFile]
  );
  return result.rowCount > 0;
}

function isTestLockedForUser(category, name, isPro, isAdmin, accessMap) {
  const testFile = `${category}/${name}`;
  const accessLevel = accessMap?.get(testFile) || "pro";

  if (accessLevel === "all") return false;
  if (accessLevel === "admin") return !isAdmin;
  return !isPro;
}

function isDeadlineLocked(deadlineKey, todayKey, isAdmin) {
  if (!deadlineKey || isAdmin) return false;
  return todayKey > deadlineKey;
}

function buildTestPayload(category, tests, isPro, isAdmin, accessMap, deadlineMap, todayKey) {
  return tests.map((name) => {
    const meta = getTestMeta(category, name);
    const testFile = `${category}/${name}`;
    const deadlineKey = toDateKey(deadlineMap?.get(testFile));
    const deadlineLocked = isDeadlineLocked(deadlineKey, todayKey, isAdmin);
    return {
      name,
      locked: isTestLockedForUser(category, name, isPro, isAdmin, accessMap) || deadlineLocked,
      questionCount: meta.questionCount,
      timeMinutes: meta.timeMinutes,
      deadline: deadlineKey,
    };
  });
}

// GET /api/tests
async function getTests(req, res) {
  try {
    const isPro = await ensureProFlag(req);
    const isAdmin = req.session.isAdmin === true;
    const category = req.query.category;
    const accessMap = await getFreeTestSet();
    const classIds = await getUserClassIds(req.session.userId);
    const deadlineMap = await getTestDeadlines(classIds);
    const todayKey = toDateKey(new Date());

    if (category) {
      const dirPath = CATEGORY_DIRS[category];
      if (!dirPath) {
        return res.status(400).json({ error: "Invalid category" });
      }

      const tests = listCategory(dirPath);
      return res.json({
        category,
        tests: buildTestPayload(
          category,
          tests,
          isPro,
          isAdmin,
          accessMap,
          deadlineMap,
          todayKey
        ),
      });
    }

    const payload = {};
    Object.entries(CATEGORY_DIRS).forEach(([key, dirPath]) => {
      const tests = listCategory(dirPath);
      payload[key] = buildTestPayload(
        key,
        tests,
        isPro,
        isAdmin,
        accessMap,
        deadlineMap,
        todayKey
      );
    });

    res.json(payload);
  } catch (err) {
    console.error("Error reading tests:", err);
    res.status(500).send("Cannot read tests folder");
  }
}

// GET /api/home-stats
async function getHomeStats(req, res) {
  const userId = req.session.userId;

  try {
    const totals = getCategoryTotals();

    const result = await db.query(
      `
      SELECT
        COUNT(DISTINCT test_file) FILTER (WHERE test_file LIKE 'real_tests/%') AS real_completed,
        COUNT(DISTINCT test_file) FILTER (WHERE test_file LIKE 'practice_tests/%') AS practice_completed,
        COUNT(DISTINCT test_file) FILTER (WHERE test_file LIKE 'starter/%') AS starter_completed,
        COUNT(DISTINCT test_file) FILTER (WHERE test_file LIKE 'cramming/%') AS cramming_completed,
        COUNT(DISTINCT test_file) FILTER (WHERE test_file LIKE 'math/%') AS math_completed,
        COUNT(DISTINCT test_file) FILTER (WHERE test_file LIKE 'math_cramming/%') AS math_cramming_completed,
        AVG(CASE WHEN total_questions > 0 THEN score::decimal / total_questions ELSE NULL END)
          FILTER (WHERE test_file LIKE 'real_tests/%') AS real_accuracy,
        AVG(CASE WHEN total_questions > 0 THEN score::decimal / total_questions ELSE NULL END)
          FILTER (WHERE test_file LIKE 'practice_tests/%') AS practice_accuracy,
        AVG(CASE WHEN total_questions > 0 THEN score::decimal / total_questions ELSE NULL END)
          FILTER (WHERE test_file LIKE 'starter/%') AS starter_accuracy,
        AVG(CASE WHEN total_questions > 0 THEN score::decimal / total_questions ELSE NULL END)
          FILTER (WHERE test_file LIKE 'cramming/%') AS cramming_accuracy,
        AVG(CASE WHEN total_questions > 0 THEN score::decimal / total_questions ELSE NULL END)
          FILTER (WHERE test_file LIKE 'math/%') AS math_accuracy,
        AVG(CASE WHEN total_questions > 0 THEN score::decimal / total_questions ELSE NULL END)
          FILTER (WHERE test_file LIKE 'math_cramming/%') AS math_cramming_accuracy
      FROM test_history
      WHERE user_id = $1
    `,
      [userId]
    );

    const row = result.rows[0] || {};

    res.json({
      totals,
      completed: {
        real_tests: Number(row.real_completed || 0),
        practice_tests: Number(row.practice_completed || 0),
        starter: Number(row.starter_completed || 0),
        cramming: Number(row.cramming_completed || 0),
        math: Number(row.math_completed || 0),
        math_cramming: Number(row.math_cramming_completed || 0),
      },
      accuracy: {
        real_tests: Number(row.real_accuracy || 0),
        practice_tests: Number(row.practice_accuracy || 0),
        starter: Number(row.starter_accuracy || 0),
        cramming: Number(row.cramming_accuracy || 0),
        math: Number(row.math_accuracy || 0),
        math_cramming: Number(row.math_cramming_accuracy || 0),
      },
    });
  } catch (err) {
    console.error("getHomeStats error:", err);
    res.status(500).json({ error: "Cannot load stats" });
  }
}

// GET /api/parsed-test
async function getParsedTest(req, res) {
  const folder = req.query.file;
  const mode = String(req.query.mode || "").trim();
  if (!folder) {
    return res.status(400).json({ error: "Missing file parameter" });
  }
  
  const isPro = await ensureProFlag(req);
  const isAdmin = req.session.isAdmin === true;
  const accessMap = await getFreeTestSet();
  const accessLevel = accessMap.get(folder) || "pro";
  const isAllowed =
    accessLevel === "all" ||
    (accessLevel === "admin" ? isAdmin : isPro);
  const allowReviewLocked =
    mode === "review" &&
    (await hasUserCompletedTest(req.session.userId, folder));

  if (!isAllowed && !allowReviewLocked) {
    return res.status(403).json({
      error: "Bạn không có quyền truy cập đề này.",
    });
  }
  
  const classIds = await getUserClassIds(req.session.userId);
  const deadlineKey = toDateKey(await getDeadlineForTest(folder, classIds));
  const todayKey = toDateKey(new Date());
  if (!isAdmin && deadlineKey && todayKey > deadlineKey && !allowReviewLocked) {
    return res.status(403).json({
      error: "Đề đã hết hạn.",
    });
  }
  
  try {
    const parsed = parseTestFile(folder);

    res.json({
      ...parsed,
      questions: encodeQuestionPayload(parsed.questions),
    });
  } catch (err) {
    console.error("parseTestFile error:", err);
    return res.status(404).json({ error: err.message || "Cannot parse test" });
  }
}

module.exports = {
  getTests,
  getParsedTest,
  getHomeStats,
};
