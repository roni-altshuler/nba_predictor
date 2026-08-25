# DESIGN.md — Hardwood

A reusable design reference for this codebase: the tokens, the type, the
spacing, the components, and **the reasoning behind them**. Written in the
[getdesign.md](https://getdesign.md/) format so an agent picking up a new
page produces something that belongs here rather than a generic layout.

The visual language is **Bugatti** — ported from the sibling Pitchverse
(football) and RaceIQ (Formula 1) projects. Pure black canvas, hairline
structure, monospace numerics, and colour that only ever carries meaning.

---

## 1. The one-sentence brief

> A precision instrument, not a scoreboard: black, quiet, hairline-ruled,
> where every number is monospaced and every colour means something.

If a change makes the page louder without making a number clearer, it is
wrong.

---

## 2. Colour

### Canvas and surfaces

| Token | Value | Used for |
|---|---|---|
| `--background` | `#000000` | the page |
| `--card-bg` | `#0d0d0d` | every card and table surface |
| `--card-hover` | `#141414` | row and card hover |
| `--muted-bg` | `#1f1f1f` | bar tracks, inert fills |
| `--border-color` | `#262626` | **the hairline — this carries all structure** |
| `--border-hover` | `#3a3a3a` | hover only |

**Depth comes from hairlines, never from shadow.** `--shadow-*` are all
`none` and that is deliberate. No gradients, no glassmorphism, no glow.

### Ink

| Token | Value | Used for |
|---|---|---|
| `--text-primary` | `#ffffff` | headings, the number that matters |
| `--text-secondary` | `#cccccc` | body copy |
| `--text-tertiary` | `#999999` | captions, labels, absent values |

### Accents — four signals, and nothing else

| Token | Value | Means |
|---|---|---|
| `--accent-primary` | `#5fa657` | positive, favoured, model edge, playoff berth |
| `--accent-warn` | `#d4a017` | uncertainty, play-in band, champion, backtest label |
| `--accent-loss` | `#c1443c` | negative, eliminated, a miss |
| `--accent-info` | `#c3d9f3` | links and informational text **only** |

**Colour carries meaning only, never decoration.** A hue that is not one of
these four is not saying anything, and should be a shade of grey. If a new
state needs a colour, first ask whether it is really one of these four.

### Chart colour is VALIDATED, not chosen

Chart series use their own tokens because a chart mark is a different job
from a link or a caption:

| Token | Value | Slot |
|---|---|---|
| `--viz-model` | `#5fa657` | categorical 1 — this model |
| `--viz-market` | `#3987e5` | categorical 2 — the closing line |
| `--viz-reference` | `#4d4d4d` | de-emphasis: baselines, the ideal diagonal |
| `--viz-seq-1..5` | `#2c1a0e` → `#e2882f` | sequential, one hue, light→dark |
| `--viz-cat-1..3` | `#5fa657`, `#3987e5`, `#c25ba6` | categorical, for team identity |
| `--viz-cat-field` | `#57575a` | the aggregated tail, deliberately recessive |

These passed all six checks of the dataviz validator against the `#0d0d0d`
chart surface. **The first attempt used `--accent-info` for the market
series and failed two of them** — L 0.877 is far outside the 0.48–0.67 band
and chroma 0.043 reads as grey.

Tritan separation for the green/blue pair is ΔE 5.7, which is only legal
**with secondary encoding**, so both series are always direct-labelled as
well as coloured. That is a requirement, not styling.

**The categorical scale stops at three, and that is a measurement.** Re-run
with `--pairs all` — every line on a title-race chart is visible at once, so
checking only adjacent pairs misses the pair a reader actually confuses — the
trio above passes at worst ΔE 10.6 under CVD and 21.4 with normal vision.
Every four-hue set attempted failed:

| Pair | Worst ΔE | Why |
|---|---|---|
| green / orange | 4.6 deutan | the classic red-green confusion |
| blue / purple | 2.1 deutan, 13.1 normal | indistinguishable even with full colour vision |
| orange / red | 11.4 normal | too close in hue at a shared lightness |

So a fourth contender is never given a fourth hue. It folds into an explicit
"field" line — and because conference-title probabilities sum to one, three
named contenders plus the field is the entire distribution rather than a
truncation. Tritan separation for the trio is 4.6, below the floor, so a team
is ALWAYS direct-labelled at its line's right edge, with the labels nudged
apart so two never land on one row.

Rules that do not bend:
- Sequential = one hue, light→dark. Diverging = two hues + a neutral grey
  midpoint. **Never a rainbow.**
- **One axis. Never a dual-axis chart.**
- Colour follows the entity, never its rank.
- Past ~4 series, fold the tail into a de-emphasised band (see
  `RatingHistoryChart`) or an explicit aggregate (see `TitleRaceChart`)
  rather than generating more hues.

---

## 3. Type

Two families, and the split is functional:

| Family | Variable | Used for |
|---|---|---|
| Inter | `--font-sans` / `--font-display` | headings and prose |
| JetBrains Mono | `--font-mono-numeric` | **every number**, nav, buttons, captions, table headers |

- `h1`–`h3`: uppercase, `letter-spacing: 0.08em`, weight 600, `--text-primary`.
  **Positive tracking** — it is what makes the restraint elsewhere read as
  deliberate rather than unfinished.
- `.eyebrow`: monospace, uppercase, `0.14em`, 11px, `--text-tertiary`. The
  label above every stat.
- `.numeric`: monospace with `font-variant-numeric: tabular-nums`. **Every
  number in a table gets it** — a win column that jitters as digits change
  reads as a broken table, not a live one.

---

## 4. Spacing and layout

- Content shell: `--shell-content-max: 1160px`, sidebar `220px`, topbar `56px`.
- Section rhythm: `mb-8` between sections, `mb-3` between a heading and its
  content, `p-4` inside cards (`p-5` for a hero card).
- Stat tiles: a `grid-cols-2 sm:grid-cols-4` row of `.card p-3`.
- Tables: full-bleed inside a `.card overflow-x-auto`. Never let the page
  body scroll horizontally — the table scrolls inside its own container.

---

## 5. Components

| Component | Rule |
|---|---|
| `TeamLogo` | Official mark on a **light plate**. NBA logos are authored for light backgrounds and several vanish on black. Missing logo falls back to the abbreviation, never a broken image. |
| `ProbabilityBar` | The number is **always** text beside the bar. A reader cannot read 63% off a bar. |
| `GameCard` | A missing market renders as "no line published", never as a zero edge. A pre-game score reads `vs`, never `– - –`. |
| `EvidencePanel` | **Not a tab.** Every percentage on the site is unfalsifiable without it. |
| `CalibrationChart` | Dot area = sample size. Ships a `<details>` table view. |
| `PlayoffBracket` | Geometry is computed in `bracketLayout.ts` and asserted by tests. Never nested flexbox. Pans; never scaled down. |

---

## 6. Motion

Bounded, and every piece of it is feedback rather than decoration. The
vocabulary is one file (`src/lib/motion.ts`, ported from Pitchverse — one
ease-out curve, two springs) and the full inventory is:

- **Route transition** (`<PageTransition>`, mounted once in the shell):
  enter-only fade-and-rise, 350ms. No exit animation — an exit blocks the
  navigation the reader just asked for.
- **The mobile tab underline** slides between tabs via a shared
  framer-motion `layoutId`.
- **Probability bars glide** (`.prob-fill` / `.prob-segment`, 800ms) when a
  value changes — the predictor's Swap, a refreshed number.
- **Numbers count** (`<AnimatedNumber>`): the motion value writes straight
  to `textContent`, so no re-renders, and the server markup carries the
  final value so no reader ever sees 0 counting up.
- **`.skeleton-shimmer`** is the one moving gradient in the product, because
  a shimmer IS a moving gradient and it marks loading, never decoration.
- Hover transitions on border colour at `0.18s` — and hover fires **only on
  things that navigate** (`a.card`, `.card-link`, rows containing links).
  A static card that brightens promises a click it cannot honour.

No parallax, no scroll-jacking, no continuous ambient motion. Every motion
component renders static markup under `useReducedMotion()`, and
`prefers-reduced-motion: reduce` additionally collapses every CSS duration
to `0.01ms` globally in `globals.css`.

The reason is the product: a page of probabilities that performs on arrival
looks like it is performing rather than reporting. Motion here confirms what
the reader did (navigated, swapped, loaded) — it never happens by itself.

---

## 7. The honesty rules that are also design rules

These are not editorial preferences — they change what components render:

1. **Absent data renders as absent.** `—`, never `0`. "No line published" and
   "no edge" are different facts and a UI that draws them identically is
   lying about one of them. `pct(null)` returns `—` and there is a test.
2. **Every probability is text.** Colour and bar length are aids; the text is
   the claim.
3. **A backtest is labelled a backtest**, in the accent-warn colour, every
   place it appears.
4. **A result that does not beat its baseline is printed as such.** The
   playoff-series section says plainly that it does not beat "the higher
   seed advances".
5. **The caveat prints on a hit as well as a miss.** A hit read as proof is
   the same error in the flattering direction.

---

## 8. What NOT to add

- **A global search or command palette.** Every destination is one tap from
  the chrome; a shortcut chip advertises a bigger product than this is.
- **Gradients, shadows, glass, glow.** All four are explicitly out.
- **A light theme.** `<html class="dark">` is hardcoded, `:root` is the only
  source of truth, `.dark` is intentionally empty.
- **Tailwind palette colours.** `text-gray-400` bypasses the token layer.
  Always `text-[var(--text-tertiary)]`.
- **A second place a probability is computed.** The frontend renders
  published JSON. A component that recomputes is a model nobody benchmarked.
