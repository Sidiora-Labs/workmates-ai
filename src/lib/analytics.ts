import posthog from "posthog-js";

const TOKEN = import.meta.env.VITE_POSTHOG_TOKEN;

let ready = false;

export function initAnalytics() {
  if (ready || !TOKEN) return;
  posthog.init(TOKEN, {
    api_host: "https://us.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    person_profiles: "identified_only",
    persistence: "localStorage",
  });
  ready = true;
  const platform = navigator.userAgent.includes("Electron") ? "desktop" : "browser";
  if (!localStorage.getItem("workmates-installed")) {
    localStorage.setItem("workmates-installed", new Date().toISOString());
    posthog.capture("app_first_open", { platform });
  }
  posthog.capture("app_opened", { platform });
}

export function track(event: string, props?: Record<string, number | boolean | string>) {
  if (!ready) return;
  posthog.capture(event, props);
}

const SETUP_KEY = "workmates-setup-done";
export function setupDone(): boolean {
  return Boolean(localStorage.getItem(SETUP_KEY));
}

export async function workspaceSetupDone(): Promise<boolean> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return setupDone();
    const status = (await res.json()) as { setupDone?: boolean };
    if (status.setupDone) localStorage.setItem(SETUP_KEY, "done");
    return Boolean(status.setupDone);
  } catch {
    return setupDone();
  }
}

export function setSetupDone() {
  localStorage.setItem(SETUP_KEY, "done");
  void fetch("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ setupDone: true }),
  }).catch(() => {});
}
