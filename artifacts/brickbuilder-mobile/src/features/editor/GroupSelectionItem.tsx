import { useEffect, useRef, useState } from "react";
import { Box, ImageOff, LoaderCircle } from "lucide-react";
import type { BuilderDocument } from "./model";
import type { InstructionPart } from "../instructions/parts";
import { observeThumbnail } from "../parts/thumbnails/visibility";
import { useI18n } from "@/i18n/I18nProvider";

export interface GroupSelectionTarget {
  id: string;
  number: string;
  name: string;
  colorName: string;
  colorHex: string;
  searchText: string;
  imageEntry: InstructionPart;
}

interface Props {
  target: GroupSelectionTarget;
  document: BuilderDocument;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export default function GroupSelectionItem({ target, document, checked, onChange }: Props) {
  const { t } = useI18n();
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ key: string; image?: string; error?: string }>();
  const source = target.imageEntry.kind === "imported" ? document.imported?.resources : undefined;
  const key = JSON.stringify([document.id, document.updatedAt, target.imageEntry.key]);

  useEffect(() => host.current ? observeThumbnail(host.current, setVisible) : undefined, []);
  useEffect(() => {
    if (!visible) { setResult(undefined); return; }
    const controller = new AbortController();
    void import("../instructions/part-images").then(({ instructionPartImage }) =>
      instructionPartImage(document, target.imageEntry, controller.signal))
      .then(image => {
        if (!controller.signal.aborted) setResult({ key, image });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({
          key, error: error instanceof Error ? error.message : t("thumbnail.unavailable"),
        });
      });
    return () => controller.abort();
  }, [key, visible, source, document, target.imageEntry, t]);

  const current = visible && result?.key === key ? result : undefined;
  const unavailable = typeof IntersectionObserver === "undefined" || Boolean(current?.error);
  const previewLabel = current?.image ? t("thumbnail.partPreview", { id: target.number })
    : unavailable ? t("thumbnail.unavailable") : visible ? t("thumbnail.loading") : t("thumbnail.whenVisible");

  return (
    <label className="rotation-selection-item" data-testid={`group-selection-item-${target.id}`}>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span ref={host} className={`rotation-selection-preview${current?.image ? " is-ready" : ""}`}
        role="img" aria-label={previewLabel} title={current?.error ?? previewLabel}
        data-testid={`group-selection-preview-${target.id}`}>
        {current?.image ? <img src={current.image} width={48} height={36} alt="" draggable={false} />
          : unavailable ? <ImageOff size={16} aria-hidden="true" />
            : visible ? <LoaderCircle size={16} className="spin" aria-hidden="true" />
              : <Box size={16} aria-hidden="true" />}
      </span>
      <span className="rotation-selection-copy">
        <strong>{target.number} · {target.name}</strong>
        <small>
          <i aria-hidden="true" style={{ backgroundColor: target.colorHex }} />
          {target.colorName}
        </small>
      </span>
    </label>
  );
}
