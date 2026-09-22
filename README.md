# @jusev/react-native-fold

Foldable layout signals for React Native — the regions the system has reserved, measured rather than guessed.

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [The signals](#the-signals)
- [Recipes](#recipes) — [flat](#1-flat-the-ordinary-phone), [chrome in a corner](#2-chrome-in-a-corner-a-bar-beside-the-clock), [side rail](#3-a-side-rail-a-toolbar-down-the-edge), [book fold](#4-book-fold-a-vertical-crease), [tabletop fold](#5-tabletop-fold-a-horizontal-crease), [alerts and sheets](#6-alerts-and-sheets-on-a-folded-device)
- [No device detection](#no-device-detection)
- [Fallback is part of the contract](#fallback-is-part-of-the-contract)
- [Testing](#testing)
- [Platform support](#platform-support)

## Why

React Native apps on foldables get one number from the safe-area API: how wide an edge inset is. That is not enough to lay out against.

On a foldable the Dynamic Island, the clock and the Wi-Fi glyph sit in the **side** column rather than along the top. So `insets.top` is `0`, and nothing reports how far down that column they reach — or where the fold falls.

The usual workaround is to measure a screenshot and hard-code the answer. We did exactly that, three times, and each number was wrong in a different way:

- a toolbar placed at the top of the rail drew *underneath* the status glyphs
- the system's own controls are not centred in the reserved strip, so ours sat right of them
- a reserve measured on the inner display ran into the glyphs on the **outer** display of the same device

That last one is the point. The distance differs **between the two displays of a single handset**, so no constant — and no device name — can be right for both.

## Install

**Requirements**

| | |
|---|---|
| React Native | 0.76+ (New Architecture) |
| `expo-modules-core` | installed — this is an Expo module, and works in a bare RN app that has [`install-expo-modules`](https://docs.expo.dev/bare/installing-expo-modules/) |
| iOS | builds on 16.4+; **reports regions on 27.1+**, falls back below |
| Expo Go | not supported — use a development build |

**Add the package**

```sh
npm install @jusev/react-native-fold
# or, before it is on npm:
npm install github:jusev/react-native-fold
```

**iOS**

```sh
npx expo prebuild -p ios     # managed projects
npx pod-install              # or: cd ios && pod install
```

Autolinking picks the module up from `expo-module.config.json`; there is nothing to register by hand, and no native code to write.

**Developing the package alongside an app**

If you install it by path (`"@jusev/react-native-fold": "file:../react-native-fold"`), `node_modules` holds a symlink pointing outside the project and Metro will not follow it. It fails as `Unable to resolve "@jusev/react-native-fold"`, which reads like a typo but is not. Add the real directory to `metro.config.js`:

```js
const path = require('path');
const foldPackage = path.resolve(__dirname, '../react-native-fold');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [foldPackage],
  // Keeps the package's own react / react-native / expo-modules-core imports
  // resolving to the app's single copy. Without it you get two Reacts, and
  // hooks that fail at runtime for no visible reason.
  resolver: { nodeModulesPaths: [path.resolve(__dirname, 'node_modules')] },
});
```

## Quick start

One hook, read anywhere, kept current:

```tsx
import { useFoldSignals } from "@jusev/react-native-fold";

function Screen() {
  const { hasFold, foldAxis, halves, railReserve, topChrome, source } = useFoldSignals();
  ...
}
```

It re-reads whenever the system lays the window out — a fold, an unfold, a rotation, a Split View resize, a move between the two displays. You do not subscribe to anything, render anything, or decide when to look.

> **Why that matters.** UIKit posts no notification when reserved regions change; it expects a view to re-query them *while laying out*. From JS the nearest signal is a window resize — and that arrives **before** the window has finished moving to the other display, so reading then returns the regions of the panel you are leaving. The package installs an inert observer view and reports from inside UIKit's own layout pass, which is the part an app should not have to get right.

There is also `getFoldSignals()` for a one-off read outside React — a navigation option, a layout calculation in a plain function. It does not update; prefer the hook in anything that renders.

## The signals

```ts
type FoldSignals = {
  regions: ReservedRegion[];
  hasFold: boolean;
  fold: ReservedRegion | null;
  foldAxis: "book" | "tabletop" | null;
  halves: { first: Rect; second: Rect } | null;
  railReserve: number;
  topChrome: TopChrome | null;
  source: "native" | "fallback";
};
```

| | |
|---|---|
| `regions` | every reserved region: `kind` (`"occlusion"` \| `"division"`), `x/y/width/height` in window points, and `margins` |
| `hasFold` | the system declares a division — a fold, a hinge, a seam |
| `fold` | that division's rect, for keeping content out of it |
| `foldAxis` | `"book"` for a vertical crease, `"tabletop"` for a horizontal one, `null` when flat |
| `halves` | the two usable rects the crease leaves, so you can place into one without recomputing geometry |
| `railReserve` | how far down a side rail the system's own chrome reaches, in points |
| `topChrome` | the free strip beside corner-anchored status chrome: `{ side, width, top, height, reserved, estimated }` |
| `source` | `"native"` when the OS answered, `"fallback"` when it could not |

**A region is a box, not a layout.** Its frame is the space the system claimed; it says nothing about where inside that space the clock and the glyphs are drawn, and on iOS 27.1 the margins that might have said so come back zero. They are not centred in it: the top of a reservation in a screen corner falls under the display's corner curve, which is private to UIKit, so the glyphs sit low in the box. A bar matched to the reservation rides visibly above the clock it shares a line with.

`topChrome` resolves that for you. `reserved` is the full box — use it for the bar's own height, so the surface covers everything the system claimed. `top` and `height` are the band the glyphs actually occupy — use them to place the row inside it. `estimated` is `true` when that band was inferred rather than read from reported margins, which is what happens today; the two constants behind the estimate live in this package and are ignored the moment the system reports real margins. No app using this should carry a status-bar constant of its own.

## Recipes

Every recipe below is the same hook read differently. None of them asks what device it is on.

### 1. Flat — the ordinary phone

Every signal is inert: `hasFold: false`, `fold: null`, `foldAxis: null`, `halves: null`, `railReserve: 0`, `topChrome: null`.

That is deliberate, and it is what makes the rest of the recipes safe to write. Each one is a null check that falls through to the layout you already ship, so a foldable branch cannot regress a phone:

```tsx
const { fold } = useFoldSignals();

<ScrollView contentContainerStyle={[styles.content, fold && avoidFold(fold)]}>
```

A phone gets `null`, which styles nothing. There is no separate compact path to keep in sync.

### 2. Chrome in a corner — a bar beside the clock

Held in portrait, a foldable's status glyphs sit in one **corner** of the top edge rather than across it. The safe-area inset does not describe that: it is conservative, pushing content below the full height of whatever is up there, across the whole width. So a header drops below the clock and wastes a band of screen, with the rest of that row sitting empty beside it.

`topChrome` is the precise answer — which side is free, how wide, and the band the glyphs actually occupy:

```tsx
const { topChrome } = useFoldSignals();
const insets = useSafeAreaInsets();

<View
  style={[
    styles.bar,
    topChrome
      // Beside the system's chrome, on its line. The bar covers the whole
      // reservation; the padding drops its row onto the glyph band inside.
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
        // The band, so the row sits on the glyphs rather than filling the box.
        height: topChrome.height,
      },
    ]}
  >
    {/* your title and actions */}
  </View>
</View>
```

`topChrome` is `null` whenever the reserved thing is **centred**, because then the free space is two strips with the chrome between them and a single row cannot use it without straddling. That is the ordinary phone, and it takes the `insets.top` branch above.

### 3. A side rail — a toolbar down the edge

When the system's chrome runs down an edge, the platform's own layout puts yours in the same column rather than starting a second one beside it. `railReserve` is how far down that column the system reaches — the number that otherwise gets hard-coded, and the one that differs between a single device's two displays.

```tsx
const { railReserve } = useFoldSignals();
const insets = useSafeAreaInsets();

// Which edge is spoken for, from the inset the system reported —
// not from a pose, a device or an orientation.
const railSide = insets.right > insets.left ? "right" : "left";

<View
  style={[
    styles.rail,
    {
      [railSide]: 0,
      width: insets[railSide],
      paddingTop: railReserve + insets.top,   // clear of the clock and the Island
      paddingBottom: 24 + insets.bottom,
    },
  ]}
>
  {actions}
</View>
```

Controls too wide to work vertically stay in the horizontal header — that is Apple's own exception, not a limitation here.

### 4. Book fold — a vertical crease

`foldAxis === "book"` means the device is held part-open like a book and the crease divides **left from right**. Apple's guidance is not to avoid the fold but to stop straddling it: text broken across the crease is hard to read, and a control landing on it is hard to press.

Shift the column into the half it is already mostly in. Applied to a **scroller**, this confines the viewport to that half, so long content scrolls *within* it — a one-off shift cannot promise that, since a form longer than half a screen simply spills across:

```tsx
const { fold, foldAxis, halves } = useFoldSignals();
const { width } = useWindowDimensions();

const avoid =
  fold && foldAxis === "book"
    ? fold.x >= width - (fold.x + fold.width)
      ? { paddingRight: width - fold.x }        // more room on the left
      : { paddingLeft: fold.x + fold.width }    // more room on the right
    : null;

<ScrollView style={avoid} contentContainerStyle={styles.content}>
```

Choosing the **larger** half keeps the decision stable as the device opens and closes, instead of flipping sides partway through.

For a two-pane screen, place into the halves directly rather than computing anything:

```tsx
{halves && foldAxis === "book" ? (
  <View style={styles.row}>
    <View style={{ width: halves.first.width }}><List /></View>
    <View style={{ width: fold.width }} />          {/* the crease, left empty */}
    <View style={{ width: halves.second.width }}><Detail /></View>
  </View>
) : (
  <List />                                          {/* compact: detail is a push */}
)}
```

### 5. Tabletop fold — a horizontal crease

`foldAxis === "tabletop"` means one half is standing the other up on a surface. The upper half is read at a distance; the lower half is where a hand rests. So **content above, controls below**, and nothing on the ridge between them:

```tsx
const { foldAxis, fold, halves } = useFoldSignals();

if (foldAxis === "tabletop" && halves && fold) {
  return (
    <>
      <View style={{ height: halves.first.height }}>
        <Transcript />
      </View>
      <View style={{ height: fold.height }} />       {/* the ridge */}
      <View style={{ height: halves.second.height }}>
        <MicButton />
      </View>
    </>
  );
}
return <SinglePaneLayout />;
```

Size these from `halves`, not with `flex: 1`. A flexed child divides a height its parent does not have when the parent is itself in a scroller, and you get a zero-height pane with no error.

**Poses are not modes.** Everything reachable when flat stays reachable when folded — the arrangement changes, the feature set does not. A quick guard: mount every screen in each shape and assert the same set of accessibility labels.

### 6. Alerts and sheets on a folded device

Across a book fold, a centred modal lands on the crease. Apple's guidance is to put it on the **trailing** half, which is where the experience continues as the device closes onto the outer display:

```tsx
const { foldAxis, halves } = useFoldSignals();
const sheet = foldAxis === "book" && halves ? halves.second : null;

<Modal transparent>
  <View style={[styles.backdrop, sheet && { paddingLeft: sheet.x }]}>
    <View style={[styles.sheet, sheet && { width: sheet.width }]}>{children}</View>
  </View>
</Modal>
```

A React Native `<Modal>` is its own window, so read the hook **inside** it rather than passing values down from the screen behind.

## No device detection

There is no `isDuo`, no model list and no screen-size table, and there will not be one.

A flag naming one handset is wrong the day the next one ships, and it cannot answer the question anyway: the reserve differs between the two displays of the same device, and a model name cannot tell those apart. There is no pose enum and no fold angle either — `foldAxis` is derived from the reported region's own shape, so a device that folds some other way needs no new case.

Everything here is derived from what the system reports about **this window, right now**.

## Fallback is part of the contract

Where the OS cannot answer — iOS before 27.1, Android, web, a JS-only build — every hook still returns usable values and sets `source: "fallback"`, so a caller can tell a real zero from an unanswered question. The native module is loaded optionally: this package must never be the reason an app fails to start on a platform it does not cover.

You do not normally branch on `source`. Every recipe above already reads as "no fold, no reserved edge" under fallback. Reach for it when you need to substitute an estimate of your own, and want to do that only where the system stayed silent:

```tsx
const { railReserve, source } = useFoldSignals();
const reserve = source === "native" ? railReserve : MY_ESTIMATE;
```

## Testing

The hook runs under Jest with no native module present and returns the flat, fallback shape, so existing tests keep passing unchanged. To test a folded layout, mock the module:

```js
jest.mock("@jusev/react-native-fold", () => ({
  useFoldSignals: () => ({
    regions: [], hasFold: true,
    fold: { kind: "division", x: 380, y: 0, width: 24, height: 900,
            margins: { top: 0, right: 0, bottom: 0, left: 0 } },
    foldAxis: "book",
    halves: { first: { x: 0, y: 0, width: 380, height: 900 },
              second: { x: 404, y: 0, width: 380, height: 900 } },
    railReserve: 0, topChrome: null, source: "native",
  }),
}));
```

## Platform support

| | |
|---|---|
| **iOS 27.1+** | implemented — `reservedRegionsOfKind`, with an observer that re-queries inside UIKit's layout pass |
| **iOS < 27.1** | fallback: flat shape, `source: "fallback"` |
| **Android** | not yet. A hinge is invisible to Android's safe-area API too, and the same argument applies there; Jetpack WindowManager's `FoldingFeature` is the route, behind this same API |
| **Web / JS-only** | fallback |

## Status

Early — 0.1.0, iOS only, API still moving. MIT.
