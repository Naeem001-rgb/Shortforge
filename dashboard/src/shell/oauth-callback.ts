import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "../theme/tokens.css";
import "../theme/app.css";
import "./oauth-callback.css";

const root = document.documentElement;
if (!["light", "dark"].includes(root.dataset.theme || "")) {
  let theme = "system";
  try {
    theme = localStorage.getItem("shortforge-theme") || "system";
  } catch {
    // Restricted storage still gets the system appearance.
  }
  root.dataset.theme =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
}

// The result is already rendered by the engine. Remove Google's one-use
// parameters before the user copies the address or returns to Settings.
if (location.search || location.hash) {
  history.replaceState(null, "", location.pathname);
}
