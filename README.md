# @jusev/react-native-fold

**Foldable and shared-display layout signals for React Native — measured, not guessed.**

Supports iPhone Duo and Android foldables, via iOS 27.1 reserved regions and Jetpack WindowManager.

One hook reports where the fold falls, which half is which, how far down a side column the system's glyphs reach, and which edge your toolbar belongs on. Every value comes from the OS. There is no device list, no model check, no `isDuo` — see [No device detection](#no-device-detection).

```tsx
import { useFoldSignals } from "@jusev/react-native-fold";

const { chromeSide, foldAxis, halves, topChrome, railReserve } = useFoldSignals();
```

---

## Contents

- [Why this exists](#why-this-exists)
- [Install](#install)
- [Quick start](#quick-start)
- [You never check for "normal"](#you-never-check-for-normal)
- [How it works](#how-it-works)
- [API reference](#api-reference)
  - [`useFoldSignals()`](#usefoldsignals)
  - [`getFoldSignals()`](#getfoldsignals)
  - [`FoldSignals`](#foldsignals)
  - [`ReservedRegion`](#reservedregion)
  - [`TopChrome`](#topchrome)
  - [`Rect`](#rect)
  - [`<FoldDebugOverlay />`](#folddebugoverlay-)
- [Recipes](#recipes)
- [Pitfalls](#pitfalls)
- [Debugging](#debugging)
- [Contributing, and monorepos](#contributing-and-monorepos)
- [Testing](#testing)
- [No device detection](#no-device-detection)
- [Fallback is part of the contract](#fallback-is-part-of-the-contract)
- [Platform support](#platform-support)
- [FAQ](#faq)
- [Status](#status)

---

## Why this exists

React Native apps get one number per edge from the safe-area API: how wide the inset is. On a foldable that is not enough to lay out against, and on a shared display it is actively misleading.

**The status glyphs move to the side.** On a folded device the Dynamic Island, the clock and the Wi-Fi glyph sit in a **vertical column** rather than along the top. So `insets.top` is `0` — correctly, because nothing is above your content — and nothing reports how far *down* that column the system's own glyphs reach.

**The fold is invisible.** No inset describes a crease. A form can run straight across it; a button can land on it.

**A split boundary reserves nothing.** An app on the left half of a display and an app on the right half see identical insets: `0` on both sides. And the system hands a shared-display window its *own coordinate space*, so `window.frame.origin` is `{0, 0}` whichever half you occupy. From inside the app, left and right are indistinguishable — yet your toolbar belongs on the outer edge, and that is a different edge in each case.

**A measured constant cannot substitute.** The depth of the system's glyphs in a side column differs between the two displays of a single handset, and between one handset and the next. A value read off a screenshot of one display is wrong on the other.

---

## Install

### Requirements

| | |
|---|---|
| React Native | 0.76+ (New Architecture) |
| Android | 7.0+ (API 24). Adds `androidx.window` 1.3 |
| `expo-modules-core` | required — this is an Expo module, and works in a bare RN app via [`install-expo-modules`](https://docs.expo.dev/bare/installing-expo-modules/) |
| iOS | builds on 16.4+; **reports regions on 27.1+**, falls back cleanly below |
| Expo Go | not supported — use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) |

### Add the package

```sh
npm install @jusev/react-native-fold
```

### iOS

```sh
npx expo prebuild -p ios     # managed projects only
npx pod-install              # or: cd ios && pod install
```

Autolinking picks the module up from `expo-module.config.json`. There is nothing to register, no native code to write, and no change to `AppDelegate`.

---

## Quick start

```tsx
import { useFoldSignals } from "@jusev/react-native-fold";

export default function Screen() {
  const { chromeSide, foldAxis, halves, fold } = useFoldSignals();

  // 1. Where does my toolbar go?
  const toolbar = chromeSide ? <Rail side={chromeSide} /> : <TopBar />;

  // 2. Is the device folded, and which way?
  if (foldAxis === "tabletop" && halves && fold) {
    return (
      <>
        {toolbar}
        <View style={{ height: halves.first.height }}><Transcript /></View>
        <View style={{ height: fold.height }} />
        <View style={{ height: halves.second.height }}><Controls /></View>
      </>
    );
  }

  // 3. Flat, or a fold you do not handle: everything is null, and this is
  //    the layout you already shipped.
  return (
    <>
      {toolbar}
      <SingleColumn />
    </>
  );
}
```

Every signal is inert on a flat device, so each branch is a null check that falls through to what you already have. **A foldable branch cannot regress a phone.**

---

## You never check for "normal"

**There is no mode, and no flag meaning "ordinary phone".** Every signal is `null` or `0` when there is nothing unusual, so there is no normal branch to write. Write the UI you already have and hang the special cases off it as null checks:

```tsx
// Your toolbar. On a phone chromeSide is null and this is your top bar,
// exactly as it was before you installed anything.
{chromeSide ? <Rail side={chromeSide} /> : <TopBar />}

// Your content. On a phone fold is null, so this styles nothing.
<ScrollView style={fold ? avoidFold(fold) : null}>
```

A phone, an iPad, a flat foldable, and a foldable in a pose you have not handled all reach the same code path: the one you already had. **A foldable branch cannot regress a phone, because on a phone the branch does not exist.**

To ask the question explicitly — to skip an expensive branch, say — it is one line:

```tsx
const { hasFold, chromeSide } = useFoldSignals();
const nothingUnusual = !hasFold && chromeSide === null;
```

It is not a field, deliberately. A single boolean invites two code paths for one screen, and the foldable path is only ever exercised by whoever owns the hardware.

---

## How it works

Both platforms are asked the same two questions and answer in the same two kinds:

| | iOS 27.1 | Android |
|---|---|---|
| what claims space | `UIView.reservedRegions(kind:options:)` | `FoldingFeature` · `DisplayCutout` · the status bar |
| when to re-read | an observer view's `layoutSubviews` | `WindowInfoTracker` + a decor-view layout listener |

In both kinds:

| kind | meaning |
|---|---|
| `occlusion` | something is drawn over this area — the Island, the camera, the status glyphs |
| `division` | the layout should split here — the fold, the hinge, a seam |

Every value this package reports is in **points**, in the **window's own coordinate space** — which is what React Native lays out in, so you never convert anything.

### Change detection

**UIKit posts no notification when reserved regions change.** It expects a view to re-query them *while it lays out*. From JavaScript the nearest available signal is a window resize — and that arrives **before** the window has finished moving to the other display of a foldable, so reading then returns the regions of the panel you are *leaving*, and the app lays out against the wrong panel until something else disturbs it.

So the package installs an inert, invisible, non-interactive view at the back of the window and reports from inside UIKit's own layout pass. `layoutSubviews` fires for a fold, an unfold, a rotation, a Split View resize and a display change alike — the whole set of events that can move a region.

**Android needs the same trick for the same reason.** `WindowInfoTracker` calls back when the *folding features* change and at no other time, so moving to the outer display, or rotating a device that is not folded, recomputes nothing — and the app lays out for the window it used to be in. A layout listener on the decor view is the counterpart of the iOS observer.

It also watches for scene activation, because **being resized into or out of a shared display can hand the app a different `UIWindow`**. The observer view goes with the old one: still laid out, still reporting, about a window nobody is looking at. `layoutSubviews` cannot catch that — the view it belongs to is no longer in the window that matters.

A change is emitted only when something a caller can see has changed: the regions **and** the window metrics. Regions alone are not enough — a window can move across the display without its regions changing, because neither half of a split reserves anything.

---

## API reference

### `useFoldSignals()`

```ts
function useFoldSignals(): FoldSignals
```

The hook. Read it anywhere; it stays current. It re-reads whenever the system lays the window out — a fold, an unfold, a rotation, a Split View resize, a move between displays. You do not subscribe to anything, render anything, or decide when to look.

Safe to call in as many components as you like: the work is a synchronous native read, and the result is memoised per update.

### `getFoldSignals()`

```ts
function getFoldSignals(): FoldSignals
```

A one-off read for code outside React — a navigation option, a layout calculation in a plain function, a value you need before mounting. **It does not update.** Prefer the hook in anything that renders.

### `FoldSignals`

```ts
type FoldSignals = {
  regions: ReservedRegion[];
  hasFold: boolean;
  fold: ReservedRegion | null;
  foldAxis: "book" | "tabletop" | null;
  halves: { first: Rect; second: Rect } | null;
  railReserve: number;
  topChrome: TopChrome | null;
  outerSide: "left" | "right" | null;
  chromeSide: "left" | "right" | null;
  insets: { top: number; right: number; bottom: number; left: number };
  source: "native" | "fallback";
};
```

| field | type | what it is |
|---|---|---|
| `regions` | `ReservedRegion[]` | every region the system has reserved, raw — including the status bar on Android. You rarely need this; the fields below are what it is for. |
| `hasFold` | `boolean` | the system declares a division: a fold, a hinge, a seam. |
| `fold` | `ReservedRegion \| null` | that division's rect. Use `fold.width` / `fold.height` as the **gap between your panes** — it spans the crease, margins included. |
| `foldAxis` | `"book" \| "tabletop" \| null` | which way the crease runs. `"book"` divides left from right; `"tabletop"` divides top from bottom. Derived from the region's own shape, not from a pose enum. |
| `halves` | `{ first, second } \| null` | the two usable rects the crease leaves, in window coordinates, so you can place into one without recomputing geometry. `first` is the left or upper half. |
| `railReserve` | `number` | how far down **the chrome's own column** the system's glyphs reach. `0` when that column is clear. This is the number that otherwise gets hard-coded. |
| `topChrome` | `TopChrome \| null` | the free strip beside corner-anchored status chrome, for putting a bar *beside* the clock instead of below it. `null` whenever the chrome is centred, or spans the full top edge as an Android status bar does. |
| `outerSide` | `"left" \| "right" \| null` | which display edge this window is flush against, when it is against one and not the other. `null` when the window fills the display. |
| `chromeSide` | `"left" \| "right" \| null` | **which edge your toolbar belongs on.** `null` means across the top, the way a phone has always done it. |
| `insets` | `{ top, right, bottom, left }` | the window's safe-area insets, read in the same layout pass as everything else. The same numbers `react-native-safe-area-context` gives you; they do not disagree. |
| `source` | `"native" \| "fallback"` | whether these numbers came from the OS at all. See [below](#source-tells-a-real-zero-from-an-unanswered-question) — most apps never read it. |

#### `source` tells a real zero from an unanswered question

Two quite different situations produce **identical-looking data**, and `source` is the only thing that separates them.

Take `railReserve: 0`:

- with `source: "native"`, the package asked the system and the system said *nothing is reserved at the head of that column*. Zero is the truth. Do not pad.
- with `source: "fallback"`, the package could not ask anyone. Zero is a placeholder.

Same for `fold: null` — "the device is flat right now" versus "I have no idea whether it is folded". You cannot tell those apart from the value.

| `source` | when |
|---|---|
| `"native"` | iOS 27.1+ or Android, in a development build with the native module linked — the OS answered |
| `"fallback"` | iOS below 27.1 · web · Expo Go · a missing `pod install` · Jest |

Under `"fallback"` every field is the flat default: no fold, no regions, no chrome side, all zeros. That is deliberate — your foldable branches take their null path and the app behaves exactly as it did before you installed anything.

**Most apps never read it.** You need it in one case: when you keep a constant of your own as a last resort, and want it applied *only* where the system stayed silent.

```tsx
const { railReserve, source } = useFoldSignals();
const reserve = source === "native" ? railReserve : MY_ESTIMATE;
```

The test is `source === "native"` — **not** `railReserve > 0`. That distinction is a [pitfall](#pitfalls): an edge where iOS truthfully said *nothing is reserved here* gets a constant measured for a different edge, and the first button on the rail ends up a third of the way down a column with nothing above it.

The other use is diagnostic. If everything is `null` on a device you know folds, `source` tells you immediately whether that is a layout problem or just the module not loading.

#### `chromeSide` is the one to read

It already combines the two unrelated-looking facts that decide the edge, so an app never writes this rule itself:

- a display whose system chrome runs **down one side** reserves that strip, and your glyphs belong in the same column rather than starting a second one beside it;
- a window **sharing the display** with another app has one outer edge and one split boundary, and chrome belongs on the outer one.

The reserved strip wins where there is one, because that is a column the system has already committed to. `outerSide` and the raw insets remain available if you want to decide differently.

### `ReservedRegion`

```ts
type ReservedRegion = {
  kind: "occlusion" | "division";
  x: number;
  y: number;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
};
```

**A region is a box, not a layout.** Its frame is the space the system claimed; it says nothing about where *inside* that space the clock and the glyphs are drawn, and `margins` comes back `0` on every side today. They are not centred in it either: the top of a reservation in a screen corner falls under the display's corner curve, so the glyphs sit low in the box. A bar matched to the reservation rides visibly above the clock it shares a line with.

`topChrome` resolves that for you. Work from `regions` directly only if you have a reason to.

### `TopChrome`

```ts
type TopChrome = {
  side: "left" | "right";   // which side of the top edge is FREE
  width: number;            // how wide that free strip is
  top: number;              // where the system's glyphs begin
  height: number;           // how tall the glyph band is
  reserved: number;         // the full depth of the reservation
  estimated: boolean;       // true when the band was inferred, not reported
};
```

- **`side`** names the side that is **free** — where your bar's content goes. The chrome is on the other one.
- **`reserved`** is for your bar's own height, so its surface covers everything the system claimed.
- **`top` and `height`** place your row *inside* that, on the glyphs.
- **`estimated`** is `true` when the band was inferred rather than read from reported margins, which is what both platforms do today — iOS 27.1 reports zero margins and Android reports none at all. The two constants behind the estimate live in this package and are discarded the moment the system reports real margins. **No app using this should carry a status-bar constant of its own.**

`null` whenever the reserved thing is **centred**, as a Dynamic Island is on an ordinary phone: there the free space is two strips with the chrome between them, and a single row cannot use it without straddling.

### `Rect`

```ts
type Rect = { x: number; y: number; width: number; height: number };
```

### `<FoldDebugOverlay />`

```tsx
import { FoldDebugOverlay } from "@jusev/react-native-fold";

<FoldDebugOverlay />
```

Draws the safe area, every reserved region and the glyph band, and prints the numbers your layout was actually given. See [Debugging](#debugging) for what to look for.

| prop | default | |
|---|---|---|
| `enabled` | `true` | turn it off without unmounting — a settings toggle, a shake gesture, a dev menu |
| `showInProduction` | `false` | the deliberate escape hatch, below |

**It cannot ship by accident.** Left mounted in a release build it renders `null` and nothing else. That is not a convention or a lint rule — it is the component's first line:

```tsx
const allowed = __DEV__ || showInProduction;
```

`enabled` cannot override it. Shipping the overlay takes writing `showInProduction` at the call site, which is not a thing anybody types by mistake:

```tsx
<FoldDebugOverlay />                       // dev only
<FoldDebugOverlay enabled={debugLayout} /> // dev only, behind your own flag
<FoldDebugOverlay showInProduction />      // deliberate, and obvious in review
```

It exists rather than being impossible because there are real reasons to want it — a TestFlight build chasing a layout bug that only reproduces on someone else's device. It is a separate prop from `enabled` precisely so that shipping it is a decision somebody made, not a flag that happened to be true.

The overlay is `pointerEvents="none"` and absolutely positioned, so it cannot change a measurement it is there to report, or swallow a tap.

---

## Recipes

Every recipe is the same hook read differently. None of them asks what device it is on.

### 1. Flat — an ordinary phone

Every signal that describes a fold or a side column is inert:

```ts
{ hasFold: false, fold: null, foldAxis: null, halves: null,
  railReserve: 0, topChrome: null, outerSide: null, chromeSide: null,
  source: "native" }
```

`regions` and `insets` are **not** empty here — a phone still has an Island or a
cutout and a status bar, and the package reports them. `source` is `"native"`
because the system answered; it is only `"fallback"` where nothing could be
asked. What is inert is everything a foldable branch tests.

That is deliberate, and it is what makes the rest of the recipes safe. Each is a null check falling through to the layout you already ship:

```tsx
const { fold } = useFoldSignals();

<ScrollView style={fold ? avoidFold(fold) : null}>
```

There is no separate compact path to keep in sync.

### 2. A side rail — your toolbar down the edge

Read `chromeSide` and put your toolbar there. That is the whole rule:

```tsx
const { chromeSide, railReserve, insets } = useFoldSignals();

if (chromeSide === null) return <TopBar />;

// The rail sits IN the reserved strip, so it is as wide as the strip. Where
// nothing is reserved — the outer edge of a shared display — fall back to a
// width of your own. This is the one constant you still need.
const RAIL_WIDTH = 72;
const width = insets[chromeSide] || RAIL_WIDTH;

return (
  <View
    style={[
      styles.rail,
      {
        [chromeSide]: 0,
        width,
        // Clear of the system's own glyphs at the head of the column.
        //
        // railReserve is 0 when that column is clear, and 0 is an ANSWER —
        // so floor it at a gutter of your own rather than substituting a
        // constant. A rail lives in a corner, and a display's rounded
        // corner is not an obstruction the safe area reports: it is simply
        // absent. One tap target puts the first button where a header's row
        // would start.
        paddingTop: Math.max(railReserve + insets.top, 44),
        paddingBottom: 24 + insets.bottom,
      },
    ]}
  >
    {actions}
  </View>
);
```

**Your content must also clear the rail.** The inset alone does not promise that — on an edge the system reserved nothing along, it is `0`:

```tsx
const railWidth = chromeSide ? insets[chromeSide] || RAIL_WIDTH : 0;
const sides = {
  paddingLeft: 20 + (chromeSide === "left" ? Math.max(insets.left, railWidth) : insets.left),
  paddingRight: 20 + (chromeSide === "right" ? Math.max(insets.right, railWidth) : insets.right),
};
```

Controls too wide to work vertically stay in a horizontal bar — that is Apple's own exception, not a limitation here.

### 3. Chrome in a corner — a bar beside the clock

Held in portrait, a foldable's status glyphs sit in one **corner** of the top edge rather than across it. The safe-area inset does not describe that: it is conservative, pushing content below the full height of whatever is up there, across the whole width. So your header drops below the clock and wastes a band of screen, with the rest of that row sitting empty beside it.

`topChrome` is the precise answer:

```tsx
const { topChrome, insets } = useFoldSignals();

<View
  style={[
    styles.bar,
    topChrome
      // The bar covers the whole reservation; the padding drops its row onto
      // the glyph band inside it.
      ? { paddingTop: topChrome.top, height: topChrome.reserved }
      // Centred chrome (an ordinary Island) — below it, as always.
      : { paddingTop: insets.top },
  ]}
>
  <View
    style={[
      styles.row,
      topChrome && {
        maxWidth: topChrome.width,
        alignSelf: topChrome.side === "left" ? "flex-start" : "flex-end",
        height: topChrome.height,
      },
    ]}
  >
    {title}
    {actions}
  </View>
</View>
```

> **Watch the sides.** `side` names the **free** side. If you pad your bar instead of aligning its row, the padding goes on the *other* edge — the one the chrome is on. Getting that backwards slides the row across the bar and hides its far end under the glyphs.

### 4. Book fold — a vertical crease

`foldAxis === "book"` means the device is held part-open like a book and the crease divides **left from right**. Apple's guidance is not to avoid the fold but to stop straddling it: text broken across the crease is hard to read, and a control landing on it is hard to press.

Shift the column into the half it is already mostly in. Applied to a **scroller**, this confines the viewport to that half, so long content scrolls *within* it — a one-off shift cannot promise that, since a form longer than half a screen simply spills across:

```tsx
const { fold, foldAxis } = useFoldSignals();
const { width } = useWindowDimensions();

const avoid =
  fold && foldAxis === "book"
    ? fold.x >= width - (fold.x + fold.width)
      ? { paddingRight: width - fold.x }       // more room on the left
      : { paddingLeft: fold.x + fold.width }   // more room on the right
    : null;

<ScrollView style={avoid} contentContainerStyle={styles.content}>
```

Choosing the **larger** half keeps the decision stable as the device opens and closes, instead of flipping sides partway through.

### 5. Tabletop fold — a horizontal crease

`foldAxis === "tabletop"` means one half is standing the other up on a surface. The upper half is read at a distance; the lower half is where a hand rests. So **content above, controls below**, and nothing on the ridge:

```tsx
const { foldAxis, fold, halves } = useFoldSignals();

if (foldAxis === "tabletop" && halves && fold) {
  return (
    <>
      <View style={{ height: halves.first.height }}><Transcript /></View>
      <View style={{ height: fold.height }} />          {/* the ridge */}
      <View style={{ height: halves.second.height }}><Controls /></View>
    </>
  );
}
return <SinglePaneLayout />;
```

Two things matter as much as the arrangement:

- **Size from `halves`, not with `flex: 1`.** A flexed child divides a height its parent does not have when the parent is itself in a scroller, and you get a zero-height pane with no error.
- **Give each half its own scroller.** One scroller spanning both means reading the top moves the bottom, so a control slides away under the hand reaching for it, and the crease runs through whatever happens to be passing it.

**Poses are not modes.** Everything reachable when flat stays reachable when folded — the arrangement changes, the feature set does not. A cheap guard: mount every screen in each shape and assert the same set of accessibility labels.

### 6. Two panes across a fold

If you already have a master/detail or split layout, the fold just says where it divides. **Use widths, not flex:**

```tsx
const { fold, foldAxis } = useFoldSignals();
const { width } = useWindowDimensions();

// Your container's own side padding, whatever it is.
const pad = { left: 0, right: 0 };

const columns =
  foldAxis === "book" && fold
    ? {
        first: fold.x - pad.left,
        crease: fold.width,
        second: width - pad.right - (fold.x + fold.width),
      }
    : null;

<View style={{ flex: 1, flexDirection: "row" }}>
  <View style={columns ? { width: columns.first } : { flex: 1 }}>
    <List />
  </View>
  {/* The crease, doing the divider's job. */}
  <View style={columns ? { width: columns.crease } : styles.hairline} />
  <View style={columns ? { width: columns.second } : { flex: 1 }}>
    <Detail />
  </View>
</View>
```

> **Why not `flex: 1` on both?** Two flex children divide a container in half, and half of a container is the crease only when the container is **centred on it**. It is not, as soon as one edge carries a rail. The error is the difference between the two paddings — a handful of points, enough to place a control on the fold.

> **A child must not subtract the fold twice.** Once a pane is placed by the fold, anything inside it that *also* pads for the fold pads by a whole half of the **window** inside a pane that is itself half a window — which leaves nothing. If a component can be used both as a whole screen and as a pane, give it a prop saying which, and skip the fold padding when it is a pane. A pane in the **far** half still owes its outer edge the usual safe-area inset, though: it is against that edge.

> **`crease` can be `0`.** On a foldable with a continuous display there is no physical gap, so the fold reports zero width and these two panes will meet with nothing between them. If your design wants breathing room there, floor it yourself — see [Android](#android).

> **Sizing a child directly? Watch its margins.** A margin sits *outside* a width, so a card with `marginHorizontal: 16` given `width: columns.first` ends 16pt past the column, in the crease. Size the column around it instead and let the margin become breathing room from the fold.

### 7. Alerts, sheets and modals

Across a book fold, a centred modal lands on the crease. Apple's guidance is to put it on the **trailing** half, which is where the experience continues as the device closes onto the outer display:

```tsx
const { foldAxis, fold } = useFoldSignals();

const sheetInsets =
  !fold || !foldAxis
    ? null
    : foldAxis === "tabletop"
      // A sheet rises from the bottom edge: it belongs in the lower half,
      // which is also where the hand that taps its buttons rests.
      ? { paddingTop: fold.y + fold.height }
      : { paddingLeft: fold.x + fold.width };

<Modal transparent>
  {/* The BACKDROP takes the padding. A sheet sizes itself against the
      backdrop — a bottom anchor, maxHeight as a percentage of it — so
      padding anything inside the sheet leaves the sheet's own frame, its
      corners and its blur, lying across the crease. */}
  <View style={[styles.backdrop, sheetInsets]}>
    <View style={styles.sheet}>{children}</View>
  </View>
</Modal>
```

The backdrop itself stays full-bleed and keeps dimming the whole window. It is the **content** that must not cross the fold, not the dimming.

A React Native `<Modal>` is its own window, so read the hook **inside** it rather than passing values down from the screen behind.

### 8. A shared display (Split View)

The case no other API can answer, and it needs no extra code — it is `chromeSide` again:

```tsx
const { chromeSide, outerSide } = useFoldSignals();
// Left half of a split  → "left"
// Right half of a split → "right"
// Whole display         → whatever the system reserved, else null
```

Why nothing else works:

| | |
|---|---|
| safe-area insets | a split boundary reserves nothing, so both sides read `0` and the two halves are identical |
| `window.frame.origin` | the system gives a shared-display window its **own** coordinate space, so it is `{0, 0}` on either side |
| screen width vs window width | tells you that you are sharing, never **which half** |

The package converts the window into the screen's coordinate space, which is the one thing that answers it — and the *orientation-aware* space, not `fixedCoordinateSpace`, which is locked to portrait and turns a left/right question into a top/bottom answer.

---

## Pitfalls

Each of these produces a layout that looks plausible and is wrong.

| Pitfall | Why it fails | Use instead |
|---|---|---|
| Hard-coding the side-column reserve | The depth differs between one device's two displays | `railReserve` |
| Treating `railReserve: 0` as "no answer" | `0` means nothing is reserved there, which is correct on the outer edge of a shared display | branch on `source` |
| Centring a row in the reservation | The reservation is a claimed box, not the layout inside it; the glyphs sit low in it | `topChrome.top` + `.height` |
| Splitting a container with `flex: 1` | Half a container is the crease only if the container is centred on it | `fold.x`, `fold.width` |
| Reading regions on a window resize | The resize arrives before the window has moved to the other display | the hook |
| Reading a side inset as a chrome column | A rotated phone's camera cutout reserves an edge without chrome living there | `chromeSide` |
| Recomputing only when the fold changes | A window can move without its regions changing | the hook |
| Sizing a child of a fold column directly | Margins sit outside a width, so the child overruns the column | size the column, let the margin be the gap |
| Padding for the fold inside a pane the fold already placed | The pane is half a window; subtracting half a window again leaves nothing | pad only at the outermost level |

---

## Debugging

### Mount the overlay

```tsx
import { FoldDebugOverlay } from "@jusev/react-native-fold";

<NavigationContainer>
  <RootNavigator />
  <FoldDebugOverlay />   {/* last, so it paints over everything */}
</NavigationContainer>
```

It is dev-only unless you explicitly ask otherwise — see [`<FoldDebugOverlay />`](#folddebugoverlay-).

What it draws:

| | |
|---|---|
| **green hairlines** | the safe-area boundary. A line away from the screen edge means that edge has an inset; a line hugging the edge means the system reported nothing there. |
| **amber outlines** | `occlusion` regions — something is drawn over this. |
| **cyan outlines** | `division` regions — the fold. |
| **magenta line** | the centre of the glyph band, across the whole width, so a bar of your own can be checked against the system's clock in one screenshot. |
| **readout** | `source`, `chromeSide`, `outerSide`, the insets, `railReserve`, the fold rect, the band, and every region's frame and margins. |

Nothing drawn at all is itself information: it means the system reported nothing, and whatever is over your content is not a reserved region.

### Reading the numbers from a log

**A `simctl` screenshot of a foldable iOS simulator comes back blank** — `adb shell screencap` does work, but needs `-d <display-id>` to pick the inner or outer screen. If you need the values and cannot see the screen, print them:

```tsx
const signals = useFoldSignals();
useEffect(() => {
  console.log("[fold]", JSON.stringify(signals, null, 2));
}, [signals]);
```

and read them from the device console:

```sh
# iOS simulator
xcrun simctl spawn booted log stream --style compact \
  --predicate 'eventMessage CONTAINS "[fold]"'

# Android
adb logcat -s ReactNativeJS | grep '\[fold\]'
```

### A checklist when a layout looks wrong

| symptom | first thing to check |
|---|---|
| a pane collapsed to a sliver | something inside it is subtracting the fold a second time |
| a seam sits a few points off the hinge | two `flex: 1` children in an unevenly padded container |
| your bar rides above the clock | aligned to `reserved` instead of `top` + `height` |
| a rail's buttons hang off the screen | rail sized from an inset that is `0` on that edge |
| content runs under your own rail | the content's side padding is the inset, not `max(inset, railWidth)` |
| a rail starts flush at `y: 0` | `railReserve` is honestly `0`; floor it at your own gutter |
| a card ends just inside the crease | its own margin, sitting outside the width you gave it |
| the layout is right for the side you *were* on | the observer is not reaching you — please file a bug, with `source` and the window size |
| everything is `null` on a folded device | check `source`: `"fallback"` means iOS < 27.1, or the native module never linked |

### Things that are working as intended

- `topChrome` is `null` on an ordinary phone. The Island is centred, so the free space either side is two strips, and a row cannot use it without straddling.
- `railReserve` is `0` on the outer edge of a shared display. Nothing is reserved there.
- `fold` is `null` when a foldable is **flat**. Reserved regions are inactive and zero-width when the device is fully open, which is correct: there is no crease to avoid.
- `margins` are all `0` on both platforms. That is why `topChrome.estimated` is `true`.

---

## Contributing, and monorepos

Nothing here applies if you installed from npm — `npm install` copies real files into `node_modules` and Metro resolves them normally. This is for working **on** the package, or consuming it from a monorepo.

Install it by path:

```json
"@jusev/react-native-fold": "file:../react-native-fold"
```

npm makes that a symlink, and the app then fails to build with:

```
Unable to resolve module @jusev/react-native-fold
```

which reads like a typo and is not. **Metro follows the symlink** — it has resolved symlinks unconditionally since 0.80, and there is no flag to set. What it will not do is serve a file whose real path lies outside `projectRoot`, and the real path here is a sibling directory. `watchFolders` is the list of extra directories Metro will serve and watch:

```js
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const foldPackage = path.resolve(__dirname, '../react-native-fold');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  // Brings the real directory into the tree Metro serves, so it resolves at
  // all — and watches, so edits hot-reload like any other source file.
  watchFolders: [foldPackage],
  resolver: {
    // Keeps the package's own react / react-native / expo-modules-core
    // imports resolving to the app's single copy. Without this you can get
    // two Reacts, and hooks that fail at runtime for no visible reason.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
});
```

The same applies to any monorepo where the package resolves outside the app's own root.

---

## Testing

The hook runs under Jest with no native module present and returns the flat, fallback shape, so your existing tests keep passing unchanged and every foldable branch takes its null path.

To test a folded layout, mock the module:

```js
jest.mock("@jusev/react-native-fold", () => {
  const folded = {
    regions: [],
    hasFold: true,
    fold: {
      kind: "division", x: 455.5, y: 0, width: 40, height: 669,
      margins: { top: 0, right: 20, bottom: 0, left: 20 },
    },
    foldAxis: "book",
    halves: {
      first: { x: 0, y: 0, width: 455.5, height: 669 },
      second: { x: 495.5, y: 0, width: 455.5, height: 669 },
    },
    railReserve: 0,
    topChrome: null,
    outerSide: null,
    chromeSide: "right",
    insets: { top: 0, right: 84, bottom: 34, left: 0 },
    source: "native",
  };
  return {
    useFoldSignals: () => folded,
    getFoldSignals: () => folded,
    FoldDebugOverlay: () => null,
  };
});
```

Two tests worth having, whatever else you do:

1. **The compact layout is byte-identical** with the package mocked absent. That is the regression gate: a foldable branch must not change a phone.
2. **Every screen exposes the same accessibility labels** in each pose. Poses are not modes.

---

## No device detection

There is no `isDuo`, no model list, no screen-size table, and there will not be one.

A flag naming one handset is wrong the day the next one ships, and it cannot answer the question anyway: **the reserve differs between the two displays of the same device**, and a model name cannot tell those apart. There is no pose enum and no fold angle either — `foldAxis` is derived from the reported region's own shape, so a device that folds some other way needs no new case here.

Everything is derived from what the system reports about **this window, right now**.

---

## Fallback is part of the contract

Where the OS cannot answer — iOS before 27.1, web, a JS-only build, or any platform with no native module linked — every hook still returns usable values and sets `source: "fallback"`. The native module is loaded optionally: **this package must never be the reason an app fails to start on a platform it does not cover.**

You do not normally branch on `source`. Every recipe above already reads as "no fold, no reserved edge" under fallback. Reach for it when you need to substitute an estimate of your own, and want to do that *only* where the system stayed silent:

```tsx
const { railReserve, source } = useFoldSignals();
const reserve = source === "native" ? railReserve : MY_ESTIMATE;
```

Note the shape of that test: `source === "native"` alone — **not** `railReserve > 0`. Zero is an answer.

---

## Platform support

| | |
|---|---|
| **iOS 27.1+** | implemented — `reservedRegions`, an observer inside UIKit's layout pass, scene-change recovery, and shared-display placement |
| **iOS 16.4 – 27.0** | builds and runs; returns the fallback shape with `source: "fallback"` |
| **Android** | 7.0+ — Jetpack WindowManager; see [Android](#android) |
| **Web / JS-only** | fallback |
| **Expo Go** | unsupported — use a development build |

### Android

Folds come from **Jetpack WindowManager** (`WindowInfoTracker` + `FoldingFeature`), which is the only thing on the platform that reports a hinge — Android's inset API is as blind to one as iOS's is. Three things become `regions`:

| Android | reported as |
|---|---|
| a separating `FoldingFeature` | `division` |
| each `DisplayCutout` bounding rect | `occlusion` |
| the status bar | `occlusion`, spanning the full width |

The status bar is in that list deliberately. It is the piece that actually claims the top edge, and without it a corner cutout looks like chrome with a free row beside it — so a bar placed in that "free" row draws underneath the clock. Everything else is derived from those regions by the same code as iOS, so nothing above the hook knows which platform answered.

Two conversions the platform makes easy to get wrong, and which this package does for you:

- **`FoldingFeature.bounds` is in pixels.** React Native lays out in dp. A fold reported at `x: 1200` that is really `400` lands off the side of the screen, so everything crossing the bridge is divided by density.
- **WindowManager is asynchronous** — a coroutine `Flow`, or a callback adapter — while layout needs an answer on the first frame. The latest layout is cached natively and the event tells JS to read it again, which is the same contract as iOS.

A fold is reported as a division only when WindowManager says it **`isSeparating`**: always when half-opened, and when flat only if the hardware genuinely interrupts the display. That matches the iOS side, where a reserved region is inactive and zero-width until the device is folded. A crease you cannot see is not a crease a layout has to avoid.

**What to expect, per platform.** The signals are the same shape everywhere; which of them are populated is not, because the platforms genuinely differ.

| | iOS 27.1 foldable | Android foldable |
|---|---|---|
| `fold`, `foldAxis`, `halves` | yes, when folded | yes, when half-opened |
| `fold.width` | a real gap (40pt on iPhone Duo) | often **`0`** — see below |
| `chromeSide` | `"left"` / `"right"` when folded | **`null`** — Android keeps its chrome on top |
| `topChrome` | the strip beside the clock | **`null`** — the status bar spans the full width |
| `railReserve` | the depth of that column | **`0`** — there is no column |

None of that needs a branch in your code: those are the values the recipes already treat as "nothing special here", so an Android device takes the ordinary path for chrome and the folded path for layout. **Do not** reach for `Platform.OS` to reproduce this table — it is what the package already reports.

One consequence worth stating plainly: a side inset is **not** evidence of a chrome column. Rotate an Android phone and the punch-hole camera lands on an edge and reserves 60-odd points there. That is hardware to avoid, not a home for a toolbar, and `chromeSide` will correctly stay `null` while `insets.right` is large. If you are reading the insets yourself to decide where chrome goes, you will get this wrong; that is what `chromeSide` is for.

**A crease can be zero points wide.** On a device whose display is continuous across the fold — the Pixel 9 Pro Fold is one — `FoldingFeature.bounds` is a zero-width line, and `fold.width` is `0`. That is honest: nothing is hidden there, and nothing has to be left empty for hardware. But it means the "use `fold.width` as the gap between your panes" recipe leaves **no gap at all** on those devices, where the same code leaves 40pt on an iPhone Duo.

If you want visual separation across a seamless fold, that is a design decision rather than a measurement, so make it explicitly:

```tsx
const CREASE_BREATHING_ROOM = 16;
const gap = Math.max(fold?.width ?? 0, CREASE_BREATHING_ROOM);
```

The package will not invent that number for you. Apple's guidance is still not to put a control *on* the crease even where you technically can draw through it.

`outerSide` works here too, and more directly than on iOS: `WindowMetricsCalculator` gives both the current window and the whole display, and the offset between them says which side of the display a split-screen app is on. `chromeSide` still resolves to `null` while Android is painting a status bar across the top, because that is where its chrome lives — read `outerSide` if you want the placement itself.

### Will it crash on Android?

No — and that was true before Android support existed, because the module is optional by construction:

- **Nothing is required at runtime.** The module is loaded with `requireOptionalNativeModule`, which returns `null` rather than throwing when the native side is absent, and every read is guarded — `native?.isSupported?.()`, `native?.addListener`.
- **Every field is inert** where nothing answers, `source` is `"fallback"`, and your null checks all take the path they take on a flat phone.

On a device with no fold and no cutout, Android now answers with `source: "native"` and an empty set of regions — which is a real answer, not a missing one. Either way the app renders as it did before you installed anything.

This is covered by a test — `src/__tests__/fallback.test.ts` mocks the native module absent and asserts that nothing throws and every field is inert — because a crash here would not be a degraded experience, it would be an app that will not start on a platform this package does not even claim to cover.



---

## FAQ

**Does this work on iPad?**
Yes, in the sense that it does no harm: an iPad reports no division, so `foldAxis` is `null` and every fold branch falls through. `chromeSide` and `outerSide` work in Split View on iOS 27.1+.

**Why is everything `null` in my app?**
Check `source`. `"fallback"` means the native module did not load — usually Expo Go, a missing `pod install`, or iOS below 27.1. On Android it should read `"native"` in a development build.

**Can I use this without Expo?**
Yes. It is an Expo *module*, which is not the same as requiring the Expo framework — a bare React Native app that has run [`install-expo-modules`](https://docs.expo.dev/bare/installing-expo-modules/) can use it.

**Does the hook cause re-renders on every layout pass?**
No. The native side compares the regions *and* the window metrics against the last state it sent, and stays silent when nothing a caller can see has changed.

**Why is `topChrome.estimated` true?**
Because neither platform says where the glyphs sit inside the box — iOS 27.1 reports zero margins and Android reports none — so it has to be inferred. The two constants behind that estimate are in this package and are discarded the moment the system reports real margins.

**Should I keep a `railWidth` constant in my app?**
One, yes — for the case where the system reserves nothing along your chrome edge and there is no strip to match. Everything else should come from here.

**Will the debug overlay end up in my App Store build?**
Not unless you wrote `showInProduction`. Left mounted, it renders `null` in a release build.

---

## Status

The API is still moving ahead of 1.0. iOS 27.1+ and Android. MIT.

Written for [yTranslate](https://ytranslate.app).
