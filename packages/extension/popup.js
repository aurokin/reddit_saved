import { APP_BASE_URL_KEY, DEFAULT_APP_BASE_URL, normalizeAppBaseUrl } from "./app-config.js";

const api = globalThis.browser ?? globalThis.chrome;

function relativeTime(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} hr ago`;
  return new Date(ts).toLocaleString();
}

function render(state) {
  const $ = (id) => document.getElementById(id);
  if (!state) {
    $("status").textContent = "Never synced";
    return;
  }
  if (state.ok) {
    $("status").textContent = "Connected";
    $("status").className = "value ok";
  } else {
    $("status").textContent = state.error ?? "Failed";
    $("status").className = "value err";
  }
  $("user").textContent = state.username ?? "—";
  $("endpoint").textContent = state.endpoint ?? "—";
  $("ts").textContent = relativeTime(state.ts);
}

async function refresh() {
  const state = await api.runtime.sendMessage({ type: "status" });
  render(state);
}

async function loadConfig() {
  const stored = await api.storage.local.get(APP_BASE_URL_KEY);
  document.getElementById("app-url").value = stored[APP_BASE_URL_KEY] ?? DEFAULT_APP_BASE_URL;
}

document.getElementById("save").addEventListener("click", async () => {
  const input = document.getElementById("app-url");
  const status = document.getElementById("status");
  try {
    const normalized = normalizeAppBaseUrl(input.value);
    await api.storage.local.set({ [APP_BASE_URL_KEY]: normalized });
    input.value = normalized;
    status.textContent = "Saved app URL";
    status.className = "value ok";
  } catch (err) {
    status.textContent = err?.message || String(err);
    status.className = "value err";
  }
});

document.getElementById("sync").addEventListener("click", async () => {
  document.getElementById("status").textContent = "Syncing…";
  const state = await api.runtime.sendMessage({ type: "sync" });
  render(state);
});

loadConfig();
refresh();
