# Store listing assets

Assets for the Chrome Web Store and Firefox AMO listings. Nothing in this
directory ships in the extension zips — `scripts/build.js` stages only the
runtime files and `icons/`.

## In this directory

- `promo-tile-small-440x280.svg` / `.png` — Chrome "small promo tile"
- `promo-tile-marquee-1400x560.svg` / `.png` — Chrome "marquee promo tile"

The SVGs are the masters; the PNGs are the exact files uploaded to the store
(flattened to 24-bit no-alpha, which Chrome requires). Text renders in
Helvetica, so re-rasterizing on a non-mac may shift the wordmark slightly —
prefer editing the SVG and re-rendering with `@resvg/resvg-js` +
`sharp(...).removeAlpha()`.

## Derived elsewhere

- **Store icon**: upload `../icons/icon-128.png` as-is (alpha is allowed for
  the icon slot).
- **Screenshots** (Chrome wants 1280×800 or 640×400, 24-bit, no alpha): the
  README screenshots in `docs/screenshots/` are 1440×900 — the same 16:10
  aspect — so they just get downscaled and flattened, e.g. with sharp:
  `sharp(src).resize(1280, 800).removeAlpha().png({ palette: false })`.
  AMO reuses the same files.

## Listing text

The descriptions, privacy-practice justifications, and reviewer notes live in
the store dashboards; the privacy policy they link to is `/PRIVACY.md` at the
repo root. Store updates are manual: after a release, upload the fresh
`reddit-cached-extension*.zip` build to each dashboard (versions must
strictly increase).
