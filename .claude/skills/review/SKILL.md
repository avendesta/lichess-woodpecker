---
name: review
description: Run the code-reviewer subagent in a fresh context on the pending changes (or a commit range) and report its findings. Use before committing code, or any time you want an independent second look.
---

Argument (optional): a commit range such as `500ea16..HEAD`, or files. With none, the pending changes (or the last commit when nothing is pending).

1. Launch the `code-reviewer` subagent (Agent tool, `subagent_type: "code-reviewer"`) with the scope above. It starts with no memory of this conversation, which is the point.
2. When it returns, show its findings to the user ranked by severity, with its `## Review Summary`.
3. If the verdict is **BLOCK**, fix every CRITICAL and HIGH finding (or say why not) and run the reviewer again on the fix: only a review that ends APPROVE or APPROVE WITH NOTES, of exactly the code you commit, unlocks the commit hook. List the MEDIUM and LOW findings for the user.

A commit hook blocks `git commit` of code the reviewer has not seen; finishing a review with its summary is what unlocks it.
