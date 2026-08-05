const fs = require("fs");
const path = require("path");

const testsDir = path.join(__dirname, "..", "..", "tests");
const CATEGORY_DIRS = {
  real_tests: path.join(testsDir, "real_tests"),
  practice_tests: path.join(testsDir, "practice_tests"),
  starter: path.join(testsDir, "starter"),
  cramming: path.join(testsDir, "cramming"),
  math: path.join(testsDir, "math"),
  math_cramming: path.join(testsDir, "math_cramming"),
};

function listCategory(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  return fs
    .readdirSync(dirPath)
    .filter((name) => fs.statSync(path.join(dirPath, name)).isDirectory());
}

function getCategoryTotals() {
  return Object.fromEntries(
    Object.entries(CATEGORY_DIRS).map(([key, dirPath]) => [
      key,
      listCategory(dirPath).length,
    ])
  );
}

function getAllTests() {
  return Object.fromEntries(
    Object.entries(CATEGORY_DIRS).map(([key, dirPath]) => [
      key,
      listCategory(dirPath),
    ])
  );
}

module.exports = {
  CATEGORY_DIRS,
  testsDir,
  listCategory,
  getCategoryTotals,
  getAllTests,
};