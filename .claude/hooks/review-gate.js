#!/usr/bin/env node
/**
 * Review gate: no commit of code that has not been through the code-reviewer subagent.
 *
 *   gate   (PreToolUse, Bash)           if the command runs `git commit` and the code files differ from what was last
 *                                       reviewed, deny it with a reason that sends Claude to the code-reviewer subagent.
 *   start  (SubagentStart, code-reviewer)  remember the code as it is NOW: that is what the reviewer is about to read.
 *   mark   (SubagentStop, code-reviewer)   record that code as reviewed, but only if the reviewer ended with its
 *                                       "## Review Summary" and its last "Verdict:" line says APPROVE (not BLOCK, not missing).
 *                                       The report is read from the event, or from the reviewer's transcript (a real stop event
 *                                       did not carry it).
 *                                       A crashed run, an empty run and a review that found something to fix do not unlock a commit.
 *
 * "Reviewed" is a hash of the CONTENT of the code files in the working tree (not a commit id): a commit is usually made as
 * `git add -A && git commit` in one command, so the index is still empty when this runs, and re-committing the same content
 * needs no second review. Manifests and package.json are hashed without their "version", so a release bump alone is not a
 * code change. Because the hash is taken when the reviewer STARTS, an edit made while it runs is not credited to it.
 *
 * Known limits (documented in CLAUDE.md): a review of only part of the code still marks all of it (the hook cannot know the
 * scope); a commit aimed at another repository is judged by this project's code; a commit hidden in a backtick or $(...)
 * substitution is not seen.
 *
 * It must never wedge normal work: any error, an unreadable input or a directory that is not a git repository lets things
 * through. Escape hatch: WP_SKIP_REVIEW=1 as a prefix of the commit command (`WP_SKIP_REVIEW=1 git commit ...`).
 *
 * State lives in .claude/.review-state.json and .claude/.review-pending.json (git-ignored, local). Dependency-free.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// What counts as code: what ships, the tests and scripts that guard it, the pipeline, and the files that make up this gate and
// its reviewer. Docs, listings, images and lock files do not.
const CODE = /^(background\.js|browser-polyfill\.js|generate-icons\.js|content\.(js|css)|popup\.(html|js|css)|options\.(html|js|css)|manifest(-firefox)?\.json|package\.json|playwright\.config\.js|scripts\/.+|tests\/.+\.js|\.github\/workflows\/.+|\.mcp\.json|\.claude\/(settings\.json|playwright-mcp\.json|hooks\/.+|agents\/.+|skills\/.+))$/;
const VERSIONED = /^(manifest(-firefox)?|package)\.json$/;
const STALE_MS = 30 * 60 * 1000; // a recorded start older than this is ignored

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const statePath = path.join(projectDir, ".claude", ".review-state.json");
const pendingPath = path.join(projectDir, ".claude", ".review-pending.json");

function codeHash() {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: projectDir, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })
    .toString().split("\0").filter(Boolean);
  const hash = crypto.createHash("sha256");
  for (const file of listed.filter((f) => CODE.test(f)).sort()) {
    let content;
    try { content = fs.readFileSync(path.join(projectDir, file)); } catch (_) { continue; } // deleted in the working tree
    if (VERSIONED.test(file)) {
      try { const m = JSON.parse(content.toString("utf8")); delete m.version; content = Buffer.from(JSON.stringify(m)); } catch (_) { /* hash it as it is */ }
    }
    hash.update(file).update("\0").update(content).update("\0");
  }
  return hash.digest("hex");
}

function readJson(file) {
  try { const v = JSON.parse(fs.readFileSync(file, "utf8")); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch (_) { return null; }
}

function readEvent() {
  try { const e = JSON.parse(fs.readFileSync(0, "utf8")); return e && typeof e === "object" ? e : {}; } catch (_) { return {}; }
}

// ---- Is `git commit` actually run by this command? ----
// Not just mentioned in an echo, a grep or a commit message. Each part of a pipeline or && chain is read on its own: after
// any leading VAR=value words and wrappers (env, command, then, ( ...), `git`, its options (-C dir, -c k="a b", --git-dir x,
// --no-pager), then `commit` (and not commit-graph or commit-tree). `sh -c "..."` is looked into.
const VAL = `(?:"[^"]*"|'[^']*'|[^\\s"'])+`;
const GIT_OPTS = `(?:\\s+(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)(?:\\s+|=)${VAL}|\\s+--?[A-Za-z][\\w-]*(?:=${VAL})?)*`;
const GIT_COMMIT = new RegExp(`^\\\\?(?:\\S*/)?git${GIT_OPTS}\\s+commit(?![\\w-])`);
const ASSIGNMENT = new RegExp(`^(\\w+)=(${VAL}|)(?:\\s+|$)`);
const SHELL_C = /^(?:ba|z|da)?sh\s+-\w*c\w*\s+(["'])([\s\S]*)\1\s*$/;

// The body of a heredoc (<<EOF ... EOF) is text handed to a command, not commands: drop it. The line that opens it stays (a commit can
// follow the operator on that line), and a `<<` inside quotes, or the here-string `<<<`, is not a heredoc.
function stripHeredocs(command) {
  let out = "";
  let quote = null;
  let pending = []; // delimiters opened on the current line, whose bodies start after it
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      out += c;
      if (c === "\\" && quote === '"' && i + 1 < command.length) out += command[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) { out += c + command[++i]; continue; }
    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    if (c === "#" && (out === "" || /\s$/.test(out))) { // a comment runs to the end of the line: a `<<` in it opens nothing
      while (i < command.length && command[i] !== "\n") out += command[i++];
      i--;
      continue;
    }
    if (c === "<" && command[i + 1] === "<" && command[i + 2] !== "<" && command[i - 1] !== "<") {
      const m = /^<<-?[ \t]*(["']?)([A-Za-z_]\w*)\1/.exec(command.slice(i));
      if (m) { pending.push(m[2]); out += m[0]; i += m[0].length - 1; continue; }
    }
    if (c === "\n" && pending.length) {
      out += c;
      let pos = i + 1;
      for (const delimiter of pending) {
        const end = new RegExp(`^[ \\t]*${delimiter}[ \\t]*$`, "m").exec(command.slice(pos));
        if (!end) { pos = command.length; break; } // no terminator: all the rest is body
        pos += end.index + end[0].length;
      }
      pending = [];
      i = pos - 1;
      continue;
    }
    out += c;
  }
  return out;
}

// Split on ; & && | || and newlines, but only where they are not inside '...' or "...": a separator in a commit message or an
// echo does not start a new command.
function splitCommands(command) {
  const parts = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"' && i + 1 < command.length) cur += command[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) { cur += c + command[++i]; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === "#" && (cur === "" || /\s$/.test(cur))) { while (i + 1 < command.length && command[i + 1] !== "\n") i++; continue; } // a comment runs to the end of the line
    if (c === ";" || c === "\n" || c === "&" || c === "|") {
      parts.push(cur);
      cur = "";
      if ((c === "&" || c === "|") && command[i + 1] === c) i++; // && and ||
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

// The short options of each wrapper that take an argument (`sudo -u me git ...`, `xargs -n 1 git ...`); any other option word stands alone.
const WRAPPER_ARG_OPTS = { sudo: "ughpCDRrtUT", env: "uCS", xargs: "nPILsdEa", nice: "n", timeout: "sk", time: "fo", ionice: "cnp" };
function skipWrapperOptions(name, rest) {
  let r = rest;
  for (;;) {
    const o = r.match(/^(-[A-Za-z-]\S*)\s+/);
    if (!o) break;
    r = r.slice(o[0].length);
    if (/^-[A-Za-z]$/.test(o[1]) && (WRAPPER_ARG_OPTS[name] || "").includes(o[1][1])) r = r.replace(/^\S+\s+/, ""); // this option takes an argument
  }
  return name === "timeout" ? r.replace(/^\d+[smhd]?\s+/, "") : r; // timeout's duration
}

function commitsIn(command, depth = 0) {
  const found = []; // { skip: boolean }
  for (let part of splitCommands(stripHeredocs(command).replace(/\\\r?\n/g, " "))) { // a backslash before a newline continues the line
    part = part.trim().replace(/^(?:[({!]+\s*|(?:if|then|do|else|elif|while|until)\s+)+/, "");
    const assigned = [];
    for (;;) {
      const m = part.match(ASSIGNMENT);
      if (m) { assigned.push([m[1], m[2]]); part = part.slice(m[0].length); continue; }
      const redirect = part.match(/^\d*[<>]+&?\S*\s+/); // 2>/dev/null git commit
      if (redirect) { part = part.slice(redirect[0].length); continue; }
      const w = part.match(/^(env|command|exec|nohup|time|sudo|xargs|nice|timeout|ionice)\s+/);
      if (w) { part = skipWrapperOptions(w[1], part.slice(w[0].length)); continue; }
      break;
    }
    const sh = part.match(SHELL_C);
    if (sh && depth < 3) { found.push(...commitsIn(sh[2], depth + 1)); continue; }
    if (GIT_COMMIT.test(part)) found.push({ skip: assigned.some(([k, v]) => k === "WP_SKIP_REVIEW" && v === "1") });
  }
  return found;
}

function gate(event) {
  const command = event.tool_input && typeof event.tool_input.command === "string" ? event.tool_input.command : "";
  const commits = commitsIn(command);
  if (!commits.length) return;
  if (process.env.WP_SKIP_REVIEW === "1" || commits.every((c) => c.skip)) return;
  const current = codeHash(); // before reading the state: outside a git repository this throws, and the gate lets the commit through
  const state = readJson(statePath);
  if (state && state.hash === current) return; // this exact code was reviewed
  const reason = [
    "Review gate: the code you are about to commit has not been reviewed yet.",
    "Run the code-reviewer subagent (Agent tool, subagent_type \"code-reviewer\") on these changes: tell it the scope (the pending changes, or a commit range if they are already committed).",
    "If its verdict is BLOCK, fix every CRITICAL and HIGH finding and run the reviewer again on the fix: only a review that ends APPROVE or APPROVE WITH NOTES, of exactly the code you commit, unlocks the commit.",
    "Tell the user the MEDIUM and LOW findings.",
    "If the user asked you to skip the review, put WP_SKIP_REVIEW=1 in front of the commit command (WP_SKIP_REVIEW=1 git commit ...).",
  ].join(" ");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
}

// The last "Verdict:" line, with any markdown decoration (**bold**, `code`, "- ", "> ") taken off. Credit a review only if that line says
// APPROVE and does not also say BLOCK (a verdict line that lists every option is the template copied, not a verdict).
function approved(message) {
  const lines = message.split("\n").map((l) => l.replace(/[*_`]/g, "").replace(/^[\s>\-•]+/, ""));
  const verdict = lines.filter((l) => /^verdict:/i.test(l)).pop();
  return !!verdict && /^verdict:\s*APPROVE\b/i.test(verdict) && !/\bBLOCK\b/i.test(verdict);
}

// The reviewer's final report. The SubagentStop event is documented to carry it (last_assistant_message) but, in a real run, did not;
// it does carry agent_transcript_path, the subagent's own transcript (JSON lines). Its last assistant record holds the report either
// as plain text or, as it really arrives, as the message of a call to the SubagentHandback tool.
function finalReport(event) {
  if (typeof event.last_assistant_message === "string" && event.last_assistant_message) return event.last_assistant_message;
  const file = event.agent_transcript_path;
  if (typeof file !== "string" || !file) return "";
  let last = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch (_) { continue; }
    if (record && record.message && record.message.role === "assistant") last = record.message;
  }
  if (!last) return "";
  const content = last.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && b.type === "text" && typeof b.text === "string" ? b.text : b && b.type === "tool_use" && b.input && typeof b.input.message === "string" ? b.input.message : "")).filter(Boolean).join("\n");
}

function start(event) {
  if (event.agent_type !== "code-reviewer") return;
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify({ hash: codeHash(), startedAt: Date.now() }) + "\n");
}

function mark(event) {
  if (event.agent_type !== "code-reviewer") return;
  const pending = readJson(pendingPath);
  try { fs.unlinkSync(pendingPath); } catch (_) { /* none */ }
  let message = "";
  try { message = finalReport(event); } catch (_) { /* unreadable transcript: nothing to credit */ }
  if (!message.includes("## Review Summary")) return; // it did not finish
  if (!approved(message)) return; // BLOCK (it found something to fix: the fix needs its own review), a missing verdict, or anything unclear
  const startedHash = pending && typeof pending.hash === "string" && Date.now() - Number(pending.startedAt) < STALE_MS ? pending.hash : null;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ hash: startedHash || codeHash(), reviewedAt: new Date().toISOString() }, null, 2) + "\n");
}

try {
  const mode = process.argv[2];
  const event = readEvent();
  if (mode === "gate") gate(event);
  else if (mode === "start") start(event);
  else if (mode === "mark") mark(event);
} catch (_) {
  // fail open: a bug here must never block a commit
}
process.exit(0);
