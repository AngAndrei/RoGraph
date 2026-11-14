// A reload has a grace period; other open tabs keep the service alive.
export function createUiLifetime(stop: () => void) {
  const clients = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const schedule = () => {
    clearTimeout(timer);
    if (disposed) return;
    const delay = clients.size
      ? Math.max(1, Math.min(...clients.values()) + 120000 - Date.now())
      : 2500;
    timer = setTimeout(() => {
      for (const [id, seen] of clients)
        if (Date.now() - seen >= 120000) clients.delete(id);
      if (!clients.size) {
        disposed = true;
        stop();
      } else schedule();
    }, delay);
    timer.unref?.();
  };
  return {
    update(id: string, active: boolean) {
      if (disposed) return;
      if (active) clients.set(id, Date.now());
      else clients.delete(id);
      schedule();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clients.clear();
    },
  };
}
