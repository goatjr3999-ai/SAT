const fs = require("fs");
const path = require("path");
const { testsDir } = require("./tests");

const metaCache = new Map();

function countQuestions(text = "") {
  const matches = text.match(/Question\s+\d+:/g);
  return matches ? matches.length : 0;
}

function getTestMeta(category, name) {
  const cacheKey = `${category}/${name}`;
  if (metaCache.has(cacheKey)) {
    return metaCache.get(cacheKey);
  }

  const folderPath = path.join(testsDir, category, name);
  if (!fs.existsSync(folderPath)) {
    const fallback = { questionCount: 0, timeMinutes: 0 };
    metaCache.set(cacheKey, fallback);
    return fallback;
  }

  const files = fs.readdirSync(folderPath);
  const txtFile = files.find((file) => file.toLowerCase().endsWith(".txt"));
  if (!txtFile) {
    const fallback = { questionCount: 0, timeMinutes: 0 };
    metaCache.set(cacheKey, fallback);
    return fallback;
  }

  const content = fs.readFileSync(path.join(folderPath, txtFile), "utf8");
  const questionCount = countQuestions(content);
  const timeMinutes = questionCount;
  const meta = { questionCount, timeMinutes };

  metaCache.set(cacheKey, meta);
  return meta;
}

module.exports = { getTestMeta };