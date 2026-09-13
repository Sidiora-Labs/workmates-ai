import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export function serverAddress(value) {
  const url = new URL(String(value).trim());
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use an HTTPS server address without a path");
  }
  return url.origin;
}

export async function checkCloudServer(url, token) {
  const origin = serverAddress(url);
  if (typeof token !== "string" || token.length < 32 || /\s/.test(token)) {
    throw new Error("Enter the server access key from Railway");
  }
  let response;
  try {
    response = await fetch(`${origin}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach that server. Check the address and its deployment status.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.app !== "workmates" || body.mode !== "hosted") {
    throw new Error("That address is not a Workmates cloud server");
  }
  if (!body.authenticated) throw new Error("The server did not accept that access key");
  return origin;
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".json": "application/json",
};
const HOP_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-authenticate", "te", "trailer"]);

export async function startDesktopProxy({ staticDir, devUrl, backend, port = 0 }) {
  const pending = new Set();
  const sockets = new Set();
  let origin = "";
  const allowed = (req) => {
    const peer = req.socket.remoteAddress;
    return (peer === "127.0.0.1" || peer === "::ffff:127.0.0.1") &&
      req.headers.host === new URL(origin).host &&
      (!req.headers.origin || req.headers.origin === origin) &&
      req.headers["sec-fetch-site"] !== "cross-site";
  };
  const fail = (res, status, error) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error }));
  };
  const forward = (req, res, target, authenticated) => {
    const url = new URL(req.url, target.url);
    if (url.origin !== new URL(target.url).origin) return fail(res, 400, "invalid request path");
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_HEADERS.has(key) && !["host", "origin", "authorization", "cookie"].includes(key) &&
          !key.startsWith("x-forwarded-") && !key.startsWith("x-workmates-relay")) headers[key] = value;
    }
    headers.host = url.host;
    if (authenticated && target.token) headers.authorization = `Bearer ${target.token}`;
    const upstream = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: req.method, headers, timeout: 120_000,
    }, (response) => {
      upstream.setTimeout(0);
      const returned = {};
      for (const [key, value] of Object.entries(response.headers)) {
        if (!HOP_HEADERS.has(key) && key !== "set-cookie") returned[key] = value;
      }
      res.writeHead(response.statusCode ?? 502, returned);
      response.pipe(res);
      response.on("error", () => res.destroy());
    });
    pending.add(upstream);
    upstream.on("close", () => pending.delete(upstream));
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => fail(res, 502, "The Workmates server is unavailable. Check your connection or server settings."));
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  };
  const server = createServer(async (req, res) => {
    if (!allowed(req)) return fail(res, 403, "not a request from this desktop app");
    let path;
    try { path = new URL(req.url, origin).pathname; } catch { return fail(res, 400, "invalid path"); }
    if (path.startsWith("/api/")) {
      const target = backend();
      if (!target) return fail(res, 503, "Choose a Workmates server to connect");
      return forward(req, res, target, true);
    }
    if (devUrl) return forward(req, res, { url: devUrl }, false);
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "method not allowed");
    try {
      const root = resolve(staticDir);
      const file = resolve(root, `.${decodeURIComponent(path === "/" ? "/index.html" : path)}`);
      if (!file.startsWith(root + sep)) return fail(res, 403, "invalid path");
      let data;
      let mime = MIME[extname(file)] ?? "application/octet-stream";
      try { data = await readFile(file); }
      catch {
        if (extname(file)) return fail(res, 404, "file not found");
        data = await readFile(resolve(root, "index.html"));
        mime = MIME[".html"];
      }
      res.writeHead(200, { "content-type": mime, "x-content-type-options": "nosniff", "cache-control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch { fail(res, 503, "Build the desktop interface before starting Workmates"); }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", (req, socket, head) => {
    if (!devUrl || !allowed(req) || req.url.startsWith("/api/")) return socket.destroy();
    const target = new URL(req.url, devUrl);
    if (target.origin !== new URL(devUrl).origin) return socket.destroy();
    const upgrade = httpRequest(target, { headers: { ...req.headers, host: target.host } });
    upgrade.on("upgrade", (response, upstream, upstreamHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key,value])=>`${key}: ${value}`).join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    });
    upgrade.on("error", () => socket.destroy());
    upgrade.end();
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    disconnect() { for (const request of pending) request.destroy(); },
    async close() {
      for (const request of pending) request.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}
