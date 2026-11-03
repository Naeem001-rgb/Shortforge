/** Connection credentials never enter the Scout state or a provider request. */
export const ENGINE_ORIGIN = "http://127.0.0.1:8787";
export const ACCESS_KEY = "shortforge-engine-access";
type Access = { token: string; expires_at: number };
type Bridge = {
  runtime?: {
    sendMessage: (
      id: string,
      message: unknown,
    ) => Promise<{ connected?: boolean; error?: string }>;
  };
  storage?: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (value: Record<string, unknown>) => Promise<void>;
      remove: (key: string) => Promise<void>;
      setAccessLevel?: (value: {
        accessLevel: "TRUSTED_CONTEXTS";
      }) => Promise<void>;
    };
    onChanged?: {
      addListener: (fn: (changes: Record<string, unknown>) => void) => void;
      removeListener: (fn: (changes: Record<string, unknown>) => void) => void;
    };
  };
};
const bridge = () =>
  (globalThis as typeof globalThis & { chrome?: Bridge }).chrome;
export const inExtension = () =>
  typeof location !== "undefined" && location.protocol === "chrome-extension:";
const prefix = () =>
  inExtension() || typeof window === "undefined" ? ENGINE_ORIGIN : "";

export async function accessToken(): Promise<string> {
  try {
    const local = bridge()?.storage?.local;
    const value = local
      ? (await local.get(ACCESS_KEY))[ACCESS_KEY]
      : JSON.parse(localStorage.getItem(ACCESS_KEY) || "null");
    const access = value as Access | null;
    return access &&
      typeof access.token === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(access.token) &&
      access.expires_at > Date.now() / 1000
      ? access.token
      : "";
  } catch {
    return "";
  }
}

export async function saveAccess(access: Access | null): Promise<void> {
  const local = bridge()?.storage?.local;
  if (local) {
    await local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    if (access) await local.set({ [ACCESS_KEY]: access });
    else await local.remove(ACCESS_KEY);
  } else {
    if (access) localStorage.setItem(ACCESS_KEY, JSON.stringify(access));
    else localStorage.removeItem(ACCESS_KEY);
  }
}

export async function engineFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  if (!path.startsWith("/api/"))
    throw new Error("Unrecognized engine request.");
  const token = await accessToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${prefix()}${path}`, {
    ...options,
    headers,
    redirect: "error",
  });
  if (response.status === 401 && path !== "/api/security/pair") {
    await saveAccess(null);
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("shortforge-connection-needed"));
  }
  return response;
}

export async function connectCode(value: string): Promise<void> {
  let code = value.trim();
  if (code.startsWith("file:"))
    throw new Error(
      "Open that local connection link in your browser’s address bar. It cannot be redeemed in this field.",
    );
  if (code.startsWith("http"))
    code =
      new URLSearchParams(new URL(code).hash.slice(1)).get("connect") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(code))
    throw new Error("Use the complete connection link opened by ShortForge.");
  const response = await engineFetch("/api/security/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.detail ||
        "The connection could not be completed. Start ShortForge again.",
    );
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(result.token) ||
    !Number.isFinite(result.expires_at)
  )
    throw new Error(
      "The engine returned an invalid connection. Restart ShortForge.",
    );
  await saveAccess({ token: result.token, expires_at: result.expires_at });
}

export async function connectScout(): Promise<void> {
  const runtime = bridge()?.runtime;
  if (!runtime?.sendMessage)
    throw new Error(
      "Open this dashboard in Chrome with Scout installed, then try again.",
    );
  const response = await engineFetch("/api/security/scout-grant", {
    method: "POST",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.detail || "Scout could not connect.");
  try {
    const reply = await runtime.sendMessage(result.extension_id, {
      type: "connect-engine",
      code: result.code,
    });
    if (!reply?.connected)
      throw new Error(
        reply?.error ||
          "Scout could not connect. Reload the Scout extension and try again.",
      );
  } catch {
    throw new Error(
      "Scout is not ready. Reload ShortForge Scout in Chrome’s Extensions page, then try again.",
    );
  }
}

export function watchAccess(callback: () => void): () => void {
  const changes = bridge()?.storage?.onChanged;
  const changed = (value: Record<string, unknown>) => {
    if (ACCESS_KEY in value) callback();
  };
  changes?.addListener(changed);
  window.addEventListener("storage", callback);
  window.addEventListener("shortforge-connection-needed", callback);
  return () => {
    changes?.removeListener(changed);
    window.removeEventListener("storage", callback);
    window.removeEventListener("shortforge-connection-needed", callback);
  };
}
