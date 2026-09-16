import fs from "node:fs";
fs.copyFileSync("data/matrix.json", "docs/matrix.json");
console.log("copied data/matrix.json -> docs/matrix.json");
