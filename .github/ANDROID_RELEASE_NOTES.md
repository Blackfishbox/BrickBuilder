# Localized Google Play release notes

Every Android app change pushed to `android/google-play` must include one
user-facing note in German and one in English:

```text
Describe a visible user change

Release-Notes-DE: Eine konkrete, kurze Beschreibung der Änderung.
Release-Notes-EN: A concise, concrete description of the same change.
```

The workflow publishes these as `de-DE` and `en-US`. Each locale has Google's
500-character limit. Notes must describe what users can actually do or notice;
do not infer a feature from filenames or use generic summaries such as
“updated instructions.”

For a release batch that contains older commits without both translations, the
latest commit may provide one complete summary for the affected locale:

```text
Release-Notes-DE-Complete: Vollständige kurze Zusammenfassung auf Deutsch.
Release-Notes-EN-Complete: A complete concise summary in English.
```

A complete note replaces the per-commit aggregation for its language only.
Manual workflow runs can instead provide separate German and English notes.
