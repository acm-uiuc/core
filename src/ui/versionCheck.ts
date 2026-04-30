const CURRENT_VERSION = import.meta.env.VITE_BUILD_HASH;

let intervalId: any;
let fetchFailures = 0;
let onUpdateCallback: (() => void) | null = null;

async function checkForUpdate() {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });

    if (!res.ok) {
      return;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      // SPA fallback returned HTML or something else — version.json isn't deployed
      console.warn("Invalid response for version.json");
      stopPolling();
      return;
    }

    const { version } = await res.json();
    fetchFailures = 0;
    if (version && CURRENT_VERSION && version !== CURRENT_VERSION) {
      stopPolling();
      if (onUpdateCallback) {
        onUpdateCallback();
      } else {
        forceRefresh();
      }
    }
  } catch (e) {
    fetchFailures++;
    if (fetchFailures > 10) {
      console.warn("Failed to fetch version 10 times; giving up.");
      stopPolling();
    } else {
      console.warn("Failed to fetch version of current system: ", e);
    }
  }
}

export function forceRefresh() {
  if ("caches" in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
  window.location.reload();
}

function stopPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    checkForUpdate();
  }
}

export function startVersionPolling(onUpdate?: () => void) {
  if (onUpdate) {
    onUpdateCallback = onUpdate;
  }
  checkForUpdate();
  intervalId = setInterval(checkForUpdate, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", onVisibilityChange);
}
