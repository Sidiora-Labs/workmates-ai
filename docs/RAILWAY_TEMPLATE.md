# Deploy and Host Workmates on Railway

Workmates is a personal AI workspace for working with agents individually or in teams. Give agents roles, keep separate conversations, bring them into shared rooms, and follow their tool activity and approval requests. Your server owns the workspace; the web app, mobile PWA, and installable desktop client connect to that same server.

## About Hosting Workmates

Deploy this template, wait for the Workmates service to become healthy, then open its generated HTTPS domain. Copy `WORKMATES_SERVER_TOKEN` from the service's Variables tab and use it to sign in. Railway generates a different 64-character access key for every installation.

In Settings, connect OpenRouter, Centra, or another supported API provider. The model picker discovers your provider's catalog and lets you search model names and IDs. Create an agent or use the initial Nova agent to start a conversation. Provider credentials are configured in your own workspace after deployment.

## Why Deploy Workmates on Railway

- A prebuilt public Docker image containing the Node.js server and React web/PWA client.
- One server instance with an HTTPS domain and `/api/health` health check.
- A 1 GB persistent volume mounted at `/data` for agents, conversations, files, settings, and browser sessions.
- A generated owner access key, with no registry credentials required.

The image is `paxeer/workmates-ai:1.0.0-cloud.20260913` from [Docker Hub](https://hub.docker.com/r/paxeer/workmates-ai). It starts a fresh workspace; no existing user's accounts, messages, or files are included.

## Common Use Cases

On a phone, open the deployment URL and use Install app or Add to Home Screen. In the Workmates desktop app, choose Cloud server and enter the same HTTPS address and access key. Both clients share workspace state and live updates.

For an agent computer, connect a Box by Ascii account in Settings and select Cloud box. Its interactive desktop opens inside Workmates. Local VM and control of your own desktop require running a local Workmates server. The cloud image includes Node.js, Python, Git, curl, and SSH; laptop-installed agent CLIs are not available to cloud agents.

Railway hosting, model providers, and optional Box usage are billed by those services. Keep one server replica, place persistent project files under `/data`, and back up the volume. For upgrades, change the image version and redeploy while retaining that volume.

[Source and desktop builds](https://github.com/Sidiora-Labs/workmates-ai) · [Setup documentation](https://github.com/Sidiora-Labs/workmates-ai/blob/main/docs/CLOUD_SERVER.md)

## Dependencies for Workmates

A Railway account and a connected model provider are needed for agent replies. Optional computer access uses a separate Box by Ascii account. Configure provider credentials in Workmates after signing in.

### Deployment Dependencies

- Public image: `paxeer/workmates-ai:1.0.0-cloud.20260913` (Linux amd64).
- Persistent volume: `/data`, initially 1 GB; keep one server replica.
- Generated `WORKMATES_SERVER_TOKEN`: supplied by this template.
- HTTP port 8080 and health check `/api/health`, configured by this template.

No external database or local build toolchain is required. Workmates stores its workspace on the attached volume.
