import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/I18nProvider";
import { purchasePremium, refreshPremium, restorePremium } from "./store";
import { usePremium } from "./usePremium";

export default function PremiumDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const premium = usePremium();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const reload = async () => {
    setBusy(true); setMessage(""); setFailed(false);
    try { await refreshPremium(); }
    catch { setFailed(true); setMessage(t("premium.unavailable")); }
    finally { setBusy(false); }
  };
  useEffect(() => { void reload(); }, []);
  const run = async (restore: boolean) => {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      if (restore) {
        setMessage(t(await restorePremium() ? "premium.success" : "premium.notOwned"));
      } else {
        const result = await purchasePremium();
        if (result !== "cancelled") setMessage(t(result === "purchased" ? "premium.success" : "premium.pending"));
      }
    } catch { setFailed(true); setMessage(t("premium.purchaseFailed")); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-md w-[calc(100%-24px)]" aria-describedby="premium-description"
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{premium.package?.product.title || t("premium.title")}</DialogTitle></DialogHeader>
      <p id="premium-description">{t("premium.description")}</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>{t("premium.parts")}</li>
        <li>{t("premium.exports")}</li>
      </ul>
      <p className="text-sm">{t("premium.consent")}</p>
      {premium.active ? <p role="status">{t("premium.success")}</p> : <>
        <p>{premium.package ? t("premium.oneTime", { price: premium.package.product.priceString }) : t("premium.unavailable")}</p>
        <button type="button" className="popover-action" disabled={busy || !premium.package}
          onClick={() => void run(false)} data-testid="button-premium-purchase">
          {t(busy ? "premium.working" : "premium.buy")}
        </button>
        <button type="button" className="popover-action" disabled={busy} onClick={() => void run(true)}
          data-testid="button-premium-restore">{t("premium.restore")}</button>
        <button type="button" className="popover-action" disabled={busy} onClick={() => void reload()}
          data-testid="button-premium-retry">{t("premium.retry")}</button>
      </>}
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
      <button type="button" className="popover-action" disabled={busy} onClick={onClose}>{t("common.close")}</button>
    </DialogContent>
  </Dialog>;
}
