import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";

import { attachRpc } from "../server/harness/jsonrpc-stdio.ts";

test("an asynchronous broken pipe does not crash the RPC transport", async () => {
  const brokenPipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      process.nextTick(callback, brokenPipe);
    },
  });
  const stdout = new PassThrough();
  const rpc = attachRpc({ stdin, stdout, onRequest() {}, onNotify() {} });
  const closed = new Promise<void>((resolve) => stdin.once("close", resolve));
  const pending = rpc.request("initialize");
  const rejected = assert.rejects(pending, /child exited/);

  await closed;
  assert.equal(stdin.errored, brokenPipe);
  rpc.failPending(new Error("child exited"));
  await rejected;
  stdout.destroy();
});
