/* TruthLens theme controller */
(function(){
  const root = document.documentElement;
  const button = document.getElementById("themeToggle");
  const saved = localStorage.getItem("truthlens-theme");
  const preferredDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initial = saved || (preferredDark ? "dark" : "light");

  function applyTheme(theme){
    root.setAttribute("data-theme", theme);
    if (!button) return;
    const dark = theme === "dark";
    button.textContent = dark ? "☀️" : "🌙";
    button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    button.setAttribute("title", dark ? "Switch to light mode" : "Switch to dark mode");
  }

  applyTheme(initial);

  if (button){
    button.addEventListener("click", function(){
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      localStorage.setItem("truthlens-theme", next);
      applyTheme(next);
    });
  }
})();
const savedTheme = localStorage.getItem("truthlens-theme");

if (savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
}

document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("themeToggle");

    if (!toggle) return;

    const updateIcon = () => {
        toggle.textContent =
            document.documentElement.getAttribute("data-theme") === "dark"
                ? "☀️"
                : "🌙";
    };

    toggle.addEventListener("click", () => {
        const isDark =
            document.documentElement.getAttribute("data-theme") === "dark";

        document.documentElement.setAttribute(
            "data-theme",
            isDark ? "light" : "dark"
        );

        localStorage.setItem(
            "truthlens-theme",
            isDark ? "light" : "dark"
        );

        updateIcon();
    });

    updateIcon();
});