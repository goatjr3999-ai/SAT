const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o";
const db = require("../utils/db");
const SYSTEM_PROMPT = `Giải thích câu hỏi SAT sau một cách dễ hiểu. Chỉ dùng chữ format bình thường, không emoji, không bold, không italic, ...
Các từ khó giải nghĩa ra tiếng việt, khoa học (tôi lấy ví dụ như convergent evolution, invertibrate, ...) bạn giữ nguyên là tiếng anh, không dùng tiếng việt khiến câu đọc khó hiểu. CHÚ Ý CHỈ NHỮNG TỪ MANG KHÁI NIỆM KHOA HỌC LẠ, KHÓ HIỂU VỚI HỌC SINH MỚI ĐỂ NGUYÊN.
Những tên riêng dài khoa học như Xenopus Laevis thì viết tắt là X.Laevis. KHÔNG ĐƯỢC VIẾT ĐẦY ĐỦ TÊN RIÊNG KHOA HỌC TRONG GIẢI THÍCH, RẤT DÀI VÀ KHÓ HIỂU. 
Bạn phải suy nghĩ kĩ để giải thích đúng, phù hợp đáp án đúng tôi cung cấp. 
Khi phân tích đoạn passage thì mỗi dòng một câu cho tôi, không viết thành đoạn văn dài khó đọc. Phân tích đoạn văn ghi (1):, (2):, (3): ở từng ý. 
Trước khi phân tích đáp án (sau đoạn văn) phải nói đáp án đúng cần chứng minh điều gì
Phân tích đáp án thì không dùng (1), (2), (3), ... mà dùng - Đáp án A, -Đáp án B, -Đáp án C, Đáp án D. 
Những câu reading mà dài thì không được nói lan man, tập trung vào yếu tố để chọn được đáp án đúng`;

function buildUserPrompt({
  passage = "",
  question = "",
  choices = {},
  correctAnswer = "",
  questionType = "mcq",
}) {
  const isGridQuestion = questionType === "grid";

  const choicesBlock = isGridQuestion
    ? "[CHOICES]\nCâu này là dạng grid (student-produced response), không có 4 lựa chọn A/B/C/D."
    : `[CHOICES]
A. ${choices.A}
B. ${choices.B}
C. ${choices.C}
D. ${choices.D}`;

  return `Giải thích câu hỏi SAT, đáp án đúng tôi đã cung cấp. 

[PASSAGE]
${passage}

[QUESTION]
${question}

${choicesBlock}

[CORRECT ANSWER]
${correctAnswer}`.trim();
}

async function getAiExplanation(req, res) {
  const {
    passage,
    question,
    choices,
    testFile,
    questionId,
    correctAnswer,
    questionType,
  } =
    req.body || {};
  const normalizedQuestionId = Number(questionId);

  if (!testFile || !Number.isInteger(normalizedQuestionId) || normalizedQuestionId < 1) {
    return res
      .status(400)
      .json({ error: "Vui lòng cung cấp testFile và questionId hợp lệ." });
  }

  try {
    const cachedResult = await db.query(
      `SELECT explanation, model
       FROM ai_explanations
       WHERE test_file = $1 AND question_id = $2
       LIMIT 1`,
      [testFile, normalizedQuestionId]
    );

    if (cachedResult.rows.length) {
      const cached = cachedResult.rows[0];
      return res.json({
        explanation: cached.explanation,
        model: cached.model || null,
        cached: true,
      });
    }
  } catch (err) {
    console.error("AI cache lookup failed:", err);
    return res.status(500).json({ error: "Không thể đọc cache AI." });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OpenRouter API key." });
  }

  const isGridQuestion = questionType === "grid";
  const hasChoices =
    choices &&
    Object.prototype.hasOwnProperty.call(choices, "A") &&
    Object.prototype.hasOwnProperty.call(choices, "B") &&
    Object.prototype.hasOwnProperty.call(choices, "C") &&
    Object.prototype.hasOwnProperty.call(choices, "D");

  if (!question || (!isGridQuestion && !hasChoices)) {
    return res
      .status(400)
      .json({ error: "Vui lòng cung cấp câu hỏi hợp lệ." });
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const prompt = buildUserPrompt({
    passage,
    question,
    choices,
    correctAnswer,
    questionType,
  });

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.OPENROUTER_SITE_URL || req.headers.origin || "http://localhost",
        "X-Title": "GlorySAT",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({
        error: "OpenRouter request failed.",
        detail: errorText,
      });
    }

    const data = await response.json();
    const explanation = data?.choices?.[0]?.message?.content?.trim();

    if (!explanation) {
      return res.status(502).json({ error: "OpenRouter returned no content." });
    }

    try {
      await db.query(
        `INSERT INTO ai_explanations (test_file, question_id, explanation, model)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (test_file, question_id)
         DO UPDATE SET explanation = EXCLUDED.explanation,
                      model = EXCLUDED.model,
                      updated_at = CURRENT_TIMESTAMP`,
        [testFile, normalizedQuestionId, explanation, data?.model || model]
      );
    } catch (err) {
      console.error("AI cache insert failed:", err);
    }

    return res.json({
      explanation,
      model: data?.model || model,
      cached: false,
    });
  } catch (err) {
    console.error("OpenRouter error:", err);
    return res.status(500).json({ error: "AI explanation failed." });
  }
}

module.exports = { getAiExplanation };