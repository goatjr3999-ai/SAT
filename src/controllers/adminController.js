// src/controllers/adminController.js
const path = require("path");
const db = require("../utils/db");
const { parseTestFile } = require("../utils/testParser");
const { getAllTests } = require("../utils/tests");

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

// GET /admin
function getAdminPage(req, res) {
  res.sendFile(path.join(__dirname, "..", "..", "public", "admin.html"));
}

async function getProTestList(req, res) {
  try {
    const allTests = getAllTests();
    const accessResult = await db.query(
      `SELECT test_file, access_level FROM pro_free_tests`,
      []
    );
    const accessMap = new Map(
      accessResult.rows.map((row) => [
        row.test_file,
        row.access_level || "all",
      ])
    );

    const payload = Object.fromEntries(
      Object.entries(allTests).map(([category, tests]) => [
        category,
        tests.map((name) => ({
          name,
          test_file: `${category}/${name}`,
          access_level: accessMap.get(`${category}/${name}`) || "pro",
        })),
      ])
    );

    res.json({ tests: payload });
  } catch (err) {
    console.error("getProTestList error:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
}

async function updateProTestStatus(req, res) {
  const { test_file: testFile, access_level: accessLevel } = req.body || {};
  const validAccessLevels = new Set(["admin", "pro", "all"]);

  if (!testFile || !validAccessLevels.has(accessLevel)) {
    return res.status(400).json({ error: "Thiếu thông tin hợp lệ" });
  }

  const [category, ...rest] = testFile.split("/");
  const testName = rest.join("/");

  if (!category || !testName) {
    return res.status(400).json({ error: "Đề không hợp lệ" });
  }

  const allTests = getAllTests();
  const testsInCategory = new Set(allTests[category] || []);

  if (!testsInCategory.has(testName)) {
    return res.status(400).json({ error: "Không tìm thấy đề" });
  }

  try {
    if (accessLevel === "pro") {
      await db.query(`DELETE FROM pro_free_tests WHERE test_file = $1`, [
        testFile,
      ]);
    } else {
      await db.query(
        `
        INSERT INTO pro_free_tests (test_file, category, access_level, updated_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (test_file)
        DO UPDATE SET
          updated_by = $4,
          updated_at = CURRENT_TIMESTAMP,
          category = $2,
          access_level = $3      `,
        [testFile, category, accessLevel, req.session.userId || null]
      );
    }

    res.json({ test_file: testFile, access_level: accessLevel });
  } catch (err) {
    console.error("updateProTestStatus error:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
}

async function getTestDeadlines(req, res) {
  try {
    const classId = Number(req.query.class_id);
    if (!classId || Number.isNaN(classId)) {
      return res.json({ tests: {} });
    }

    const allTests = getAllTests();
    const deadlineResult = await db.query(
      `SELECT test_file, deadline FROM class_test_deadlines WHERE class_id = $1`,
      [classId]
    );
    const deadlineMap = new Map(
      deadlineResult.rows.map((row) => [row.test_file, row.deadline])
    );

    const payload = Object.fromEntries(
      Object.entries(allTests).map(([category, tests]) => [
        category,
        tests.map((name) => {
          const testFile = `${category}/${name}`;
          return {
            name,
            test_file: testFile,
            deadline: toDateKey(deadlineMap.get(testFile)),
          };
        }),
      ])
    );

    res.json({ tests: payload });
  } catch (err) {
    console.error("getTestDeadlines error:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
}

async function updateTestDeadline(req, res) {
  const { test_file: testFile, deadline, class_id: classId, category } =
    req.body || {};
  const normalizedDeadline = String(deadline || "").trim();

  const parsedClassId = Number(classId);
  if (!parsedClassId || Number.isNaN(parsedClassId)) {
    return res.status(400).json({ error: "Thiếu lớp hợp lệ" });
  }

  if (normalizedDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDeadline)) {
    return res.status(400).json({ error: "Ngày deadline không hợp lệ" });
  }

  const allTests = getAllTests();

  const upsertDeadline = async (targetTestFile, targetCategory) => {
    if (!normalizedDeadline) {
      await db.query(
        `DELETE FROM class_test_deadlines WHERE class_id = $1 AND test_file = $2`,
        [parsedClassId, targetTestFile]
      );
      return null;
    }

    const result = await db.query(
      `
      INSERT INTO class_test_deadlines (class_id, test_file, category, deadline, updated_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (class_id, test_file)
      DO UPDATE SET
        category = $3,
        deadline = $4,
        updated_by = $5,
        updated_at = CURRENT_TIMESTAMP
      RETURNING test_file, deadline
      `,
      [
        parsedClassId,
        targetTestFile,
        targetCategory,
        normalizedDeadline,
        req.session.userId || null,
      ]
    );
    return result.rows[0] || null;
  };

  if (category) {
    const tests = allTests[category] || [];
    if (tests.length === 0) {
      return res.status(400).json({ error: "Không tìm thấy đề trong mục" });
    }

    try {
      await db.query("BEGIN");
      for (const name of tests) {
        const testFileForCategory = `${category}/${name}`;
        await upsertDeadline(testFileForCategory, category);
      }
      await db.query("COMMIT");
      return res.json({ category, deadline: normalizedDeadline || null });
    } catch (err) {
      await db.query("ROLLBACK");
      console.error("bulkUpdateTestDeadline error:", err);
      return res.status(500).json({ error: "Lỗi server" });
    }
  }

  if (!testFile) {
    return res.status(400).json({ error: "Thiếu thông tin đề" });
  }

  const [resolvedCategory, ...rest] = testFile.split("/");
  const testName = rest.join("/");

  if (!resolvedCategory || !testName) {
    return res.status(400).json({ error: "Đề không hợp lệ" });
  }

  const testsInCategory = new Set(allTests[resolvedCategory] || []);

  if (!testsInCategory.has(testName)) {
    return res.status(400).json({ error: "Không tìm thấy đề" });
  }

  if (!normalizedDeadline) {
    try {
      await db.query(
        `DELETE FROM class_test_deadlines WHERE class_id = $1 AND test_file = $2`,
        [parsedClassId, testFile]
      );
      return res.json({ test_file: testFile, deadline: null });
    } catch (err) {
      console.error("deleteTestDeadline error:", err);
      return res.status(500).json({ error: "Lỗi server" });
    }
  }

  try {
    const row = await upsertDeadline(testFile, resolvedCategory);
    return res.json({
      test_file: row?.test_file || testFile,
      deadline: toDateKey(row?.deadline),
    });
  } catch (err) {
    console.error("updateTestDeadline error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

// GET /admin/devices
async function getAdminDevices(req, res) {
  try {
    const result = await db.query(
      `
      SELECT d.id, u.username, d.device_token, d.approved, d.created_at_vn AS created_at, d.user_id
      FROM devices d
      JOIN users u ON d.user_id = u.id
      ORDER BY d.created_at_vn DESC
    `,
      []
    );

    const usersResult = await db.query(
      `
      SELECT
        u.id,
        u.username,
        u.is_admin,
        u.is_pro,
        COALESCE(
          ARRAY_AGG(DISTINCT COALESCE(uc.class_id, u.class_id))
            FILTER (WHERE COALESCE(uc.class_id, u.class_id) IS NOT NULL),
          ARRAY[]::INTEGER[]
        ) AS class_ids,
        COALESCE(
          ARRAY_AGG(DISTINCT COALESCE(c.name, c_primary.name))
            FILTER (WHERE COALESCE(c.name, c_primary.name) IS NOT NULL),
          ARRAY[]::TEXT[]
        ) AS class_names
      FROM users u
      LEFT JOIN user_classes uc ON uc.user_id = u.id
      LEFT JOIN classes c ON uc.class_id = c.id
      LEFT JOIN classes c_primary ON c_primary.id = u.class_id
      GROUP BY u.id, u.username, u.is_admin, u.is_pro
      ORDER BY u.id ASC
    `,
      []
    );

    const classesResult = await db.query(
      `
      SELECT id, name
      FROM classes
      ORDER BY name ASC
    `,
      []
    );

    const submissionsResult = await db.query(
      `
      SELECT
        th.id,
        u.email,
        u.username,
        COALESCE(
          ARRAY_AGG(DISTINCT COALESCE(uc.class_id, u.class_id))
            FILTER (WHERE COALESCE(uc.class_id, u.class_id) IS NOT NULL),
          ARRAY[]::INTEGER[]
        ) AS class_ids,
        COALESCE(
          ARRAY_AGG(DISTINCT COALESCE(c.name, c_primary.name))
            FILTER (WHERE COALESCE(c.name, c_primary.name) IS NOT NULL),
          ARRAY[]::TEXT[]
        ) AS class_names,
        th.test_file,
        th.score,
        th.total_questions,
        th.taken_at
      FROM test_history th
      JOIN users u ON th.user_id = u.id
      LEFT JOIN user_classes uc ON uc.user_id = u.id
      LEFT JOIN classes c ON uc.class_id = c.id
      LEFT JOIN classes c_primary ON c_primary.id = u.class_id
      GROUP BY th.id, u.email, u.username, th.test_file, th.score, th.total_questions, th.taken_at
      ORDER BY th.taken_at DESC
      LIMIT 100
    `,
      []
    );

    res.json({
      adminUsername: req.session.username,
      devices: result.rows,
      users: usersResult.rows,
      submissions: submissionsResult.rows,
      classes: classesResult.rows,
    });
  } catch (err) {
    console.error("getAdminDevices error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

async function createClass(req, res) {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).send("Tên lớp không được để trống");
  }

  try {
    await db.query(`INSERT INTO classes (name) VALUES ($1)`, [name.trim()]);
    return res.redirect("/admin");
  } catch (err) {
    console.error("createClass error:", err);
    if (err.code === "23505") {
      return res.status(400).send("Tên lớp đã tồn tại");
    }
    return res.status(500).send("Lỗi server");
  }
}
async function deleteClass(req, res) {
  const classId = Number(req.params.id);

  if (!classId || Number.isNaN(classId)) {
    return res.status(400).send("Lớp không hợp lệ");
  }

  try {
    await db.query(`UPDATE users SET class_id = NULL WHERE class_id = $1`, [classId]);
    await db.query(`DELETE FROM user_classes WHERE class_id = $1`, [classId]);
    await db.query(`DELETE FROM classes WHERE id = $1`, [classId]);

    return res.redirect("/admin");
  } catch (err) {
    console.error("deleteClass error:", err);
    return res.status(500).send("Lỗi server");
  }
}

async function renameClass(req, res) {
  const classId = Number(req.params.id);
  const { name } = req.body;

  if (!classId || Number.isNaN(classId)) {
    return res.status(400).send("Lớp không hợp lệ");
  }

  if (!name || !name.trim()) {
    return res.status(400).send("Tên lớp không được để trống");
  }

  try {
    const result = await db.query(
      `UPDATE classes SET name = $1 WHERE id = $2 RETURNING id, name`,
      [name.trim(), classId]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Không tìm thấy lớp");
    }

    return res.json({ id: result.rows[0].id, name: result.rows[0].name });
  } catch (err) {
    console.error("renameClass error:", err);
    if (err.code === "23505") {
      return res.status(400).send("Tên lớp đã tồn tại");
    }
    return res.status(500).send("Lỗi server");
  }
}

async function assignUserClass(req, res) {
  const userId = Number(req.params.id);
  const classIdsRaw = req.body.class_ids;

  if (!userId || Number.isNaN(userId)) {
    return res.status(400).send("Thiếu thông tin người dùng");
  }

  const normalizedClassIds = Array.from(
    new Set(
      (Array.isArray(classIdsRaw) ? classIdsRaw : classIdsRaw ? [classIdsRaw] : [])
        .map((value) => Number(String(value).trim()))
        .filter((value) => !Number.isNaN(value) && value > 0)
    )
  );


  try {
    const classesResult = await db.query(`SELECT id FROM classes`, []);
    const validClassIds = new Set(classesResult.rows.map((row) => row.id));
    const filteredClassIds = normalizedClassIds.filter((id) => validClassIds.has(id));

    await db.query("BEGIN");
    await db.query(`DELETE FROM user_classes WHERE user_id = $1`, [userId]);

    for (const classId of filteredClassIds) {
      await db.query(
        `
        INSERT INTO user_classes (user_id, class_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, class_id) DO NOTHING
      `,
        [userId, classId]
      );
    }

    const primaryClassId = filteredClassIds[0] || null;
    await db.query(`UPDATE users SET class_id = $1 WHERE id = $2`, [primaryClassId, userId]);
    await db.query("COMMIT");

    return res.redirect("/admin");
  } catch (err) {
    await db.query("ROLLBACK");
    console.error("assignUserClass error:", err);
    return res.status(500).send("Lỗi server");
  }
}
// POST /admin/create-user
async function createUser(req, res) {
  const { username, password, is_admin } = req.body;
  const isAdminFlag = is_admin === "on" ? 1 : 0;

  try {
    await db.query(
      `
      INSERT INTO users (username, password, is_admin)
      VALUES ($1, $2, $3)
    `,
      [username, password, isAdminFlag]
    );
    res.redirect("/admin");
  } catch (err) {
    console.error("createUser error:", err);
    // Unique constraint trong Postgres là mã lỗi 23505
    if (err.code === "23505") {
      return res.send("Username đã tồn tại.");
    }
    return res.status(500).send("Lỗi server");
  }
}

// POST /admin/approve/:id
async function approveDevice(req, res) {
  const deviceId = req.params.id;

  try {
    const result = await db.query(
      `SELECT * FROM devices WHERE id = $1`,
      [deviceId]
    );
    const device = result.rows[0];

    if (!device) return res.status(404).send("Không tìm thấy thiết bị");
    if (device.approved === 1) return res.redirect("/admin");

    await db.query(
      `UPDATE devices SET approved = 1 WHERE id = $1`,
      [deviceId]
    );

    res.redirect("/admin");
  } catch (err) {
    console.error("approveDevice error:", err);
    return res.status(500).send("Lỗi server");
  }
}

// POST /admin/revoke/:id
async function revokeDevice(req, res) {
  const deviceId = req.params.id;

  try {
    await db.query(
      `DELETE FROM devices WHERE id = $1`,
      [deviceId]
    );
    res.redirect("/admin");
  } catch (err) {
    console.error("revokeDevice error:", err);
    return res.status(500).send("Lỗi server");
  }
}

async function updateUserProStatus(req, res) {
  const userId = req.params.id;
  const action = req.body.action;

  if (!userId || !["grant", "revoke"].includes(action)) {
    return res.status(400).send("Thiếu thông tin hợp lệ");
  }

  const isPro = action === "grant" ? 1 : 0;

  try {
    await db.query(`UPDATE users SET is_pro = $1 WHERE id = $2`, [isPro, userId]);
    res.redirect("/admin");
  } catch (err) {
    console.error("updateUserProStatus error:", err);
    return res.status(500).send("Lỗi server");
  }
}

// GET /admin/export-wrong-answers
async function exportWrongAnswers(req, res) {
  const username = (req.query.username || "").trim();

  if (!username) {
    return res.status(400).send("Thiếu username");
  }

  try {
    const userResult = await db.query(
      `SELECT id, username FROM users WHERE username = $1 LIMIT 1`,
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).send("Không tìm thấy người dùng");
    }

    const userId = userResult.rows[0].id;

    const latestAttempts = await db.query(
      `
      SELECT DISTINCT ON (test_file) id, test_file, answers_json, taken_at
      FROM test_history
      WHERE user_id = $1
      ORDER BY test_file, taken_at DESC, id DESC
    `,
      [userId]
    );

    const lines = [];
    const now = new Date().toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
    });

    lines.push(`Wrong answers for user: ${username}`);
    lines.push(`Generated at: ${now}`);
    lines.push("");

    let totalWrong = 0;

    for (const row of latestAttempts.rows) {
      let answers = {};
      try {
        answers = JSON.parse(row.answers_json || "{}");
      } catch (err) {
        console.error("Invalid answers_json for attempt", row.id, err);
        continue;
      }

      let parsed;
      try {
        parsed = parseTestFile(row.test_file);
      } catch (err) {
        console.error("parseTestFile failed for", row.test_file, err);
        continue;
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
          correct: q.correct,
          userAnswer: hasAnswer ? normalizedAnswer : null,
          omitted: !hasAnswer,
          choices: q.choices 
        });

        return acc;
      }, []);

      if (wrongQuestions.length === 0) continue;

      totalWrong += wrongQuestions.length;

      wrongQuestions.forEach((q, idx) => {
        lines.push(`${idx + 1}. Câu ${q.id}`);
        if (q.question) {
          lines.push(`${q.question}`);
        }
        if (q.choices) {
          lines.push(`A. ${q.choices.A || ""}`);
          lines.push(`B. ${q.choices.B || ""}`);
          lines.push(`C. ${q.choices.C || ""}`);
          lines.push(`D. ${q.choices.D || ""}`);
        }
        lines.push(`Đáp án đúng: ${q.correct}`);
        lines.push(
          `Câu trả lời của user: ${q.omitted ? "(bỏ trống)" : q.userAnswer}`
        );
        lines.push("");
      });
    }

    if (totalWrong === 0) {
      lines.push("Người dùng không có câu sai nào.");
    }

    const content = lines.join("\n");
    const filename = `${username}-wrong-answers.txt`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(content);
  } catch (err) {
    console.error("exportWrongAnswers error:", err);
    return res.status(500).send("Lỗi server");
  }
}

module.exports = {
  getAdminPage,
  getAdminDevices,
  getProTestList,
  updateProTestStatus,
  getTestDeadlines,
  updateTestDeadline,
  createUser,
  approveDevice,
  revokeDevice,
  updateUserProStatus,
  exportWrongAnswers,
  createClass,
  assignUserClass,
  deleteClass,
  renameClass,
};
