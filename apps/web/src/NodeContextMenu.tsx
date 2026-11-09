import { useEffect, useRef } from "react";

export type NodeMenu = { nodeId: string; x: number; y: number };
export function NodeContextMenu({
  menu,
  highlighted,
  onRename,
  onHighlight,
  onClose,
}: {
  menu: NodeMenu;
  highlighted: boolean;
  onRename: () => void;
  onHighlight: () => void;
  onClose: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    element.current?.querySelector("button")?.focus();
    const outside = (e: PointerEvent) => {
      if (!element.current?.contains(e.target as globalThis.Node)) onClose();
    };
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", dismiss);
    document.addEventListener("wheel", onClose, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("wheel", onClose);
    };
  }, [menu.nodeId, onClose]);
  return (
    <div
      ref={element}
      className="node-context-menu"
      role="menu"
      aria-label="Node actions"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const buttons = [...element.current!.querySelectorAll("button")];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        buttons[
          (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
            buttons.length
        ].focus();
      }}
    >
      <button role="menuitem" onClick={onRename}>
        Rename
      </button>
      <button
        role="menuitemcheckbox"
        aria-checked={highlighted}
        onClick={onHighlight}
      >
        <span className="highlight-swatch" aria-hidden="true" />
        Highlight{highlighted ? " ✓" : ""}
      </button>
    </div>
  );
}
