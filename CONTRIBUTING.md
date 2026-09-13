# Contributing to Workmates

Contributions should make Workmates easier to use, maintain, or understand. A useful change starts with a concrete problem and shows how the resulting behavior addresses it.

## Start with the problem

Use the [issue templates](https://github.com/Sidiora-Labs/workmates-ai/issues/new/choose) for bugs and feature requests. Include the version or revision, operating system, engine, reproduction steps, expected behavior, and actual result. For a substantial change, describe the proposed approach in an issue before implementing it.

For questions about contributing, use [repository issues](https://github.com/Sidiora-Labs/workmates-ai/issues). Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in reviews and discussions.

## Set up a development workspace

Install a current patch release of Node.js 22 or newer and pnpm 10. Clone the repository and install the locked dependencies:

```sh
git clone https://github.com/Sidiora-Labs/workmates-ai.git
cd workmates-ai
pnpm install --frozen-lockfile
```

Run `pnpm dev:server` and `pnpm dev` in separate terminals, then open http://127.0.0.1:5199. Run `pnpm dev:desktop` in a third terminal to use the Electron window. Connect an engine in Settings when checking an agent interaction.

The default workspace is `~/.workmates`. Development runs can read and modify that workspace, so use a separate operating-system account or environment when you need to isolate development from personal data.

## Keep changes within the right layer

The interface in `src/` communicates with the local API and consumes runtime events. Provider connections and processes belong in `server/`; native desktop behavior belongs in `electron/`.

Useful starting points are:

- [Runtime contracts](server/core/contracts.ts) for driver and event types.
- [Provider definitions](server/integrations/providers.ts) for API engines.
- [ACP driver](server/drivers/acp.ts) for supported agent CLIs.
- [Input limits](server/core/limits.ts) for shared bounds.
- [Architecture](docs/ARCHITECTURE.md) for the overall request and event flow.

Match the surrounding code and keep a pull request focused on one coherent change. Preserve approval behavior and describe any intentional changes to it. Treat model output, remote responses, and user input as untrusted when they reach a command, file path, stored record, or rendered interface.

## Verify the result

Run the checks used by [CI](.github/workflows/ci.yml):

```sh
pnpm typecheck
pnpm test
pnpm build
```

Add a regression check when it demonstrates the reported failure and exercises the behavior being fixed. For an interaction change, also run the application and use the affected path. Report what you exercised, which engine and platform you used, and anything you could not verify. Include screenshots for visible changes, with both themes when relevant.

Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) to explain the problem, resulting behavior, and validation. Keep generated build output, credentials, personal workspace files, and private transcripts out of the change.

## Report vulnerabilities privately

The repository's issue configuration directs vulnerability reports to [GitHub private security advisories](https://github.com/Sidiora-Labs/workmates-ai/security/advisories/new). Use that route instead of publishing exploit details in an issue. If it is unavailable, consult the contact methods listed on the [Sidiora Labs GitHub profile](https://github.com/Sidiora-Labs) before sharing sensitive material.

## Licensing

Review [LICENSE](LICENSE) before contributing. Include only material you are entitled to submit and preserve applicable license notices and attribution.
