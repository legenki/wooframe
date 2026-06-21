import { useEffect, useRef, useState } from "react";
import type { CodeToUi, UiToCode } from "../messages";
import { renderAndConvert } from "./render-host";
import { loadHtmlFromUrl } from "./url-loader";

const HTML_EXT = /\.html?$/i;

const SCREEN_PRESETS = [
  { label: "iPhone", width: 390 },
  { label: "Macbook", width: 1440 },
] as const;

// Default to the Macbook preset (matches the previous hardcoded render width).
const DEFAULT_WIDTH = SCREEN_PRESETS[1].width;

function post(msg: UiToCode) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

// Fire-and-forget for event handlers: run the async work, never throw out of
// the handler (errors are surfaced via state inside the async functions).
function run(work: Promise<void>) {
  work.catch(() => {
    // handled inside the async functions via setStatus
  });
}

export function App() {
  const [html, setHtml] = useState("");
  const [name, setName] = useState("Imported");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [over, setOver] = useState(false);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [url, setUrl] = useState("");
  const [proxy, setProxy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data?.pluginMessage as CodeToUi | undefined;
      if (!msg) {
        return;
      }
      setBusy(false);
      if (msg.type === "import-error") {
        setIsError(true);
        setStatus(`Import failed: ${msg.message}`);
        return;
      }
      setIsError(false);
      const parts = [`Built ${msg.built} of ${msg.total} layers.`];
      if (msg.skipped) {
        parts.push(`Skipped ${msg.skipped}.`);
      }
      if (msg.missingFonts.length) {
        parts.push(`Missing fonts: ${msg.missingFonts.join(", ")}.`);
      }
      if (msg.warnings.length) {
        parts.push(`${msg.warnings.length} warning(s).`);
      }
      setStatus(parts.join(" "));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function runImport(source: string) {
    setBusy(true);
    setIsError(false);
    setStatus("Rendering and converting…");
    try {
      const { nodeChanges, rootName, blobs } = await renderAndConvert(
        source,
        name,
        width
      );
      post({ type: "import-nodes", nodeChanges, rootName, blobs });
    } catch (error) {
      setBusy(false);
      setIsError(true);
      setStatus(`Convert failed: ${(error as Error).message}`);
    }
  }

  async function onFile(file: File) {
    const text = await file.text();
    setHtml(text);
    setName(file.name.replace(HTML_EXT, ""));
    await runImport(text);
  }

  async function onImportUrl() {
    setBusy(true);
    setIsError(false);
    setStatus("Loading URL…");
    try {
      const loaded = await loadHtmlFromUrl(url, proxy || undefined);
      setHtml(loaded);
      await runImport(loaded);
    } catch (error) {
      setBusy(false);
      setIsError(true);
      setStatus(
        `Couldn't load that URL. The site or your proxy blocked the request (CORS). Try a different proxy or save the page as an .html file. (${(error as Error).message})`
      );
    }
  }

  return (
    <div>
      <div className="sizes">
        {SCREEN_PRESETS.map((p) => (
          <button
            className={width === p.width ? "size active" : "size"}
            key={p.label}
            onClick={() => setWidth(p.width)}
            type="button"
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        className={over ? "drop over" : "drop"}
        onClick={() => fileRef.current?.click()}
        onDragLeave={() => setOver(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) {
            run(onFile(file));
          }
        }}
        type="button"
      >
        Drop an .html file here, or click to choose
      </button>
      <input
        accept=".html,.htm"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            run(onFile(file));
          }
        }}
        ref={fileRef}
        style={{ display: "none" }}
        type="file"
      />
      <textarea
        onChange={(e) => setHtml(e.target.value)}
        placeholder="…or paste HTML markup"
        value={html}
      />
      <button
        disabled={busy || !html.trim()}
        onClick={() => run(runImport(html))}
        type="button"
      >
        {busy ? "Importing…" : "Import to Figma"}
      </button>
      <input
        className="url"
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com to load by URL"
        type="url"
        value={url}
      />
      <input
        className="url"
        onChange={(e) => setProxy(e.target.value)}
        placeholder="Optional CORS proxy, e.g. https://your-proxy/?url={url}"
        type="text"
        value={proxy}
      />
      <button
        disabled={busy || !url.trim()}
        onClick={() => run(onImportUrl())}
        type="button"
      >
        {busy ? "Importing…" : "Import from URL"}
      </button>
      {status && (
        <div className={isError ? "status error" : "status"}>{status}</div>
      )}
    </div>
  );
}
