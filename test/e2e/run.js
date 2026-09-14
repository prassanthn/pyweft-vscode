// Launches the installed VS Code with this extension in development mode and
// the user's own extensions (so Pylance is present), runs test/e2e/index.js
// inside it, and prints the JSON it writes. Usage: npm run test:e2e
//
// A VS Code window opens for the duration of the run. It uses a throwaway
// user-data-dir so your settings and window state are untouched.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const workspace = process.argv[2] || path.join(root, "..", "python_framework", "examples", "todo");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "pyweft-e2e-"));
const outFile = path.join(userData, "results.json");

const args = [
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${path.join(__dirname, "index.js")}`,
  `--user-data-dir=${userData}`,
  "--disable-workspace-trust",
  "--skip-welcome",
  "--skip-release-notes",
  "--new-window",
  workspace,
];
const child = spawn(process.platform === "win32" ? "code.cmd" : "code", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, PYWEFT_E2E_OUT: outFile },
});

const started = Date.now();
const timer = setInterval(() => {
  if (fs.existsSync(outFile)) {
    clearInterval(timer);
    const results = JSON.parse(fs.readFileSync(outFile, "utf8"));
    console.log(JSON.stringify(results, null, 2));
    try { child.kill(); } catch {}
    process.exit(results.pass ? 0 : 1);
  } else if (Date.now() - started > 180000) {
    clearInterval(timer);
    console.error("e2e: timed out waiting for results");
    try { child.kill(); } catch {}
    process.exit(1);
  }
}, 1000);
