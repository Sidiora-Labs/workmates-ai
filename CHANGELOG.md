# Changelog

All notable changes to Workmates are recorded here, one section per day
of work, newest first. Each entry is a commit on the main branch; the
subject line is the commit subject.

The package version is 1.0.0.

## 2026-09-13

- **docs: the changelog.** This file.

## 2026-09-11

- **ci: workflows, templates and dependabot.** CI, desktop builds and release workflows; issue and pull request templates.

## 2026-09-10

- **docs: README, contributing, architecture and releasing.** The README with screenshots, the contributor guide, the architecture note and the release runbook.

## 2026-09-09

- **spec: all four features qualified.** Every task in workmates-01 to 04 ran its verify_cmd and graph checks and is marked done; the mirrors are re-rendered and the workflow's active feature moves to the last one.

## 2026-09-08

- **test: the suite.** Node's test runner over the server, the stores, the drivers, the client reducer and helpers, plus the guards on naming, palette contrast, packaged paths, bundle ids and secrets.

## 2026-09-06

- **desktop: the Electron shell.** Main, preload, window state, speech and the Cua bridge, the Swift helpers, the builder config, the icon set and the scripts that render icons, bundle the updater, seed a demo workspace and shoot screenshots.

## 2026-09-04

- **client: agents and settings.** New agent, import, avatars, the model picker, provider icons and agent settings; the app settings panel with engines, apps, local VM, voices, devices, rules and the record. App.tsx wires the shell together.

## 2026-09-02

- **client: chat and rooms.** The chat view, composer, message actions, task strip, gallery, artifacts, cards, quick ask, voice and terminal; rooms, the forum lens, team hiring and the team map.

## 2026-08-30

- **client: the workspace shell and sidebar.** Sidebar, command palette, activity, projects, job board, automations, workflows, routines, the computer panel and the desktop overlay.

## 2026-08-29

- **client: brand and welcome.** The Workmates mark, the wordmark and app icon in public/, the first-run intro and the onboarding.

## 2026-08-28

- **client: state and the shared library.** The store and reducer that fold the server's event stream, and the helpers for threads, transcripts, previews, notifications, recommendations, theming and the mascot.

## 2026-08-26

- **server: the harness entry point and the agent CLI.** Boot, the request guards, the routes, the event fold, startTurn, the room engine and the background engines in server/index.ts; the CLI in bin/.

## 2026-08-24

- **spec: workmates-04-pairing.** Pairing and the relay: off by default, a six-digit code and QR window, device records without their secrets, a relay that carries only ciphertext, and Cloud activation that never keeps the key. Five requirements, six tasks.
- **server: pairing and the relay.** Device pairing, the relay link and the crypto that keeps a relay that quotes the request back from ever seeing the key.

## 2026-08-23

- **server: agents, skills, teams and context.** The agent CLI and transfers, teams, skills and the registry, components, drafts, the scout, workspace and turn context, activity and diagnostics. Third-party skills are pinned in skills-lock.json.

## 2026-08-22

- **spec: workmates-03-skill-catalog.** The skill catalog: read a published catalog defensively, say honestly what it means for a skill already installed, install with provenance, and a catalog screen that repeats the server's words. Four requirements, five tasks.

## 2026-08-21

- **server: integrations.** Providers, OAuth, MCP client and apps, Composio, Telegram, CDP and the page script, cookie import, speech, the local VM and sandbox, and Box.

## 2026-08-20

- **server: drivers and the stdio proxies.** Claude, Codex, ACP engines, Antigravity, the native and OpenAI-compatible drivers and the box agent, plus the five proxies they reach over stdio for browser, computer, connectors, permissions and the sandbox.

## 2026-08-18

- **server: core contracts, config and guards.** The driver contract, the workspace config and its migrations, argv parsing, the HTTP origin guard, input limits, identity keys, NDJSON, path helpers and the house style. The harness bus, registry, ask broker and stdio JSON-RPC.
- **server: the stores.** Rooms, jobs, projects, proposals, policy, routines, workflows, webhooks, usage, the team library, artifacts and their comments, attachments, the terminal and the hash-chained ledger, each behind one store.

## 2026-08-17

- **spec: workmates-01-rooms.** Rooms: one transcript shared by several agents and the user, with a chain of command. Who a message reaches, juniors first and the senior last, queued messages, teams and the shared desk. Five requirements, four tasks.
- **spec: workmates-02-routines.** Routines: a prompt, a local time and a set of weekdays, fired by a tick into a background lane, once per slot, with runs kept as history. Four requirements, six tasks.

## 2026-08-16

- **chore: scaffold the project.** Vite, React and Tailwind on the client, Node on the server, one tsconfig per role, and the licence, conduct and ignore rules a public repo starts with. Version 1.0.0.
- **chore: the spec workflow.** Codify (cg) drives the work: spec/workflow.kvx is the source of truth, each feature gets a kvx spec with requirements, design and a task list, and CLAUDE.md and AGENTS.md are rendered pointers to it. The agent hosts are wired to the graph over MCP.
- **ui: the primitive set.** Button, input, textarea, switch, dialog, dropdown menu, tooltip, info tip and the folder browser, in the shadcn shape so generated components drop in.

[repository]: https://github.com/Sidiora-Labs/workmates-ai.git
