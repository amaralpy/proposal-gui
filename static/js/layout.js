const sidebar = document.getElementById("sidebar");
const appMain = document.getElementById("app-main");
const sidebarToggle = document.getElementById("sidebar-toggle");
const themeToggle = document.getElementById("theme-toggle");
const body = document.body;

function toggleSidebar() {
  sidebar.classList.toggle("collapsed");
  appMain.classList.toggle("expanded");
}

function applyTheme(theme) {
  body.classList.toggle("dark-theme", theme === "dark");
  body.classList.toggle("light-theme", theme !== "dark");
}

function initTheme() {
  const saved = localStorage.getItem("prospect-theme") || "light";
  applyTheme(saved);
}

function initSidebarState() {
  if (window.matchMedia("(max-width: 720px)").matches) {
    sidebar.classList.add("collapsed");
    appMain.classList.add("expanded");
  }
}

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", toggleSidebar);
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const next = body.classList.contains("dark-theme") ? "light" : "dark";
    localStorage.setItem("prospect-theme", next);
    applyTheme(next);
  });
}

initTheme();
initSidebarState();
