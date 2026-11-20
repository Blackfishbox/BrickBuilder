import { useEffect, useRef, useState } from "react";
import { Box, ImageOff, LoaderCircle } from "lucide-react";
import type { LibraryPart } from "./types";
import { observeThumbnail } from "./thumbnails/visibility";
import "./parts-library.css";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
  part: LibraryPart; revision: string; color: string; colorCode?: string; paletteRevision?: string;
};

export default function PartThumbnail({ part, revision, color, colorCode, paletteRevision }: Props) {
  const { t } = useI18n();
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ key: string; image?: string; error?: string }>();
  const key = JSON.stringify([part.id, part.file, revision, color, colorCode, paletteRevision]);
  useEffect(() => host.current ? observeThumbnail(host.current, setVisible) : undefined, []);
  useEffect(() => {
    if (!visible) { setResult(undefined); return; }
    const controller = new AbortController();
    void import("./thumbnails/service").then(service => {
      controller.signal.throwIfAborted();
      return service.requestThumbnail(part, revision, color, colorCode, controller.signal);
    }).then(image => {
      if (!controller.signal.aborted) setResult({ key, image });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : t("thumbnail.unavailable") });
    });
    return () => controller.abort();
  }, [key, visible, part, revision, color, colorCode]);
  const current = visible && result?.key === key ? result : undefined;
  const unavailable = typeof IntersectionObserver === "undefined" || Boolean(current?.error);
  const label = current?.image ? t("thumbnail.partPreview", { id: part.ldrawId })
    : unavailable ? t("thumbnail.unavailable") : visible ? t("thumbnail.loading") : t("thumbnail.whenVisible");
  return <span ref={host} className={`plib-thumbnail${current?.image ? " is-ready" : ""}`}
    role="img" aria-label={label} title={current?.error ?? label} data-testid={`thumbnail-${part.ldrawId}`}>
    {current?.image ? <img src={current.image} width={80} height={60} alt="" draggable={false} />
      : unavailable ? <ImageOff size={18} aria-hidden="true" />
      : visible ? <LoaderCircle size={18} className="spin" aria-hidden="true" />
      : <Box size={18} aria-hidden="true" />}
  </span>;
}
