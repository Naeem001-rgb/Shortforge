try {
  const theme = localStorage.getItem("shortforge-theme") || "system";
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  /* A restricted browser can use the default theme. */
}
