#!/usr/bin/env node
// PostToolUse hook. Measures AGENTS.md against this repo's word limits and
// reports when it is over. Thresholds come from argv, because the repos do not
// agree on them:
//
//   --warn N      the prune line. Required.
//   --ceiling N   the hard limit. Optional — omit it in a repo that states only
//                 a soft ceiling, and the hook reports without claiming a limit
//                 the project never set.
//
// Why this exists: the limit was prose in five repos and enforced in none.
// runbox-mcp's AGENTS.md reached 2,621 words against an 1,850 ceiling, 59% of
// it one section. A rule nobody measures is not a rule.
//
// Why .mjs and not .sh: hooks run on Kevin's Windows machines too, where a bash
// script needs git-bash on PATH and `python3` may be `python`. `node` is the
// same command everywhere and none of these repos can be worked on without it.
//
// PostToolUse cannot block — the write already happened — so this reports and
// pruning stays the session's job.
//
// Counting: whitespace-separated tokens, which agrees with awk, node, python,
// and with `wc -w` on any UTF-8 machine. `wc -w` with no locale set silently
// drops standalone em dashes, so a container can report ~2% low on prose that
// uses them. If this number ever looks wrong, check `locale` before the hook.

import { readFileSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const WARN = flag("warn");
const CEILING = flag("ceiling"); // null => warn-only repo
if (WARN === null) process.exit(0); // Misconfigured: stay silent, never fail a tool call.

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const raw = payload?.tool_input?.file_path;
if (typeof raw !== "string" || raw.length === 0) process.exit(0);

// CLAUDE.md is a symlink to AGENTS.md; a write through either path lands here.
let target;
try {
  target = realpathSync(resolve(payload.cwd ?? process.cwd(), raw));
} catch {
  process.exit(0); // Deleted or unreadable — nothing to measure.
}
if (basename(target) !== "AGENTS.md") process.exit(0);

let words;
try {
  words = readFileSync(target, "utf8").split(/\s+/).filter(Boolean).length;
} catch {
  process.exit(0);
}

if (words <= WARN) process.exit(0);

const over = CEILING !== null && words > CEILING;
const headline = over
  ? `AGENTS.md is ${words} words — over the ${CEILING} ceiling by ${words - CEILING}.`
  : CEILING !== null
    ? `AGENTS.md is ${words} words — past the ${WARN}-word prune line, ${CEILING - words} from the ceiling.`
    : `AGENTS.md is ${words} words — past the ${WARN}-word prune line.`;

const advice = over
  ? "This is a hard ceiling. Prune before you finish: move anything a session will not need in its first four minutes into docs/ or a path-scoped rule under .claude/rules/, leaving a pointer that says when to go read it. Reference files under docs/ have no length limit, so moving detail there costs nothing. Do not end the turn over the ceiling without saying what you cut or why you could not."
  : "Anything added from here should pay for its space by trimming something that failed the four-minute test. Reference files under docs/ have no length limit — moving detail there is free.";

process.stdout.write(
  JSON.stringify({
    systemMessage: headline,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `${headline} ${advice}`,
    },
  }),
);
