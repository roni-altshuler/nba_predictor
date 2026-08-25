# DESIGN.md — Hardwood

A reusable design reference for this codebase: the tokens, the type, the
spacing, the components, and **the reasoning behind them**. Written in the
[getdesign.md](https://getdesign.md/) format so an agent picking up a new
page produces something that belongs here rather than a generic layout.

The visual language is **Bugatti, Arena variant** — structure ported from
the sibling Pitchverse (football) and RaceIQ (Formula 1) projects, material
this sport's own. On 2026-08-25 the owner directed the canvas away from
neutral black: the ground is a warm hardwood dark — walnut canvas, plank
seams, a visible court — an arena at night, not a void. Hairline
structure, monospace numerics, and colour ON DATA that only ever carries
meaning are unchanged.

---

## 1. The one-sentence brief

> A precision instrument on an arena floor: walnut-dark, quiet,
> hairline-ruled, where every number is monospaced and every colour on
> data means something.

If a change makes the page louder without making a number clearer, it is
wrong.

---

## 2. Colour

### Canvas and surfaces

| Token | Value | Used for |
|---|---|---|
| `--background` | `#0c0705` | the page — deep walnut, not neutral black |
| `--card-bg` | `#17100a` | every card and table surface |
| `--card-hover` | `#211711` | row and card hover |
| `--muted-bg` | `#2c2015` | bar tracks, inert fills |
| `--border-color` | `#362718` | **the warm hairline — this carries all structure** |
| `--border-hover` | `#4d3a25` | hover only |

**Depth comes from hairlines, never from shadow.** `--shadow-*` are all
`none` and that is deliberate. No gradients, no glassmorphism, no glow.

### Ink

| Token | Value | Used for |
|---|---|---|
| `--text-primary` | `#fdf6ee` | headings, the number that matters |
| `--text-secondary` | `#d9cec2` | body copy |
| `--text-tertiary` | `#a2937f` | captions, labels, absent values |

### Accents — four signals, one brand hue, and nothing else

`--accent-brand` (`#e2682a`, the favicon's basketball orange) is **chrome
only**: the wordmark, the active-nav rail, the mobile tab underline, the
focus ring. It never colours a probability, a result, or a chart series —
the four semantic signals below own the data.

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

These passed all six checks of the dataviz validator against the then
`#0d0d0d` chart surface. The Arena re-theme moved that surface to
`#17100a` — a warmer hue at near-identical lightness, so the contrast and
lightness-band conclusions carry; re-run the validator before changing any
series hex. **The first attempt used `--accent-info` for the market
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
- **`.skeleton-shimmer`** marks loading — a shimmer IS a moving gradient,
  and it moves only while something is genuinely loading.
- **The ambient floor** (`AmbientBackground.tsx`) — two ember glows in the
  chart ramp's wood tones drifting on 52s/68s alternating periods over the
  plank-seamed walnut, transform-only, at negative z-index with
  pointer-events off (opaque cards paint over it by painting order alone).
  Under `prefers-reduced-motion` it is explicitly `animation: none` — the
  global duration clamp alone would make an infinite-alternate animation
  strobe rather than stop.
- **The chalk game** (`CourtField.tsx`) — a perpetual dim five-on-five on
  one full chalk court: O's in white, X's in amber, the ball in the brand
  orange, possessions flowing end to end with cuts, swings, drives,
  steals, fast breaks, boards and buckets. The whole court, both rims,
  is always in frame and centred on every device (portrait rotates it
  upright); the camera only breathes toward the action.
  Owner-requested (2026-08-25) as the layer's animated half; its
  full rules are §6a. The short version: no digits ever, chalk-dust
  alphas, the frame never chases the play, ~30fps, `requestAnimationFrame`
  only while the tab is visible, and a framed still under reduced motion.
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

## 6a. The chalk game

`CourtField` is the animated half of Hardwood's ambient layer, evolved
from the NFL sibling's `ChalkboardField` and rebuilt as a game at the
owner's request (2026-08-25): a fixed canvas at z-index −1 drawing one
full chalk court — both keys, both arcs, half-court line — and on it a
perpetual dim five-on-five. The O team is white chalk, the X team amber,
the ball the brand orange. **The whole court — both rims — is always in
frame, centred, on every device** (owner-directed): the floor is sized
to fit the viewport with margin, centred in the region beside the
desktop sidebar (a viewport-centred court hides its left rim behind the
opaque nav — measured), and portrait viewports draw it rotated upright
along the device's long axis. A possession runs five to twelve seconds:
advance, spread to the corners/wings/top while the defense drops
between its marks and the rim, swings (sometimes the passer cuts
through the lane), a drive with its man in tow — finishing at the rim
or kicking out for a catch-and-shoot — then the shot: a make blooms a
soft ring off the rim with the swish flicks, a miss comes off the iron
and the board turns the game the other way, sometimes at a dead run.
Passes can be stolen out of the lane; steals and some boards ignite
fast breaks. A flying ball leaves a fading chalk trail. Rules that
keep it a background and not a broadcast:

- **No digits, ever.** A score in the background is a number, and every
  number on this site is a claim. The bucket itself is the payoff.
- **It never sits under a number.** Cards, tables, and chrome are opaque
  by system rule; the game lives in the canvas and the gaps.
- Chalk-dust alphas only (court ≤ 0.30, players ≤ 0.45, ball and pulse
  ≤ 0.60; the ball's flight trail fades from half the ball's alpha). If
  a value wants to be higher than these, the answer is no.
- **The frame never chases the play.** The first cut had a broadcast
  camera that tracked the ball and pushed in to ~1.7× — the whole
  background moving is exactly the kind of motion that pulls a reader
  off the data, and the owner flagged it. The camera is now a breath:
  zoom ≤ ~1.05×, a lean of a few percent toward the ball, both eased
  slowly and clamped so the full floor never leaves view. The drama
  lives in the play (drives, steals, fast breaks, the trail, the
  swish), never in the framing, and never in brighter or thicker chalk.
- Slow and cheap: rendering is capped near 30fps, `requestAnimationFrame`
  runs only while the tab is visible, and reduced motion gets a single
  framed mid-possession still that never moves.
- The shell wrapper deliberately paints **no** background — the body's
  black is the canvas the board draws on. Reintroducing an opaque wrapper
  there silently deletes the board (and the hardwood wash beneath it).

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
- **Gradients, shadows, glass, glow — on COMPONENTS.** Buttons, cards,
  text and charts stay flat; colour on them carries meaning only. The
  standing exceptions live at the page's edges, not in its content: the
  loading shimmer, and the ambient layer — the hardwood wash (§6) and the
  chalk court (§6a) — which is capped at chalk-dust alphas and can never
  sit over content. **One layer, defined once, consumed once** — the same
  clause the Pitchverse and Gridiron siblings carry for their pitch and
  chalkboard layers. Its existence licenses nothing else to pick up a
  gradient. Do not add another.
- **A light theme.** `<html class="dark">` is hardcoded, `:root` is the only
  source of truth, `.dark` is intentionally empty.
- **Tailwind palette colours.** `text-gray-400` bypasses the token layer.
  Always `text-[var(--text-tertiary)]`.
- **A second place a probability is computed.** The frontend renders
  published JSON. A component that recomputes is a model nobody benchmarked.
