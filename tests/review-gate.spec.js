const { test, expect } = require("@playwright/test");
const { spawnSync, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The review gate (.claude/hooks/review-gate.js) stops a `git commit` of code that has not been through the code-reviewer
// subagent. It is run here the way Claude Code runs a hook: a JSON event on stdin, the project dir in CLAUDE_PROJECT_DIR.
// No browser involved: a throwaway git repo holds a few "code" and "not code" files.

const SCRIPT = path.join(__dirname, "..", ".claude", "hooks", "review-gate.js");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString();
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  write("background.js", "const a = 1;\n");
  write("popup.js", "const b = 2;\n");
  write("manifest.json", JSON.stringify({ name: "x", version: "1.0.0", permissions: ["storage"] }, null, 2));
  write("README.md", "# readme\n");
  write("tests/a.spec.js", "// test\n");
  write(".gitignore", ".claude/.review-state.json\n");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  return { dir, write, git, state: () => { try { return JSON.parse(fs.readFileSync(path.join(dir, ".claude", ".review-state.json"), "utf8")); } catch (_) { return null; } } };
}

function run(repo, mode, event, env = {}) {
  const r = spawnSync("node", [SCRIPT, mode], { cwd: repo.dir, input: typeof event === "string" ? event : JSON.stringify(event), env: { ...process.env, WP_SKIP_REVIEW: "", CLAUDE_PROJECT_DIR: repo.dir, ...env }, encoding: "utf8" });
  let out = null;
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch (_) { out = { unparsable: r.stdout }; }
  return { code: r.status, out, stderr: r.stderr };
}
const commit = (command = 'git add -A && git commit -q -m "feature"') => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
const reviewerDone = (message = "Found nothing serious.\n\n## Review Summary\n\n| Severity | Count |\n|---|---|\n| CRITICAL | 0 |\n\nScope reviewed: pending changes\nVerdict: APPROVE") => ({ hook_event_name: "SubagentStop", agent_type: "code-reviewer", last_assistant_message: message });
const reviewerStarted = () => ({ hook_event_name: "SubagentStart", agent_type: "code-reviewer" });
const denied = (r) => r.out && r.out.hookSpecificOutput && r.out.hookSpecificOutput.permissionDecision === "deny";
const allowed = (r) => r.code === 0 && !denied(r);

test("a command that is not a commit is never touched", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 99;\n"); // unreviewed code change
  for (const command of ["git status", "git diff", "npm test", "git log --oneline -3", "echo git commit is only text here > /dev/null", 'grep -n "git commit" CLAUDE.md', "git log --grep='git commit' -1", 'git add -A && git status | head -3', 'git commit-graph write', 'git commit-tree HEAD^{tree} -m x', 'echo "(git commit)"', 'git log commit', 'git show HEAD:commit.txt', 'echo done > git-commit.txt',
    // text that merely contains a separator followed by "git commit": inside quotes, or in the body of a heredoc
    'echo "a; git commit -m x"', "echo 'x && git commit -m y'", 'grep -n "run; git commit" notes.md', "python3 - <<'EOF'\nprint('docs say: do this; git commit -m x')\ngit commit -m y\nEOF",
    "cat <<EOF > notes.txt\nfirst; git commit -m x\ngit commit -m y\nEOF", 'echo "don\'t; git commit"',
    'echo hi # x; git commit -m y', 'echo "a" # commented out: git commit -m x']) {
    expect(allowed(run(repo, "gate", commit(command))), command).toBe(true);
  }
  // ...while real commits, written the ways they are really written, are all recognised
  for (const command of ['git commit -q -m "x"', 'git add -A && git commit -q -F - <<EOF\nmsg\nEOF', 'cd /tmp && git commit -am x', 'git -C . commit -m x', 'FOO=1 git commit -m x', 'npm test; git commit -m x', 'git add -A\ngit commit -m x',
    'git -c user.name="A B" commit -m x', 'git -C "my dir" commit -m x', 'FOO="a b" git commit -m x', 'git --git-dir x commit -m x', 'git --no-pager commit -m x', '(git commit -m x)', 'if true; then git commit -m x; fi',
    'env git commit -m x', 'command git commit -m x', 'sh -c "git commit -m x"', 'bash -lc \'git add -A && git commit -m x\'', 'npm test & git commit -m x', 'git commit --amend --no-edit',
    "cat <<EOF > notes.txt\nbody; with git commit text\nEOF\ngit commit -m x", 'git add -A && git commit -m "fix: a; b && c" && git push', 'cat <<< "hello"\ngit commit -m x',
    // line continuations, other ways of naming git, a heredoc operator inside quotes, the usual message-in-a-heredoc shape, comments
    'git add -A && \\\ngit commit -m x', 'git \\\n  commit -m x', 'git add -A \\\n  && git commit -m x', '/usr/bin/git commit -m x', '\\git commit -m x', 'sudo git commit -m x', 'xargs git commit -m x',
    'echo "a <<EOF"\ngit commit -m x', 'git commit -m "$(cat <<\'EOF\'\nmsg; with git commit text\nEOF\n)"', 'git commit -m "#123 fix"', 'git commit -m x # note',
    // a heredoc operator in a comment or in arithmetic must not swallow the commit after it; redirects and wrapper options before git
    '# see <<EOF\ngit commit -m x', 'echo $((1<<3))\ngit commit -m x', '2>/dev/null git commit -m x', '>/dev/null git commit -m x', 'sudo -u me git commit -m x', 'env -i git commit -m x', 'xargs -n 1 git commit -m x',
    'time -p git commit -m x', 'timeout 5 git commit -m x', 'nice git commit -m x', 'nice -n 5 git commit -m x', 'FOO=1 sudo -E git commit -m x', "git commit -m 'it is a single-quoted message'"]) {
    expect(denied(run(repo, "gate", commit(command))), command).toBe(true);
  }
});

test("a commit of code nobody has reviewed is stopped, and the reason sends Claude to the code-reviewer subagent", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  const r = run(repo, "gate", commit());
  expect(denied(r), JSON.stringify(r.out)).toBe(true);
  const why = r.out.hookSpecificOutput.permissionDecisionReason;
  expect(why).toContain("code-reviewer");
  expect(why).toMatch(/CRITICAL|HIGH/);
  expect(why).toContain("WP_SKIP_REVIEW=1");
});

test("after the reviewer finishes with a summary, the same commit goes through", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  expect(denied(run(repo, "gate", commit()))).toBe(true);
  const marked = run(repo, "mark", reviewerDone());
  expect(marked.code).toBe(0);
  expect(repo.state(), "the reviewed state was recorded").toHaveProperty("hash");
  expect(allowed(run(repo, "gate", commit()))).toBe(true);
});

test("a reviewer that ended without its Review Summary does not count as a review", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  for (const message of ["", "I ran out of steps.", "Looks fine to me"]) run(repo, "mark", reviewerDone(message));
  run(repo, "mark", { hook_event_name: "SubagentStop", agent_type: "code-reviewer" }); // no message at all
  expect(repo.state(), "nothing recorded").toBeNull();
  expect(denied(run(repo, "gate", commit()))).toBe(true);
  run(repo, "mark", { hook_event_name: "SubagentStop", agent_type: "Explore", last_assistant_message: "## Review Summary" }); // some other subagent
  expect(repo.state(), "only the code-reviewer counts").toBeNull();
});

test("after a review, changing code again needs another review", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  run(repo, "mark", reviewerDone());
  expect(allowed(run(repo, "gate", commit()))).toBe(true);
  repo.write("popup.js", "const b = 3;\n"); // changed after the review
  expect(denied(run(repo, "gate", commit()))).toBe(true);
  repo.write("popup.js", "const b = 2;\n"); // put back exactly as reviewed
  expect(allowed(run(repo, "gate", commit())), "same content as reviewed: fine").toBe(true);
});

test("the skip switch only counts as a prefix of the commit itself, not as text that happens to appear in the command", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  for (const command of ['git commit -m "mentions WP_SKIP_REVIEW=1 here"', "echo WP_SKIP_REVIEW=1 && git commit -m x", "git commit -m x # WP_SKIP_REVIEW=1", "export WP_SKIP_REVIEW=1; git commit -m x"]) {
    expect(denied(run(repo, "gate", commit(command))), command).toBe(true);
  }
  for (const command of ["WP_SKIP_REVIEW=1 git commit -m x", 'git add -A && WP_SKIP_REVIEW=1 git commit -m "x y"', "FOO=1 WP_SKIP_REVIEW=1 git commit -m x"]) {
    expect(allowed(run(repo, "gate", commit(command))), command).toBe(true);
  }
});

test("a review that ends in BLOCK does not unlock the commit; after the fix, a clean re-review does", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  const blocked = "[HIGH] a bug\nFile: background.js:1\n\n## Review Summary\n\n| HIGH | 1 |\n\nScope reviewed: pending changes\nVerdict: BLOCK (fix CRITICAL/HIGH first)";
  run(repo, "mark", reviewerDone(blocked));
  expect(repo.state(), "a BLOCK is not a review that unlocks anything").toBeNull();
  expect(denied(run(repo, "gate", commit()))).toBe(true);
  repo.write("background.js", "const a = 3; // the fix\n");
  run(repo, "mark", reviewerDone()); // the re-review of the fixed code, clean
  expect(allowed(run(repo, "gate", commit()))).toBe(true);
  run(repo, "mark", reviewerDone("## Review Summary\n\nVerdict: APPROVE WITH NOTES"));
  expect(repo.state(), "notes alone do not block").toHaveProperty("hash");
});

test("only a clear APPROVE verdict unlocks: BLOCK in any formatting, no verdict, or a verdict that lists every option does not", async () => {
  const withVerdict = (line) => `Findings.\n\n## Review Summary\n\n| HIGH | 1 |\n\nScope reviewed: pending changes\n${line}`;
  for (const line of ["Verdict: BLOCK (fix CRITICAL/HIGH first)", "**Verdict: BLOCK**", "- Verdict: BLOCK", "Verdict: **BLOCK**", "  `Verdict: BLOCK`", "> Verdict: block", "Verdict: APPROVE | APPROVE WITH NOTES | BLOCK", "", "No verdict line at all", "Verdict: unsure", "Verdict: Do not APPROVE", "Verdict: cannot APPROVE yet", "Verdict: not an APPROVE"]) {
    const repo = makeRepo();
    repo.write("background.js", "const a = 2;\n");
    run(repo, "mark", reviewerDone(withVerdict(line)));
    expect(repo.state(), `"${line}" does not unlock`).toBeNull();
    expect(denied(run(repo, "gate", commit())), line).toBe(true);
  }
  for (const line of ["Verdict: APPROVE", "Verdict: APPROVE WITH NOTES", "**Verdict: APPROVE**", "- Verdict: **APPROVE WITH NOTES**", "verdict: approve"]) {
    const repo = makeRepo();
    repo.write("background.js", "const a = 2;\n");
    run(repo, "mark", reviewerDone(withVerdict(line)));
    expect(repo.state(), `"${line}" unlocks`).toHaveProperty("hash");
  }
});

// Claude Code's SubagentStop event does not always carry last_assistant_message (checked in a real run: it did not). It does carry
// agent_transcript_path, the subagent's own transcript, whose last assistant record is either plain text or, as the reviewer's own
// report really arrives, a call to the SubagentHandback tool with the report in input.message, followed by its tool result.
test("the reviewer's final report is read from its transcript when the stop event does not carry it", async () => {
  const summary = (verdict) => `Looked at it.\n\n## Review Summary\n\n| HIGH | 0 |\n\nScope reviewed: pending changes\nVerdict: ${verdict}`;
  const text = (t) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: t }] } });
  const handback = (t) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "SubagentHandback", input: { message: t } }] } });
  const early = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "reading files" }] } };
  const toolResult = { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } };
  const attachment = { type: "attachment", attachment: {} };
  const stopWith = (repo, records, file = "agent.jsonl") => {
    const p = path.join(repo.dir, file);
    if (records) fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return { hook_event_name: "SubagentStop", agent_type: "code-reviewer", agent_transcript_path: p, stop_hook_active: false }; // no last_assistant_message
  };
  const cases = [
    ["plain text final message", [early, text(summary("APPROVE"))], true],
    ["a SubagentHandback report, then its tool result", [early, handback(summary("APPROVE WITH NOTES")), toolResult], true],
    ["a handback followed by attachments and the tool result", [early, handback(summary("APPROVE")), attachment, toolResult], true],
    ["a handback that says BLOCK", [early, handback(summary("BLOCK (fix CRITICAL/HIGH first)")), toolResult], false],
    ["a final message with no summary", [early, text("I got lost, sorry")], false],
    ["a summary only in an EARLIER message", [text(summary("APPROVE")), handback("never mind, ran out of steps"), toolResult], false],
    ["an empty transcript", [], false],
  ];
  for (const [what, records, unlocks] of cases) {
    const repo = makeRepo();
    repo.write("background.js", "const a = 2;\n");
    run(repo, "mark", stopWith(repo, records));
    expect(repo.state() !== null, what).toBe(unlocks);
    expect(allowed(run(repo, "gate", commit())), `${what}: the gate agrees`).toBe(unlocks);
  }
  // no readable transcript at all: nothing is credited
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  run(repo, "mark", stopWith(repo, null, "does-not-exist.jsonl"));
  run(repo, "mark", { hook_event_name: "SubagentStop", agent_type: "code-reviewer" });
  expect(repo.state(), "no message and no transcript").toBeNull();
  // a message in the event still wins over the transcript
  const both = makeRepo();
  both.write("background.js", "const a = 2;\n");
  run(both, "mark", { ...stopWith(both, [text("nothing")]), last_assistant_message: summary("APPROVE") });
  expect(both.state(), "the event's own message is used when present").toHaveProperty("hash");
});

test("the start record: a stale one is ignored, a second start replaces it, and with none the code at stop time is credited", async () => {
  const pendingFile = (repo) => path.join(repo.dir, ".claude", ".review-pending.json");
  // none recorded (a start hook that never ran): the code as it is when the reviewer stops
  let repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  run(repo, "mark", reviewerDone());
  expect(allowed(run(repo, "gate", commit())), "falls back to the stop-time code").toBe(true);

  // a start older than half an hour belongs to a review that never finished: not trusted
  repo = makeRepo();
  fs.mkdirSync(path.join(repo.dir, ".claude"), { recursive: true });
  fs.writeFileSync(pendingFile(repo), JSON.stringify({ hash: "0".repeat(64), startedAt: Date.now() - 31 * 60 * 1000 }));
  repo.write("background.js", "const a = 2;\n");
  run(repo, "mark", reviewerDone());
  expect(allowed(run(repo, "gate", commit())), "the stale start was ignored").toBe(true);
  expect(fs.existsSync(pendingFile(repo)), "and it was cleaned up").toBe(false);

  // a fresh one is used, and a later start replaces an earlier one
  repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  run(repo, "start", reviewerStarted());
  repo.write("background.js", "const a = 3; // edited after the first start\n");
  run(repo, "start", reviewerStarted()); // a second review began on the newer code
  run(repo, "mark", reviewerDone());
  expect(allowed(run(repo, "gate", commit())), "the newest start counts").toBe(true);
  expect(fs.existsSync(pendingFile(repo)), "consumed by the stop").toBe(false);
});

test("what the reviewer is credited with is the code as it stood when it started, so edits made during the review stay unreviewed", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  run(repo, "start", reviewerStarted());
  repo.write("popup.js", "const b = 99; // edited while the reviewer was running\n");
  run(repo, "mark", reviewerDone());
  expect(denied(run(repo, "gate", commit())), "the late edit was not seen by the reviewer").toBe(true);
  run(repo, "start", reviewerStarted());
  run(repo, "mark", reviewerDone());
  expect(allowed(run(repo, "gate", commit())), "a review that started after the edit covers it").toBe(true);
});

test("an empty or corrupt state file just means 'not reviewed yet'", async () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo.dir, ".claude"), { recursive: true });
  for (const junk of ["", "not json", "null", "[]", '{"hash": 5}']) {
    fs.writeFileSync(path.join(repo.dir, ".claude", ".review-state.json"), junk);
    repo.write("background.js", `const a = ${junk.length};\n`);
    expect(denied(run(repo, "gate", commit())), JSON.stringify(junk)).toBe(true);
  }
});

test("a new code file, a changed test, a new script and a deleted file all count as code changes", async () => {
  const changes = [
    (r) => r.write("content.js", "// new file\n"),
    (r) => r.write("tests/a.spec.js", "// changed test\n"),
    (r) => r.write("scripts/check.js", "// script\n"),
    (r) => fs.unlinkSync(path.join(r.dir, "popup.js")),
  ];
  for (const [i, change] of changes.entries()) {
    const repo = makeRepo();
    run(repo, "mark", reviewerDone());
    expect(allowed(run(repo, "gate", commit())), `#${i}: the baseline is reviewed`).toBe(true);
    change(repo);
    expect(denied(run(repo, "gate", commit())), `#${i} is a code change`).toBe(true);
  }
});

test("the files that control the gate, the reviewer, the build and the pipeline are code too, and a release's version bump in package.json is not", async () => {
  const controlling = [".claude/settings.json", ".claude/agents/code-reviewer.md", ".claude/skills/review/SKILL.md", ".github/workflows/ci.yml", "playwright.config.js", ".mcp.json", ".claude/playwright-mcp.json"];
  for (const f of controlling) {
    const repo = makeRepo();
    run(repo, "mark", reviewerDone());
    repo.write(f, "changed\n");
    expect(denied(run(repo, "gate", commit())), f).toBe(true);
  }
  const repo = makeRepo();
  repo.write("package.json", JSON.stringify({ name: "x", version: "1.0.0", scripts: {} }, null, 2));
  run(repo, "mark", reviewerDone());
  repo.write("package.json", JSON.stringify({ name: "x", version: "1.0.1", scripts: {} }, null, 2));
  expect(allowed(run(repo, "gate", commit())), "package.json version only").toBe(true);
  repo.write("package.json", JSON.stringify({ name: "x", version: "1.0.1", scripts: { test: "evil" } }, null, 2));
  expect(denied(run(repo, "gate", commit())), "a script changed").toBe(true);
});

test("things that are not code never ask for a review: docs, listings, images, lock files", async () => {
  const repo = makeRepo();
  run(repo, "mark", reviewerDone());
  repo.write("README.md", "# changed readme\n");
  repo.write("docs/store/listing.md", "listing\n");
  repo.write("docs/screenshots/shot.png", "not really a png");
  repo.write("package-lock.json", "{}\n");
  repo.write("PRIVACY_POLICY.md", "policy\n");
  repo.write("CLAUDE.md", "notes\n");
  expect(allowed(run(repo, "gate", commit()))).toBe(true);
});

test("a release's version bump alone is not a code change, but any other manifest change is", async () => {
  const repo = makeRepo();
  run(repo, "mark", reviewerDone());
  repo.write("manifest.json", JSON.stringify({ name: "x", version: "1.0.1", permissions: ["storage"] }, null, 2)); // only the version
  expect(allowed(run(repo, "gate", commit())), "version only").toBe(true);
  repo.write("manifest.json", JSON.stringify({ name: "x", version: "1.0.1", permissions: ["storage", "tabs"] }, null, 2));
  expect(denied(run(repo, "gate", commit())), "a permission added").toBe(true);
});

test("WP_SKIP_REVIEW=1 in front of the commit is the escape hatch", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  expect(allowed(run(repo, "gate", commit('WP_SKIP_REVIEW=1 git add -A && WP_SKIP_REVIEW=1 git commit -q -m "wip"')))).toBe(true);
  expect(allowed(run(repo, "gate", commit(), { WP_SKIP_REVIEW: "1" })), "or in the environment").toBe(true);
});

test("the gate never wedges work: broken input, an unknown mode and a directory that is not a repo all let things through", async () => {
  const repo = makeRepo();
  repo.write("background.js", "const a = 2;\n");
  for (const bad of ["", "not json", "{", "null", "[]", '{"tool_input":null}', '{"tool_name":"Bash"}']) expect(allowed(run(repo, "gate", bad)), JSON.stringify(bad)).toBe(true);
  expect(run(repo, "bogus", commit()).code, "unknown mode").toBe(0);
  const plain = { dir: fs.mkdtempSync(path.join(os.tmpdir(), "nogit-")) };
  expect(allowed(run(plain, "gate", commit())), "not a git repo").toBe(true);
  expect(run(plain, "mark", reviewerDone()).code, "mark in a non-repo").toBe(0);
});
