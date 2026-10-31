import { useState } from "react";
import { api } from "./api.js";
import type { Job } from "../../local/src/jobs.js";
export function ImportView({
  onJob,
  onClose,
}: {
  onJob: (job: Job) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"place" | "rojo">("place"),
    [file, setFile] = useState<File>(),
    [path, setPath] = useState(""),
    [watch, setWatch] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      onJob(
        mode === "place"
          ? await api.importFile(file!)
          : await api.importRojo(path, watch),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="import-card" aria-label="Import project">
      <div className="section-heading">
        <span className="eyebrow">NEW SNAPSHOT</span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close import"
        >
          ×
        </button>
      </div>
      <h2>See how your game fits together.</h2>
      <p>
        Open a saved Roblox project to connect its scripts, functions,
        configuration, and communication channels.
      </p>
      <div className="segmented">
        <button
          className={mode === "place" ? "active" : ""}
          onClick={() => setMode("place")}
        >
          Saved place
        </button>
        <button
          className={mode === "rojo" ? "active" : ""}
          onClick={() => setMode("rojo")}
        >
          Rojo project
        </button>
      </div>
      {mode === "place" ? (
        <label className="file-drop">
          <span className="upload-symbol">↥</span>
          <strong>{file?.name ?? "Choose a Roblox place"}</strong>
          <span>Roblox Place · .rbxlx or .rbxl · up to 512 MiB</span>
          <input
            aria-label="Place file"
            type="file"
            accept=".rbxlx,.rbxl"
            onChange={(e) => {
              setFile(e.target.files?.[0]);
              setError("");
            }}
          />
        </label>
      ) : (
        <div className="rojo-input">
          <label htmlFor="rojo-path">Rojo project path</label>
          <input
            id="rojo-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\Games\MyGame\default.project.json"
          />
          <p>Your configured files are captured together before analysis.</p>
          <label className="watch-choice">
            <input
              type="checkbox"
              checked={watch}
              onChange={(e) => setWatch(e.target.checked)}
            />
            Watch for saved changes
          </label>
        </div>
      )}
      <div className="local-note">
        <span>◈</span>
        <div>
          <strong>Stays on your computer</strong>
          <small>No account, cloud upload, or API key required.</small>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        className="primary wide"
        disabled={busy || (mode === "place" ? !file : !path.trim())}
        onClick={() => void submit()}
      >
        {busy ? "Reading project…" : "Analyze"}
      </button>
      <small className="hint">
        In Roblox Studio: Save to File → Roblox Place (.rbxl or .rbxlx).
      </small>
    </section>
  );
}
