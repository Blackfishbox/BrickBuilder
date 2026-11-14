# BrickLink wanted-list XML export

Open the project menu, choose **Datei importieren / exportieren**, then
**BrickLink-Teileliste (.xml)**. This exports the current editor state, including
unsaved edits, rather than the original imported archive or unused inventory.

The UTF-8 XML contains `INVENTORY / ITEM` records with `ITEMTYPE=P`,
the confirmed BrickLink `ITEMID`, BrickLink `COLOR`, and aggregated `MINQTY`.
Each placed instance is counted once, including parts without renderable geometry.
Geometry primitives are not individual purchased parts. Assemblies retain their
mapped catalog item identity. Different colors and part variants remain separate.
No item condition, price, seller, or target wanted-list ID is imposed.

In BrickLink's Wanted List upload, choose **Upload BrickLink XML format**,
paste the exported file contents, then review the uploaded items before saving.
BrickBuilder does not sign in, submit data, buy parts, or create a wanted list
automatically. Acceptance by BrickLink and actual availability of a particular
part/color combination must be checked there; no live upload was verified.

The exporter refreshes mappings from the available reviewed catalog and saved
evidence without mutating the project. A failed optional catalog load does not
prevent use of already confirmed evidence. Missing or conflicting mappings block
the whole export and show affected references, color codes and quantities.
No incomplete list is silently downloaded. LDraw filenames are not assumed to
be BrickLink IDs, and RGB colors are not rounded to purchasable colors.

Tests cover aggregation, aliases, edits/deletions, missing geometry, conflicts,
unknown colors, unchanged source data, XML re-import through the existing list
parser, and the export button's download/error behavior.
