# Fonts

Self-hosted so the site makes no third-party request for typography.

| Family | Files | Licence |
| --- | --- | --- |
| Newsreader | `newsreader-var-*.woff2` (variable, 200–800) | SIL Open Font License 1.1 |
| IBM Plex Sans | `ibm-plex-sans-var-*.woff2` (variable, 300–600) | SIL Open Font License 1.1 |
| IBM Plex Mono | `ibm-plex-mono-{400,500}-*.woff2` | SIL Open Font License 1.1 |

All three are licensed under the SIL OFL 1.1, which permits redistribution and web embedding.
Full licence text: <https://scripts.sil.org/OFL>

Subsets are limited to `latin` and `latin-ext`. The `@font-face` rules at the top of
`assets/css/main.css` carry matching `unicode-range` declarations, so a browser only downloads
`latin-ext` when a character actually needs it.
