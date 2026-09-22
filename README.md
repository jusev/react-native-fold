# @jusev/react-native-fold

Foldable layout signals for React Native — the regions the system has reserved, measured rather than guessed.

## Why

React Native apps on foldables get one number from the safe-area API: how wide an edge inset is. That is not enough to lay out against.

On a foldable the Dynamic Island, the clock and the Wi-Fi glyph sit in the **side** column rather than along the top. So `insets.top` is `0`, and nothing reports how far down that column they reach — or where the fold falls.

The usual workaround is to measure a screenshot and hard-code the answer. We did exactly that, three times, and each number was wrong in a different way:

- a toolbar placed at the top of the rail drew *underneath* the status glyphs
- the system's own controls are not centred in the reserved strip, so ours sat right of them
- a reserve measured on the inner display ran into the glyphs on the **outer** display of the same device

That last one is the point. The distance differs **between the two displays of a single handset**, so no constant — and no device name — can be right for both.

## What it reports

What the system declares through `reservedRegionsOfKind` (iOS 27.1), in points, in the window's own coordinate space:

```ts
import { useFoldSignals } from "@jusev/react-native-fold";

const { regions, hasFold, fold, railReserve, source } = useFoldSignals();
```

| | |
|---|---|
| `regions` | every reserved region: `kind`, `frame`, `margins` |
| `hasFold` | the system declares a division — a fold, a hinge, a seam |
| `fold` | that division's rect, for keeping content out of it |
| `railReserve` | how far down a side rail the system's own chrome reaches |
| `source` | `"native"` when the OS answered, `"fallback"` when it could not |

`railReserve` is the number that otherwise gets hard-coded. Ask for it instead of measuring a screenshot.

## No device detection

There is no `isDuo`, no model list and no screen-size table.

A flag naming one handset is wrong the day the next one ships, and it cannot answer the question anyway: the reserve differs between the two displays of the same device, and a model name cannot tell those apart. Everything here is derived from what the system reports about **this window, right now**.

## Fallback is part of the contract

Where the OS cannot answer — iOS before 27.1, Android, web, a JS-only build — every hook still returns usable values and sets `source: "fallback"`, so a caller can tell a real zero from an unanswered question. The native module is optional: this package must never be the reason an app fails to start on a platform it does not cover.

## Status

Early. iOS 27.1+ is implemented; Android's Jetpack WindowManager (`FoldingFeature`) is not yet, because a hinge is invisible to Android's safe-area API too and the same argument applies there.
