import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_KEY, openScoutWorkspace } from "../../shared/engine-client.ts";

test("Library renews expired Scout access, coalesces startup and reuses a connected session", async (t) => {
  const area = {};
  const access = { token: "b".repeat(43), expires_at: Date.now() / 1000 + 600 };
  let nativeCalls = 0;
  const window = new EventTarget();
  window.top = window.self = window;
  const chrome = {
    runtime: {
      async sendNativeMessage(host, message) {
        nativeCalls++;
        assert.equal(host, "com.shortforge.scout");
        assert.deepEqual(message, { action: "open-library" });
        return access;
      },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: area[key] };
        },
        async set(update) {
          Object.assign(area, update);
        },
        async remove(key) {
          delete area[key];
        },
        async setAccessLevel(options) {
          assert.equal(options.accessLevel, "TRUSTED_CONTEXTS");
        },
      },
    },
  };
  Object.assign(globalThis, {
    chrome,
    window,
    location: { protocol: "chrome-extension:" },
  });
  t.after(() => {
    delete globalThis.chrome;
    delete globalThis.window;
    delete globalThis.location;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://127.0.0.1:8787/api/security/session");
    const token = new Headers(options.headers).get("Authorization");
    return new Response(null, {
      status: token === "Bearer " + access.token ? 200 : 401,
    });
  });
  area[ACCESS_KEY] = { ...access, token: "a".repeat(43) };
  await Promise.all([openScoutWorkspace(), openScoutWorkspace()]);
  assert.deepEqual(area[ACCESS_KEY], access);
  await openScoutWorkspace();
  assert.equal(nativeCalls, 1);
  delete area[ACCESS_KEY];
  chrome.runtime.sendNativeMessage = async () => {
    throw Error("Host missing");
  };
  await assert.rejects(openScoutWorkspace(), /local connection helper/);
  assert.equal(area[ACCESS_KEY], undefined);
});
