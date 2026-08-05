const fs = require("fs");
const path = require("path");
const { testsDir } = require("./tests");

function loadMathMap(folderPath) {
  const mathFile = path.join(folderPath, "math.json");
  if (!fs.existsSync(mathFile)) return null;

  try {
    const raw = fs.readFileSync(mathFile, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Invalid math.json:", mathFile, err);
    return null;
  }
}

function applyMathTokens(text = "", mathMap) {
  if (!mathMap || !text) return text;

  const escapeRegex = (value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const isWordOrDigit = (char) => /[\p{L}\p{N}]/u.test(char);

  return Object.entries(mathMap).reduce((acc, [token, latex]) => {
    const replacement = `\\(${latex}\\)`;
    const tokenRegex = new RegExp(escapeRegex(token), "g");

    return acc.replace(tokenRegex, (match, offset, source) => {
      const leftChar = offset > 0 ? source[offset - 1] : "";
      const rightChar = source[offset + match.length] || "";
      const leftPad = leftChar && isWordOrDigit(leftChar) ? " " : "";
      const rightPad = rightChar && isWordOrDigit(rightChar) ? " " : "";

      return `${leftPad}${replacement}${rightPad}`;
    });
  }, text);
}

function parseTestFile(folder) {
  if (!folder) {
    throw new Error("Missing folder name");
  }

  const folderPath = path.join(testsDir, folder);
  if (!fs.existsSync(folderPath)) {
    throw new Error("Folder not found: " + folder);
  }

  const files = fs.readdirSync(folderPath);
  const txtFile = files.find((f) => f.toLowerCase().endsWith(".txt"));
  if (!txtFile) {
    throw new Error("No .txt file found in folder: " + folder);
  }

  const txt = fs.readFileSync(path.join(folderPath, txtFile), "utf8");
  const blocks = txt.split(/Question\s+\d+:/g).slice(1);
  const mathMap = loadMathMap(folderPath);

  const questions = blocks.map((block, index) => {
    const normalizedBlock = block.replace(/\r\n/g, "\n");
    const lines = normalizedBlock
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const choiceRegex = /^([A-D])\.\s*(.*)$/;
    const choices = {};
    const questionTextLines = [];
    const answerIndex = lines.findIndex((line) => /^Answer\s*:/i.test(line));

    let explanation = "";
    if (answerIndex !== -1) {
      const explainLine = lines
        .slice(answerIndex + 1)
        .find((line) => /^Explain\s*:/i.test(line));

      if (explainLine) {
        explanation = explainLine.replace(/^Explain\s*:\s*/i, "").trim();
      }
    }

    for (const line of lines) {
      if (/^Answer\s*:/i.test(line) || /^Explain\s*:/i.test(line)) {
        continue;
      }
      const match = line.match(choiceRegex);
      if (match) {
        const letter = match[1];
        choices[letter] = applyMathTokens(match[2].trim(), mathMap);
      } else {
        questionTextLines.push(line);
      }
    }

    const hasChoices = Object.keys(choices).length > 0;
    const correctRaw = lines
      .find((l) => l.startsWith("Answer:"))
      ?.split(":")[1]
      .trim();
    const correct = applyMathTokens(correctRaw, mathMap);

    let imgPath = null;
    const imageExtensions = [
      "png",
      "jpg",
      "jpeg",
      "svg",
      "webp",
      "gif",
      "bmp",
      "avif",
    ];

    const imageCandidates = [
      `Q${index + 1}`,
      `${index + 1}`,
    ].flatMap((base) => imageExtensions.map((ext) => `${base}.${ext}`));

    for (const name of imageCandidates) {
      const fullImg = path.join(folderPath, name);
      if (fs.existsSync(fullImg)) {
        imgPath = "/tests/" + folder + "/" + name;
        break;
      }
    }

    return {
      id: index + 1,
      question: applyMathTokens(questionTextLines.join("\n"), mathMap),
      choices: hasChoices ? choices : null,
      correct,
      type: hasChoices ? "multiple_choice" : "grid",
      image: imgPath,
      explanation: applyMathTokens(explanation, mathMap),
    };
  });

  return {
    file: folder,
    questions,
  };
}

module.exports = { parseTestFile };