import { useLayoutEffect, useState } from "react";
export function ThemeSwitch() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("rograph-theme") === "dark";
    } catch {
      return false;
    }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("rograph-theme", dark ? "dark" : "light");
    } catch {}
    window.dispatchEvent(new Event("rograph-theme"));
  }, [dark]);
  return (
    <button
      type="button"
      role="switch"
      aria-label="Dark mode"
      aria-checked={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="theme-switch"
      onClick={() => setDark((v) => !v)}
    >
      <svg className="theme-sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
      </svg>
      <svg className="theme-moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 3a9 9 0 1 0 6 14A8 8 0 0 1 15 3Z" />
        <path d="M20 2v6m-3-3h6" />
      </svg>
      <span className="theme-knob" />
    </button>
  );
}
