import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supportedLocales, translate, type Locale, type MessageId } from "./messages";

export const LANGUAGE_STORAGE_KEY = "brickbuilder-language";

interface I18nValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(id: MessageId, values?: Record<string, string | number>): string;
}

const I18nContext = createContext<I18nValue | null>(null);

function storedLocale(): Locale {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return supportedLocales.includes(value as Locale) ? value as Locale : "de";
  } catch {
    return "de";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(storedLocale);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // The current language still applies for this session if storage is unavailable.
    }
  }, []);
  const t = useCallback((id: MessageId, values?: Record<string, string | number>) =>
    translate(locale, id, values), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  const locale = storedLocale();
  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Components rendered outside the app provider still use this language for the current render.
    }
  }, []);
  const t = useCallback((id: MessageId, values?: Record<string, string | number>) =>
    translate(locale, id, values), [locale]);
  const fallback = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return context ?? fallback;
}
