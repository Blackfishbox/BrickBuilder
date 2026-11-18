import { useEffect, useMemo, useRef, useState } from "react";
import type { BuilderDocument } from "../editor/model";
import { observeThumbnail } from "../parts/thumbnails/visibility";
import { instructionPartGroups, type InstructionPart } from "./parts";
import { instructionPartImage } from "./part-images";

function PartImage({ document, entry }: { document: BuilderDocument; entry: InstructionPart }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ source: BuilderDocument; key: string; image?: string; error?: string }>();
  useEffect(() => typeof IntersectionObserver !== "undefined" && host.current ? observeThumbnail(host.current, setVisible) : undefined, []);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    void instructionPartImage(document, entry, controller.signal).then(
      image => { if (!controller.signal.aborted) setResult({ source: document, key: entry.key, image }); },
      error => { if (!controller.signal.aborted) setResult({ source: document, key: entry.key, error: error instanceof Error ? error.message : "Vorschau nicht verfügbar." }); },
    );
    return () => controller.abort();
  }, [document, entry.key, visible]);
  const current = result?.source === document && result.key === entry.key ? result : undefined;
  return <span ref={host} className="ins-part-image">
    {!visible && typeof IntersectionObserver === "undefined" ? <button onClick={() => setVisible(true)}
      aria-label={`Vorschau für ${entry.number} laden`}>Vorschau laden</button>
      : current?.image ? <img src={current.image} alt={`${entry.number} · ${entry.colorName}`} />
      : <span role="img" aria-label={current?.error ?? "Vorschau wird geladen"} title={current?.error}>
        {current?.error ? "Vorschau fehlt" : "Lädt …"}
      </span>}
  </span>;
}

export default function StepPartsBox({ document, partIds, paused = false }: {
  document: BuilderDocument; partIds: string[]; paused?: boolean;
}) {
  const groups = useMemo(() => instructionPartGroups(document, partIds), [document, partIds]);
  return <section className="ins-parts-box" aria-label="Teile für diesen Schritt" data-testid="instructions-parts-box">
    <header><strong>Teile für diesen Schritt</strong><span>{groups.reduce((sum, entry) => sum + entry.count, 0)} Teile</span></header>
    {groups.length ? <ul>
      {groups.map(entry => <li key={entry.key} aria-label={`${entry.count} × ${entry.number} · ${entry.colorName}`}>
        <b className="ins-part-count">{entry.count}×</b>
        {!paused && <PartImage document={document} entry={entry} />}
        <span className="ins-part-number" title={entry.number}>{entry.number}</span>
        <span className="ins-part-color" title={entry.colorName}><i style={{ backgroundColor: entry.colorHex }} />{entry.colorName}</span>
      </li>)}
    </ul> : <p>Keine neuen Teile in diesem Schritt.</p>}
  </section>;
}
