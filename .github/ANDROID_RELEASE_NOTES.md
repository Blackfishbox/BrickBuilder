# German Google Play release notes

Every non-merge commit pushed to `android/google-play` must include one
user-facing German summary in its commit message:

```text
Implement a user-visible change

Release-Notes-DE: The visible change, outcome, or fix in one concise German sentence.
```

The trailer is the versioned source used by the Play workflow. It must describe
what users can actually do or notice; do not infer a feature from filenames or
repeat a generic phrase such as “updated instructions.” English commit subjects
remain encouraged; only the trailer is German.

The workflow collects each unique trailer from every non-merge commit after the
last successfully published alpha release. Commits from failed builds are
included. If a trailer is missing, duplicated within a commit, or the combined
notes exceed Google Play's 500-character limit, publishing stops with an error
that identifies the required correction. Shorten the trailers or provide
explicit German notes when manually dispatching the workflow.
