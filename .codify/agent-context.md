# workmates — Agent Context

<!-- codify-owned: graph-agent-context v1 -->

_Generated graph context owned by `cg agentmd`. Regenerate with `cg agentmd --write` after significant changes. Workflow instructions remain owned by `cg spec render`._

## Languages

| Language | Files | Lines |
|---|---:|---:|
| typescript | 236 | 56779 |
| javascript | 15 | 1722 |
| swift | 3 | 130 |

254 source files, 58631 lines total.

## Directory map

- `electron/` — 10 files, 1129 lines (mostly javascript)
- `scripts/` — 7 files, 456 lines (mostly javascript)
- `bin/` — 1 files, 226 lines (mostly javascript)
- `server/` — 73 files, 19940 lines (mostly typescript)
- `src/` — 89 files, 23007 lines (mostly typescript)
- `test/` — 73 files, 13848 lines (mostly typescript)
- `(root)` — 1 files, 25 lines (mostly typescript)

## Build & tooling

- `package.json` — npm/node (scripts: `dev` `dev:server` `dev:desktop` `build` `typecheck` `test` `test:watch` `preview` `build:server` `build:helpers` `build:icon` `package:prep` `package` `release` `package:prep:xplat` `package:linux` `package:win` `bundle:updater` `screenshots`)

## Entry points

- no `main` entry points (library or web project)

## HTTP routes

| Method | Pattern | Handler | Where |
|---|---|---|---|
| * | `/../etc/passwd` | — | `test/relay-link.test.ts:160` |
| * | `/a/b.md` | — | `test/policy.test.ts:123` |
| * | `/api/agent/whoami` | — | `server/agents/agent-cli.ts:22` |
| * | `/api/bots` | — | `server/agents/agent-cli.ts:24` |
| * | `/api/bots` | — | `server/agents/agent-cli.ts:30` |
| * | `/api/bots` | — | `test/relay-crypto.test.ts:19` |
| * | `/api/bots` | — | `test/relay-crypto.test.ts:28` |
| * | `/api/bots` | — | `test/relay-crypto.test.ts:36` |
| * | `/api/bots` | — | `test/relay-crypto.test.ts:42` |
| * | `/api/bots` | — | `test/relay-crypto.test.ts:56` |
| * | `/api/bots` | — | `test/relay-link.test.ts:105` |
| * | `/api/bots` | — | `test/relay-link.test.ts:152` |
| * | `/api/bots` | — | `test/relay-link.test.ts:157` |
| * | `/api/bots/:id/messages` | — | `server/agents/agent-cli.ts:27` |
| * | `/api/bots/:me` | — | `server/agents/agent-cli.ts:49` |
| * | `/api/bots/:me/artifacts` | — | `server/agents/agent-cli.ts:43` |
| * | `/api/bots/:me/memory` | — | `server/agents/agent-cli.ts:41` |
| * | `/api/bots/:me/memory` | — | `server/agents/agent-cli.ts:42` |
| * | `/api/bots/:me/show` | — | `server/agents/agent-cli.ts:48` |
| * | `/api/jobs` | — | `server/agents/agent-cli.ts:38` |
| * | `/api/jobs` | — | `server/agents/agent-cli.ts:39` |
| * | `/api/pair/start` | — | `test/relay-link.test.ts:116` |
| * | `/api/rooms` | — | `server/agents/agent-cli.ts:25` |
| * | `/api/rooms` | — | `server/agents/agent-cli.ts:31` |
| * | `/api/rooms` | — | `test/relay-link.test.ts:127` |
| * | `/api/rooms` | — | `test/relay-link.test.ts:143` |
| * | `/api/rooms/:room` | — | `server/agents/agent-cli.ts:32` |
| * | `/api/rooms/:room/messages` | — | `server/agents/agent-cli.ts:28` |
| * | `/api/routines` | — | `server/agents/agent-cli.ts:34` |
| * | `/api/routines` | — | `server/agents/agent-cli.ts:35` |
| * | `/api/routines/:id` | — | `server/agents/agent-cli.ts:36` |
| * | `/api/routines/:id` | — | `server/agents/agent-cli.ts:37` |
| * | `/api/skills` | — | `server/agents/agent-cli.ts:45` |
| * | `/api/skills/:id` | — | `server/agents/agent-cli.ts:46` |
| * | `/etc/` | — | `src/components/settings/RulesPanel.tsx:46` |
| * | `/etc/hosts` | — | `test/policy.test.ts:89` |
| * | `/tmp/${name}` | — | `test/attachments.test.ts:36` |
| * | `/tmp/a` | — | `test/policy.test.ts:49` |
| * | `/tmp/a.ts` | — | `test/policy.test.ts:101` |
| * | `/tmp/att/abc.png` | — | `test/attachments.test.ts:111` |
| * | `/tmp/b` | — | `test/policy.test.ts:50` |
| * | `/tmp/c.ipynb` | — | `test/policy.test.ts:51` |
| * | `/tmp/x` | — | `test/policy.test.ts:119` |

## Load-bearing symbols (most referenced)

- `json` (function, 963 refs) — `server/index.ts:2493`
- `trim` (function, 329 refs) — `server/agents/agent-transfer.ts:123`
- `describe` (function, 214 refs) — `server/harness/registry.ts:104`
- `push` (method, 209 refs) — `server/stores/terminal.ts:149`
- `cn` (function, 204 refs) — `src/lib/cn.ts:4`
- `api` (function, 185 refs) — `src/components/chat/ConnectorCard.tsx:8`
- `bot` (method, 140 refs) — `server/stores/store.ts:305`
- `broadcast` (function, 134 refs) — `server/index.ts:402`
- `dispatch` (function, 116 refs) — `server/proxies/browser-proxy.ts:234`
- `emit` (function, 104 refs) — `server/drivers/antigravity.ts:58`
- `has` (function, 92 refs) — `server/agents/scout.ts:61`
- `say` (function, 86 refs) — `scripts/seed-demo.mjs:66`
- `from` (function, 74 refs) — `src/components/agents/Avatar.tsx:233`
- `waitFor` (function, 74 refs) — `test/helpers/chat-interactions.ts:4`
- `save` (function, 70 refs) — `src/components/chat/SecretCard.tsx:25`

## Querying this codebase

This project is indexed by Codify (SQLite + FTS5, 100% local). Prefer these over grep/file-walking — one call returns definitions, snippets, and call edges:

```bash
cg context <query>      # symbols + snippets + callers/callees + routes
cg search <text>        # instant name/full-text search
cg symbol <name>        # definition + snippet + reference count
cg impact <name> -d 3   # who breaks if this changes
cg routes [filter]      # URL pattern -> handler
cg changes              # impact radius of uncommitted edits
```

All of the above accept `--json`. The graph auto-syncs via `cg watch`, or connect over MCP with `cg mcp-install`.
