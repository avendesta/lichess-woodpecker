/**
 * Zero-dep sanity check: JS syntax, manifest parity (Chrome MV3 vs Firefox MV2),
 * store description limit, and package file lists agreeing.
 * Usage: node scripts/check.js
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const errors = [];
const fail = (msg) => errors.push(msg);

// 1. Syntax
const jsFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith(".js"))
  .concat(fs.readdirSync(path.join(ROOT, "scripts")).map((f) => `scripts/${f}`), fs.readdirSync(path.join(ROOT, "tests")).map((f) => `tests/${f}`))
  .filter((f) => f.endsWith(".js"));
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, f)], { stdio: "pipe" });
  } catch (e) {
    fail(`syntax error in ${f}:\n${e.stderr}`);
  }
}

// 2. Manifest parity
const chrome = JSON.parse(read("manifest.json"));
const ff = JSON.parse(read("manifest-firefox.json"));
const pkg = JSON.parse(read("package.json"));
for (const key of ["name", "version", "description", "permissions", "icons", "content_scripts", "options_ui"]) {
  if (JSON.stringify(chrome[key]) !== JSON.stringify(ff[key])) fail(`manifest.json and manifest-firefox.json differ on "${key}"`);
}
if (pkg.version !== chrome.version) fail(`package.json version ${pkg.version} != manifest ${chrome.version}`);
const readmeVersions = [...read("README.md").matchAll(/-v(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
const staleInReadme = [...new Set(readmeVersions)].filter((v) => v !== chrome.version);
if (staleInReadme.length) fail(`README.md names stale version(s) ${staleInReadme.join(", ")}; current is ${chrome.version}`);
if (chrome.description.length > 132) fail(`description is ${chrome.description.length} chars (Chrome Web Store limit 132)`);
if (!ff.browser_specific_settings?.gecko?.id) fail("manifest-firefox.json missing browser_specific_settings.gecko.id");
// The overlay runs on exactly one origin: https://lichess.org (no http, no subdomains). Anything broader is access the extension does not
// need, and would not match what the privacy policy and the store listings say.
for (const [name, m] of [["manifest.json", chrome], ["manifest-firefox.json", ff]]) {
  const matches = (m.content_scripts || []).flatMap((c) => c.matches);
  if (JSON.stringify(matches) !== JSON.stringify(["https://lichess.org/training/*"])) fail(`${name}: content script matches must be exactly ["https://lichess.org/training/*"], found ${JSON.stringify(matches)}`);
}
// The background is the only writer of the library (lichessNotes): it applies changes one at a time, which is what stops two
// near-simultaneous read-modify-write cycles from throwing each other's changes away. Pages and the overlay send messages.
for (const f of ["popup.js", "options.js", "content.js"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (/\.set\(\s*\{\s*lichessNotes\b/.test(src)) fail(`${f} writes lichessNotes directly; send a message to background.js instead (it is the only writer)`);
  // the parked map of paused cycles is the same: a stale read-modify-write there could drop another category's cycle
  if (/storage\.local\.(set|remove)\(\s*(\{[^}]*)?(["']pausedCycles["']|pausedCycles\b|\[PARKED_KEY\]|PARKED_KEY)/.test(src)) fail(`${f} writes pausedCycles directly; send PARK_CYCLE / UNPARK_CYCLE / START_SESSION to background.js instead`);
}
// Mozilla requires every new extension to declare what data it collects (from 3 Nov 2025), and once a version declares it every later one must too.
if (!Array.isArray(ff.browser_specific_settings?.gecko?.data_collection_permissions?.required)) fail("manifest-firefox.json missing browser_specific_settings.gecko.data_collection_permissions.required (AMO rejects new add-ons without it; use [\"none\"] if nothing is collected)");
if (chrome.manifest_version !== 3 || ff.manifest_version !== 2) fail("expected Chrome MV3 and Firefox MV2");
if (JSON.stringify(chrome.action) !== JSON.stringify(ff.browser_action)) fail("action (MV3) and browser_action (MV2) differ");

// 3. Files referenced by the manifest exist
const refs = [chrome.background.service_worker, ...ff.background.scripts, chrome.action.default_popup, chrome.options_ui.page,
  ...Object.values(chrome.icons), ...chrome.content_scripts.flatMap((c) => [...c.js, ...c.css])];
for (const r of refs) if (!fs.existsSync(path.join(ROOT, r))) fail(`manifest references missing file: ${r}`);

// 4. Chrome and Firefox packages ship the same files (modulo manifest)
const include = (f) => [...read(f).match(/const INCLUDE = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const norm = (l) => l.filter((x) => !x.startsWith("manifest")).sort().join(",");
if (norm(include("scripts/package.js")) !== norm(include("scripts/package-firefox.js"))) fail("package.js and package-firefox.js INCLUDE lists differ");

// 5. Everything the manifest and the pages load must actually ship, or the store build would show broken images
const shipped = new Set(include("scripts/package.js"));
const needed = new Set([...Object.values(chrome.icons), ...Object.values(chrome.action.default_icon)]);
for (const page of ["popup.html", "options.html"]) {
  for (const m of read(page).matchAll(/\b(?:src|href)="([^"#?]+)"/g)) {
    if (!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(m[1])) needed.add(m[1]); // local files only, not links to other sites
  }
}
for (const file of needed) {
  if (!fs.existsSync(path.join(ROOT, file))) fail(`a page or the manifest loads ${file}, which does not exist`);
  else if (!shipped.has(file)) fail(`${file} is loaded by the manifest or a page but is missing from the INCLUDE list, so the packaged extension would not contain it`);
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${jsFiles.length} JS files parse, manifests in sync (v${chrome.version}), packages consistent`);
