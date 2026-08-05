const db = require("../utils/db");
const { getVNTime } = require("../utils/time");
const { getAllTests } = require("../utils/tests");
const { ensureProFlag } = require("../utils/userSession.js");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getTodayDateString() {
  return getVNTime().split(" ")[0];
}

function parseDateOnly(value = "") {
  const [year, month, day] = value.split("-").map(Number);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateString(dateObj) {
  if (!dateObj) return "";

  return new Date(dateObj)
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" })
    .slice(0, 10);
}

function addDays(dateObj, days) {
  const clone = new Date(dateObj.getTime());
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

function shuffle(array = []) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getRealTestBase(name = "") {
  return name.replace(/ - Mod \d+$/i, "").trim();
}

function buildRealTestPairs(allTests, completedSet) {
  const groups = {};

  (allTests.real_tests || []).forEach((name) => {
    const base = getRealTestBase(name);
    if (!groups[base]) groups[base] = [];
    groups[base].push(name);
  });

  return Object.values(groups)
    .map((modules) => modules.sort())
    .map((modules) => modules.map((name) => `real_tests/${name}`))
    .filter((modules) => modules.length > 0 && modules.every((file) => !completedSet.has(file)));
}

function distributeTestsAcrossDays({
  files,
  daysCount,
  maxPerDay,
  startDate,
  category,
}) {
  if (!daysCount || daysCount < 1 || files.length === 0) return [];

  const capacity = daysCount * maxPerDay;
  const selected = shuffle(files).slice(0, Math.min(files.length, capacity));
  if (selected.length === 0) return [];

  const buckets = Array.from({ length: daysCount }, () => []);

  selected.forEach((file, idx) => {
    let target = Math.floor((idx * daysCount) / selected.length);
    let attempts = 0;

    while (buckets[target].length >= maxPerDay && attempts < daysCount) {
      target = (target + 1) % daysCount;
      attempts += 1;
    }

    if (attempts < daysCount) {
      buckets[target].push(file);
    }
  });

  const tasks = [];
  buckets.forEach((testsInDay, offset) => {
    if (!testsInDay.length) return;

    const day = addDays(startDate, offset);
    const taskDate = toDateString(day);

    testsInDay.forEach((file) => {
      tasks.push({
        category,
        test_file: file,
        task_date: taskDate,
      });
    });
  });

  return tasks;
}

function distributeTestPairsAcrossDays({ pairs, daysCount, maxPerDay, startDate }) {
  if (!daysCount || daysCount < 1 || pairs.length === 0) return [];

  const capacity = daysCount * maxPerDay;
  const selected = shuffle(pairs).slice(0, Math.min(pairs.length, capacity));
  if (selected.length === 0) return [];

  const buckets = Array.from({ length: daysCount }, () => []);

  selected.forEach((pair, idx) => {
    let target = Math.floor((idx * daysCount) / selected.length);
    let attempts = 0;

    while (buckets[target].length >= maxPerDay && attempts < daysCount) {
      target = (target + 1) % daysCount;
      attempts += 1;
    }

    if (attempts < daysCount) {
      buckets[target].push(pair);
    }
  });

  const tasks = [];

  buckets.forEach((pairsInDay, offset) => {
    if (!pairsInDay.length) return;

    const day = addDays(startDate, offset);
    const taskDate = toDateString(day);

    pairsInDay.forEach((modules) => {
      modules.forEach((file) => {
        tasks.push({
          category: "real_tests",
          test_file: file,
          task_date: taskDate,
        });
      });
    });
  });

  return tasks;
}

async function setExamDate(req, res) {
  const userId = req.session.userId;
  const { examDate } = req.body || {};

  const isPro = await ensureProFlag(req);
  if (!isPro) return res.status(403).json({ error: "Tính năng chỉ dành cho tài khoản Pro." });

  const examDateObj = parseDateOnly(examDate);
  const todayStr = getTodayDateString();
  const todayObj = parseDateOnly(todayStr);

  if (!examDateObj) {
    return res.status(400).json({ error: "Ngày thi không hợp lệ." });
  }

  const diffDays = Math.ceil((examDateObj - todayObj) / MS_PER_DAY);
  if (diffDays < 1) {
    return res.status(400).json({ error: "Ngày thi phải sau hôm nay." });
  }

  try {
    const allTests = getAllTests();

    const completedRes = await db.query(
      `SELECT DISTINCT test_file FROM test_history WHERE user_id = $1`,
      [userId]
    );
    const completedSet = new Set(completedRes.rows.map((row) => row.test_file));

    const available = {
      real_tests: buildRealTestPairs(allTests, completedSet),
      practice_tests: (allTests.practice_tests || [])
        .map((name) => `practice_tests/${name}`)
        .filter((file) => !completedSet.has(file)),
    };

    const startDate = parseDateOnly(todayStr);
    const tasks = [
      ...distributeTestPairsAcrossDays({
        pairs: available.real_tests,
        daysCount: diffDays,
        maxPerDay: 5,
        startDate,
      }),
      ...distributeTestsAcrossDays({
        files: available.practice_tests,
        daysCount: diffDays,
        maxPerDay: 10,
        startDate,
        category: "practice_tests",
      }),
    ];

    await db.query(
      `INSERT INTO exam_plans (user_id, exam_date, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         exam_date = EXCLUDED.exam_date,
         created_at = NOW()`,
      [userId, examDate]
    );

    await db.query(`DELETE FROM study_plan_tasks WHERE user_id = $1`, [userId]);

    for (const task of tasks) {
      await db.query(
        `INSERT INTO study_plan_tasks (user_id, task_date, test_file, category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, task_date, test_file) DO NOTHING`,
        [userId, task.task_date, task.test_file, task.category]
      );
    }

    return res.json({
      ok: true,
      examDate,
      scheduledTasks: tasks.length,
    });
  } catch (err) {
    console.error("setExamDate error:", err);
    return res.status(500).json({ error: "Không thể lưu ngày thi." });
  }
}

async function getTodayPlan(req, res) {
  const userId = req.session.userId;
  const isPro = await ensureProFlag(req);

  if (!isPro) {
    return res.status(403).json({ error: "Tính năng chỉ dành cho tài khoản Pro." });
  }

  try {
    const planResult = await db.query(
      `SELECT exam_date FROM exam_plans WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    const examDateValue = planResult.rows[0]?.exam_date;
    if (!examDateValue) {
      return res.json({ needsExamDate: true });
    }

    const examDateStr = toDateString(new Date(examDateValue));
    const todayStr = getTodayDateString();

    const tasksResult = await db.query(
      `SELECT task_date, test_file, category
       FROM study_plan_tasks
       WHERE user_id = $1 AND task_date = $2
       ORDER BY category, test_file`,
      [userId, todayStr]
    );

    let tasks = tasksResult.rows;

    if (tasks.length) {
      const testFiles = tasks.map((t) => t.test_file);
      const completedRes = await db.query(
        `SELECT DISTINCT test_file FROM test_history WHERE user_id = $1 AND test_file = ANY($2::text[])`,
        [userId, testFiles]
      );

      const completed = new Set(completedRes.rows.map((row) => row.test_file));

      if (completed.size) {
        await db.query(
          `DELETE FROM study_plan_tasks WHERE user_id = $1 AND test_file = ANY($2::text[])`,
          [userId, Array.from(completed)]
        );
      }

      tasks = tasks.filter((t) => !completed.has(t.test_file));
    }

    return res.json({
      examDate: examDateStr,
      today: todayStr,
      tasks,
    });
  } catch (err) {
    console.error("getTodayPlan error:", err);
    return res.status(500).json({ error: "Không thể tải kế hoạch luyện tập." });
  }
}

module.exports = {
  setExamDate,
  getTodayPlan,
};
