import { useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { MAX_PART_BATCH_PLACEMENT_UNITS } from "./placement-limits";
import type { LibraryPart } from "./types";

type Props = {
  part: LibraryPart;
  disabled?: boolean;
  onPlace: (part: LibraryPart, quantity: number) => void | boolean | Promise<void | boolean>;
};

export default function PartPlacementControl({ part, disabled = false, onPlace }: Props) {
  const { t } = useI18n();
  const [quantityText, setQuantityText] = useState("1");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const quantity = Number(quantityText);
  const valid = /^\d+$/.test(quantityText) && Number.isSafeInteger(quantity) &&
    quantity >= 1 && quantity <= MAX_PART_BATCH_PLACEMENT_UNITS;
  const testId = part.id.replace(/[^a-zA-Z0-9_-]/g, "-");

  async function place() {
    if (!valid || pending || disabled) return;
    setPending(true);
    setLocalError("");
    try {
      const result = await onPlace(part, quantity);
      if (result === false) setLocalError(t("parts.placeFailed"));
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : t("parts.placeFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="plib-placement-wrap">
      <div className="plib-placement-control">
        <label>
          <span>{t("parts.quantity")}</span>
          <input
            type="number"
            min={1}
            max={MAX_PART_BATCH_PLACEMENT_UNITS}
            step={1}
            inputMode="numeric"
            value={quantityText}
            onChange={event => { setQuantityText(event.target.value); setLocalError(""); }}
            aria-label={t("parts.quantityFor", { name: part.name })}
            data-testid={`input-part-quantity-${testId}`}
          />
        </label>
        <button
          type="button"
          className="plib-placement-button"
          disabled={disabled || pending || !valid}
          onClick={() => void place()}
          aria-label={t("parts.placeQuantityFor", { quantity: valid ? quantity : 0, name: part.name })}
          data-testid={`button-place-quantity-${testId}`}
        >
          <Plus size={15} />
          <span>{pending ? t("parts.placing") : t("parts.placeQuantity", { quantity: valid ? quantity : 0 })}</span>
        </button>
      </div>
      {!valid && <p className="plib-placement-error" role="alert">
        {t("parts.quantityRange", { max: MAX_PART_BATCH_PLACEMENT_UNITS })}
      </p>}
      {localError && <p className="plib-placement-error" role="alert">{localError}</p>}
    </div>
  );
}
