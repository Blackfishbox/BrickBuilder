# Adding a language

All application UI text lives in `messages.ts`. The English catalog is the
reference catalog; `MessageId` is derived from its keys, so TypeScript checks
that every translated catalog contains the same messages.

To add a language:

1. Add its locale code to the `Locale` union.
2. Create a `MessageCatalog` object with a translation for every English key.
3. Add that catalog to `catalogs` and its code to `supportedLocales`.
4. Add a display name for it to each existing catalog (`language`, `english`,
   and `german` are the current examples).
5. Run the app type check and i18n tests.

`I18nProvider` stores the selection locally and defaults to German. The landing
page and privacy pages are standalone HTML, so their translations and German
defaults are maintained in those pages' own dictionaries.

Keep catalog names, part IDs, imported project text, and legal license text in
their source form unless a separate, verified translation is available.
