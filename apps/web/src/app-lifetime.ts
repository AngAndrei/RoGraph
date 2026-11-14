import { useEffect } from "react";
export function useAppLifetime() {
  useEffect(() => {
    const id = crypto.randomUUID();
    const send = (active: boolean) => {
      const token = sessionStorage.getItem(`rograph-session:${location.host}`);
      if (!token) return;
      void fetch("/api/ui-session", {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          "X-RoGraph-Session": token,
        },
        body: JSON.stringify({ id, active }),
      }).catch(() => {});
    };
    const open = () => send(true),
      close = () => send(false);
    open();
    const timer = setInterval(open, 15000);
    window.addEventListener("pagehide", close);
    window.addEventListener("pageshow", open);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("pageshow", open);
      close();
    };
  }, []);
}
