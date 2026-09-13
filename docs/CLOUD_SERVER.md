# One cloud workspace, desktop and mobile clients

The cloud server runs agents and owns workspace data. Use the installed Electron app on your computer and the hosted web app on your phone; both read and update that same workspace. Local desktop mode remains available as a separate workspace.

## Railway template

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/workmates)

The template deploys `paxeer/workmates-ai:1.0.0-cloud.20260913`, creates a 1 GB persistent volume at `/data`, exposes port 8080 over HTTPS, and generates a separate 64-character `WORKMATES_SERVER_TOKEN` for each installation. It uses the `/api/health` check and one server instance.

After deployment, copy `WORKMATES_SERVER_TOKEN` from the Workmates service's Variables tab, open its generated domain, and sign in. Add your own model providers in Settings. For a cloud computer, connect Box; local desktop control and Local VM require a local Workmates server.

The public image is on [Docker Hub](https://hub.docker.com/r/paxeer/workmates-ai). The versioned release and `latest` are available for Linux amd64. To update an installation, back up `/data`, select the desired published image version in Railway's service source, and redeploy with the same volume. An image update does not require a new workspace or access key.

## Manual Railway setup

1. Create a service from this repository using the root `Dockerfile`. It builds the server and web client together. The included `railway.json` selects the Dockerfile and `/api/health` health check.
2. Attach a persistent volume at `/data`. Keep one replica for this file-backed workspace.
3. Set `WORKMATES_SERVER_TOKEN` to a random access key of at least 32 characters. Generate one with `openssl rand -hex 32` and keep it for signing in from your devices.
4. Generate an HTTPS domain. Railway's `RAILWAY_PUBLIC_DOMAIN` supplies the public origin. If you use a custom domain, set `WORKMATES_PUBLIC_URL=https://your-domain.example` and use that address in both clients.
5. Deploy, open the domain, sign in with the access key, and connect an API provider in Settings.

The image defaults to `WORKMATES_HOSTED=1`, `WORKMATES_DATA_DIR=/data/workspace`, `WORKMATES_STATIC_DIR=/app/dist`, and `PORT=8080`. Railway can supply `PORT`; the server listens on all interfaces in hosted mode. See Railway's [volume guide](https://docs.railway.com/volumes) and [health checks](https://docs.railway.com/deployments/healthchecks).

Keep project folders under `/data` if they must survive container replacement. Back up that volume; it holds conversations, agent state, uploaded files, credentials, and browser-session hashes. The image includes Node.js, Python, Git, curl, and SSH tools. Optional agent CLIs and computer environments require their own installation or configuration on the server; laptop installations are not available to cloud agents.

## Connect your devices

**Desktop:** open Workmates, choose **Cloud server**, and enter the HTTPS address and server access key. Change the connection later in **Settings → General**. Where the operating system supports it, the key is encrypted with its secure storage; otherwise it lasts for the current app session. The desktop UI is installed locally and proxies requests to the cloud server.

**Phone or browser:** open the same HTTPS address and sign in. Use your browser's **Install app** or **Add to Home Screen** option for an app-style window. The [web manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest) supplies its name, icons, and standalone display. Browser sign-in lasts up to 30 days and survives server restarts. **Settings → General → Sign out of this device** revokes that browser session without disconnecting the desktop app. Rotating the server access key and restarting invalidates existing browser sessions and requires updating desktop credentials.

Agents and files stay on the server. Attachments selected on either device upload to that workspace. Native laptop screen control and local folders are separate from cloud execution. The PWA needs a network connection for chats and tools; its offline page offers reconnection, while the server can continue running agents independently. Push notifications while the mobile app is closed are not included.

## Local verification

```sh
pnpm build:web
pnpm build:cloud
node --test test/hosted-clients.test.ts
docker build -t workmates-cloud .
```

Run the image with a `/data` volume, a generated `WORKMATES_SERVER_TOKEN`, and port 8080 published locally. Set `WORKMATES_PUBLIC_URL` to the address you use to visit it, such as `http://127.0.0.1:8080` for a loopback test. Normal deployments need HTTPS for browser installation and secure cookies. Local build and test success is separate from a verified Railway deployment.

For a real browser and Electron interaction check, run `node scripts/verify-cloud-clients.mjs` after building. Set `CHROMIUM_PATH` if Chromium is not in Playwright's default location. On a headless Linux host use `xvfb-run -a`; set `WORKMATES_ELECTRON_PATH` to a packaged executable to verify that build. The check uses an isolated real server and temporary workspace, and leaves screenshots in its proof directory.
