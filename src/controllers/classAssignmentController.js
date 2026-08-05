// src/controllers/classAssignmentController.js
const db = require("../utils/db");
const { getAllTests } = require("../utils/tests");

function buildCategoryPayload() {
  const allTests = getAllTests();
  const categories = {};

  Object.entries(allTests).forEach(([category, names]) => {
    categories[category] = names.map((name) => ({
      name,
      test_file: `${category}/${name}`,
    }));
  });

  return categories;
}

async function getClassAssignments(req, res) {
  const classId = Number(req.params.id || req.query.classId);

  if (!classId || Number.isNaN(classId)) {
    return res.status(400).json({ error: "Lớp không hợp lệ" });
  }

  try {
    const classResult = await db.query(
      `SELECT id, name FROM classes WHERE id = $1 LIMIT 1`,
      [classId]
    );

    if (classResult.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy lớp" });
    }

    const assignmentsResult = await db.query(
      `SELECT test_file FROM class_test_deadlines WHERE class_id = $1`,
      [classId]
    );

    const categories = buildCategoryPayload();
    const assignedTests = new Set(assignmentsResult.rows.map((row) => row.test_file));

    res.json({
      classId,
      className: classResult.rows[0].name,
      categories,
      assigned: Array.from(assignedTests),
    });
  } catch (err) {
    console.error("getClassAssignments error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

async function getUserMissingAssignments(req, res) {
  const classId = Number(req.params.classId);
  const userId = Number(req.params.userId);

  if (!classId || Number.isNaN(classId)) {
    return res.status(400).json({ error: "Lớp không hợp lệ" });
  }

  if (!userId || Number.isNaN(userId)) {
    return res.status(400).json({ error: "Người dùng không hợp lệ" });
  }

  try {
    const classResult = await db.query(
      `SELECT id, name FROM classes WHERE id = $1 LIMIT 1`,
      [classId]
    );

    if (classResult.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy lớp" });
    }

    const userResult = await db.query(`SELECT id, username FROM users WHERE id = $1 LIMIT 1`, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    const user = userResult.rows[0];
    const membershipResult = await db.query(
      `
      SELECT 1
      FROM (
        SELECT uc.class_id
        FROM user_classes uc
        WHERE uc.user_id = $1
        UNION
        SELECT u.class_id
        FROM users u
        WHERE u.id = $1 AND u.class_id IS NOT NULL
      ) memberships
      WHERE memberships.class_id = $2
      LIMIT 1
    `,
      [userId, classId]
    );

    if (membershipResult.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "Học sinh không thuộc lớp đã chọn" });
    }

    const missingResult = await db.query(
      `
      SELECT ctd.test_file, ctd.category, ctd.updated_at AS assigned_at, ctd.deadline
      FROM class_test_deadlines ctd
      WHERE ctd.class_id = $1
        AND ctd.deadline >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM test_history th
          WHERE th.user_id = $2 AND th.test_file = ctd.test_file
        )
      ORDER BY ctd.deadline ASC, ctd.updated_at DESC
      `,
      [classId, userId]
    );

    return res.json({
      classId,
      className: classResult.rows[0].name,
      userId,
      username: user.username,
      missingAssignments: missingResult.rows,
    });
  } catch (err) {
    console.error("getUserMissingAssignments error:", err);
    return res.status(500).json({ error: "Không thể tải danh sách còn thiếu" });
  }
}

async function toggleClassAssignment(req, res) {
  return res.status(410).json({
    error:
      "Đã bỏ chức năng giao bài thủ công. Bài có deadline sẽ tự động được tính là đã giao.",
  });
}

async function getMyAssignments(req, res) {
  const userId = req.session.userId;

  try {
    const userResult = await db.query(
      `
      SELECT memberships.class_id, c.name AS class_name
      FROM (
        SELECT uc.class_id
        FROM user_classes uc
        WHERE uc.user_id = $1
        UNION
        SELECT u.class_id
        FROM users u
        WHERE u.id = $1 AND u.class_id IS NOT NULL
      ) memberships
      INNER JOIN classes c ON c.id = memberships.class_id
      ORDER BY c.name ASC
    `,
      [userId]
    );

    const classRows = userResult.rows || [];
    const classIds = classRows.map((row) => row.class_id);

    if (classIds.length === 0) {
      return res.json({ classId: null, className: null, classes: [], assignments: [] });
    }

    const assignmentsResult = await db.query(
      `
      SELECT DISTINCT ON (ctd.test_file)
        ctd.test_file,
        ctd.category,
        ctd.updated_at AS assigned_at,
        ctd.deadline
      FROM class_test_deadlines ctd
      WHERE ctd.class_id = ANY($1::int[])
        AND ctd.deadline >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM test_history th
          WHERE th.user_id = $2 AND th.test_file = ctd.test_file
        )
      ORDER BY ctd.test_file, ctd.deadline ASC, ctd.updated_at DESC
      `,
      [classIds, userId]
    );

    res.json({
      classId: classRows[0]?.class_id || null,
      className: classRows[0]?.class_name || null,
      classes: classRows.map((row) => ({
        classId: row.class_id,
        className: row.class_name,
      })),
      assignments: assignmentsResult.rows,
    });
  } catch (err) {
    console.error("getMyAssignments error:", err);
    return res.status(500).json({ error: "Không thể tải bài tập" });
  }
}

module.exports = {
  getClassAssignments,
  toggleClassAssignment,
  getMyAssignments,
  getUserMissingAssignments,
};