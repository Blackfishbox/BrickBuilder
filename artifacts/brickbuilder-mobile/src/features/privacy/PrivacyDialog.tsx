import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { GEOMETRY_API, isAndroidBuild, remoteGeometryEnabled, setRemoteGeometryEnabled } from "./geometry-consent";
import { useI18n } from "@/i18n/I18nProvider";

export default function PrivacyDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(remoteGeometryEnabled);
  const [error, setError] = useState("");
  const geometryInfo = t("privacy.geometryInfo", { api: GEOMETRY_API });
  const apiStart = geometryInfo.indexOf(GEOMETRY_API);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-3xl w-[calc(100%-24px)] p-3 sm:p-5" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t(isAndroidBuild() ? "privacy.title" : "privacy.policyTitle")}</DialogTitle></DialogHeader>
      {isAndroidBuild() && <section className="rounded-md border p-3 text-sm">
        <label className="flex min-h-12 items-center gap-3 font-medium">
          <input type="checkbox" className="h-6 w-6 shrink-0" checked={enabled}
            onChange={event => {
              const value = event.target.checked;
              if (setRemoteGeometryEnabled(value)) { setEnabled(value); setError(""); }
               else setError(t("privacy.saveFailed"));
            }} />
          {t("privacy.loadGeometry")}
        </label>
        <p>{apiStart < 0 ? geometryInfo : <>
          {geometryInfo.slice(0, apiStart)}
          <strong>{GEOMETRY_API}</strong>
          {geometryInfo.slice(apiStart + GEOMETRY_API.length)}
        </>}</p>
        <p className="mt-2">{t("privacy.geometryInfo2")}</p>
        {error && <p role="alert">{error}</p>}
      </section>}
      <iframe title={t("privacy.frameTitle")}
        src={`${import.meta.env.BASE_URL}privacy.html`}
        className="w-full rounded-md border-0 bg-white"
        style={{ height: isAndroidBuild() ? "min(45dvh, 520px)" : "min(72dvh, 800px)" }} />
    </DialogContent>
  </Dialog>;
}
