import { useEffect, useMemo, useState } from "react";
import { Dimensions } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * What the system has reserved, and the shape it leaves you.
 *
 * The package reports what the device IS DOING, never what the device IS.
 * There is no isDuo, no model list and no screen-size table, because a flag
 * naming one handset is wrong on the day the next one ships — and the numbers
 * a layout actually needs (how far down a rail the status glyphs reach, where
 * the fold falls) differ between the two displays of a single device, so even
 * a correct model name would not answer them.
 *
 * What it reports instead is measured: the regions iOS 27.1 declares through
 * reservedRegionsOfKind, in points, in the window's own coordinate space.
 * An app asks "is an edge reserved, and how much of it", gets a number that
 * came from the system, and needs no constant of its own.
 *
 * Where the OS cannot answer — iOS before 27.1, Android, web, a JS-only
 * build — every hook still returns usable values and says `source:
 * "fallback"` so a caller can tell a real zero from an unanswered question.
 */

export type ReservedRegionKind = "occlusion" | "division";

export type ReservedRegion = {
  kind: ReservedRegionKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Included in the frame above; separated so hardware and breathing room can be told apart. */
  margins: { top: number; right: number; bottom: number; left: number };
};

/**
 * The free strip along the top edge, when the system's chrome sits in a
 * corner rather than across the whole width.
 *
 * The top safe-area INSET is conservative: it pushes content below the full
 * height of whatever is up there, across the entire width. The reserved
 * REGION is precise. When that region is flush to one side — as the status
 * glyphs are on a folded device held in portrait — the rest of the top edge
 * is free, and an app's own bar can sit BESIDE the system's chrome instead
 * of below it, on the same line.
 *
 * Null when nothing is reserved, and null when the reserved thing is
 * centred, as a Dynamic Island is on an ordinary phone: there the free space
 * is two strips rather than one, and a row cannot use it without straddling.
 */
export type TopChrome = {
  /** Which side of the top edge is FREE — where the app's bar goes. */
  side: "left" | "right";
  /** How wide that free strip is, in points. */
  width: number;
  /**
   * Where the system's glyphs actually begin, in points from the top of the
   * window.
   *
   * This is the number that makes a bar beside the clock line up with it
   * rather than riding high. Pad a bar by `top`, give its row `height`, and
   * the two sit on one line.
   */
  top: number;
  /** How tall the glyph band is, below `top`. */
  height: number;
  /**
   * The full depth of the reservation, glyph band and all.
   *
   * Use it for the bar's own height — the surface should cover everything
   * the system claimed, even the part above the glyphs — while `top` and
   * `height` place the row inside it.
   */
  reserved: number;
  /**
   * True when the glyph band was ESTIMATED rather than reported.
   *
   * The system reserves a box and does not say where within it it draws.
   * Where it reports margins, the band is read from them and this is false.
   * Where the margins come back zero — which is what iOS 27.1 does today —
   * the band is placed by the rule below and this is true, so an app that
   * would rather align to the reservation itself can tell the difference.
   */
  estimated: boolean;
};

export type FoldSignals = {
  regions: ReservedRegion[];
  /** True when the system declares a division — a fold, a hinge, a seam. */
  hasFold: boolean;
  /** The fold's rect, for layouts that must keep content out of it. */
  fold: ReservedRegion | null;
  /**
   * Which way the fold runs, when there is one.
   *
   * The same division region means two quite different things depending on
   * its axis, and Apple's guidance differs for each:
   *
   *   "book"      a vertical fold — the device held part-open like a book.
   *               Keep content and controls off the crease; put alerts on
   *               the trailing half, where the experience continues as the
   *               device closes onto the outer display.
   *
   *   "tabletop"  a horizontal fold — one half standing the other up on a
   *               surface. The upper half is read at a distance, the lower
   *               half is where a hand rests, so content belongs above and
   *               controls below.
   *
   * Derived from the region's own shape rather than from any device or
   * pose enum: a fold taller than it is wide divides left from right.
   */
  foldAxis: "book" | "tabletop" | null;
  /**
   * The usable areas the fold leaves, in window coordinates.
   *
   * Two rects for a folded device and none otherwise, so a layout can place
   * things in a half without recomputing the geometry — and without ever
   * straddling the crease, which is the one thing Apple asks not to do.
   */
  halves: { first: Rect; second: Rect } | null;
  railReserve: number;
  /** A free strip beside corner-anchored system chrome, when there is one. */
  topChrome: TopChrome | null;
  source: "native" | "fallback";
};

export type Rect = { x: number; y: number; width: number; height: number };
  /**
   * How far down a side rail the system's own chrome reaches, in points.
   *
   * This is the number that otherwise gets hard-coded. It is the bottom of
   * the lowest occlusion region that starts at the top of the window — the
   * Island, the clock, the Wi-Fi glyph — so an app placing a toolbar under
   * them can ask instead of measuring a screenshot. 0 when nothing is there.
   */
type NativeRegion = {
  kind: ReservedRegionKind;
  x: number;
  y: number;
  width: number;
  height: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
};

type NativeModule = {
  getReservedRegions: () => NativeRegion[];
  /** The window's own size, so halves can be expressed without asking JS. */
  getWindowSize: () => { width: number; height: number };
  isSupported: () => boolean;
  // Emitted by the package's own observer, which re-queries the regions when
  // UIKit lays the window out — a fold, a rotation, a Split View resize.
  addListener: (event: "onReservedRegionsChange", listener: (payload: { regions: NativeRegion[] }) => void) => { remove: () => void };
};

// Optional on purpose: this package must not be the reason an app fails to
// start on a platform it does not cover.
const native = requireOptionalNativeModule<NativeModule>("RNFold");

const toRegion = (r: NativeRegion): ReservedRegion => ({
  kind: r.kind,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  margins: { top: r.marginTop, right: r.marginRight, bottom: r.marginBottom, left: r.marginLeft },
});

/** A region counts as sitting at the head of the window if it starts there. */
const startsAtTop = (region: ReservedRegion) => region.y <= 1;

/**
 * The strip left free beside chrome that hugs one corner of the top edge.
 *
 * Strict on purpose. The region has to start at the top, and every top
 * region has to be flush against the SAME side; otherwise what remains is
 * two strips with the chrome between them, and a single row cannot sit in
 * that without crossing it.
 */
// Where the system draws inside a reservation it will not describe.
//
// A reserved region is a box the system has claimed; it carries no
// information about where within that box the clock and the status glyphs
// are laid out, and on iOS 27.1 the margins that might have said so come
// back zero. Measured against the device, the glyphs sit LOW in the box —
// the top of a reservation in a screen corner falls under the display's
// corner curve, which is private to UIKit — so a row centred in the box
// rides visibly above the clock it is supposed to share a line with.
//
// These two place the band where the glyphs actually are: a status
// cluster's height, sitting just off the bottom of the reservation, which
// is where system status content sits on every iPhone. They are the only
// hand-measured numbers in this package, they are here rather than in any
// app that uses it, and `estimated` on the result says when they were used.
// The moment the system reports real margins, they are ignored.
const GLYPH_BAND = 48;
const GLYPH_BOTTOM_GAP = 10;

function topChromeOf(regions: ReservedRegion[], windowWidth: number): TopChrome | null {
  const top = regions.filter((region) => region.kind === "occlusion" && startsAtTop(region));
  if (top.length === 0) return null;

  const FLUSH = 1;
  const leftFlush = top.every((region) => region.x <= FLUSH);
  const rightFlush = top.every((region) => region.x + region.width >= windowWidth - FLUSH);
  // Centred chrome fails both — the ordinary phone, and meant to fail.
  if (leftFlush === rightFlush) return null;

  const reserved = Math.max(...top.map((region) => region.y + region.height));

  // A region's frame INCLUDES its margins, so where they are reported the
  // glyphs sit inside it rather than filling it, and the band is read
  // straight off them.
  const reported = top.some((region) => region.margins.top > 0 || region.margins.bottom > 0);
  const bandBottom = reported
    ? Math.max(...top.map((region) => region.y + region.height - region.margins.bottom))
    : Math.max(0, reserved - GLYPH_BOTTOM_GAP);
  const bandTop = reported
    ? Math.min(...top.map((region) => region.y + region.margins.top))
    : Math.max(0, bandBottom - GLYPH_BAND);

  return {
    side: leftFlush ? "right" : "left",
    width: leftFlush
      ? windowWidth - Math.max(...top.map((region) => region.x + region.width))
      : Math.min(...top.map((region) => region.x)),
    top: bandTop,
    height: bandBottom - bandTop,
    reserved,
    estimated: !reported,
  };
}

const NO_FOLD: FoldSignals = {
  regions: [],
  hasFold: false,
  fold: null,
  foldAxis: null,
  halves: null,
  railReserve: 0,
  topChrome: null,
  source: "fallback",
};

export function getFoldSignals(): FoldSignals {
  if (!native?.isSupported?.()) return NO_FOLD;

  const regions = native.getReservedRegions().map(toRegion);
  const window = native.getWindowSize();
  const fold = regions.find((region) => region.kind === "division") ?? null;
  const railReserve = regions
    .filter((region) => region.kind === "occlusion" && startsAtTop(region))
    .reduce((deepest, region) => Math.max(deepest, region.y + region.height), 0);

  // A fold taller than it is wide runs down the display and divides left
  // from right; a wider one runs across and divides top from bottom. Read
  // off the region's own shape, so a device that folds some other way needs
  // no new case here.
  const foldAxis = fold === null ? null : fold.height >= fold.width ? "book" : "tabletop";

  let halves: FoldSignals["halves"] = null;
  if (fold && foldAxis) {
    halves =
      foldAxis === "book"
        ? {
            first: { x: 0, y: 0, width: fold.x, height: window.height },
            second: { x: fold.x + fold.width, y: 0, width: window.width - (fold.x + fold.width), height: window.height },
          }
        : {
            first: { x: 0, y: 0, width: window.width, height: fold.y },
            second: { x: 0, y: fold.y + fold.height, width: window.width, height: window.height - (fold.y + fold.height) },
          };
  }

  return {
    regions,
    hasFold: fold !== null,
    fold,
    foldAxis,
    halves,
    railReserve,
    topChrome: topChromeOf(regions, window.width),
    source: "native",
  };
}

/**
 * The same signals, kept current.
 *
 * Re-read whenever the window changes size, which is what a fold, a rotation
 * and a Split View resize all produce. The regions move with the display, so
 * a value read once at launch is wrong the first time the device is opened.
 */
export function useFoldSignals(): FoldSignals {
  const [signals, setSignals] = useState<FoldSignals>(() => getFoldSignals());

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) setSignals(getFoldSignals());
    };

    // The native observer is the real signal. UIKit posts no notification
    // when reserved regions change — it expects a view to re-query them
    // while laying out — so the package installs a view of its own and
    // reports from inside that layout pass. Consumers do not render
    // anything, do not subscribe to anything else, and do not have to guess
    // when a fold has finished.
    //
    // Guessing is what this replaced: a window resize arrives BEFORE the
    // window has moved to the other display, so reading then returns the
    // regions of the panel being left. That is not a timing that can be
    // waited out reliably from JS, which is why it belongs here.
    if (native?.addListener) {
      const subscription = native.addListener("onReservedRegionsChange", refresh);
      refresh();
      return () => {
        cancelled = true;
        subscription.remove();
      };
    }

    // Without the native module there is nothing to observe, but the frame
    // can still change and a caller may key off `source`. Dimensions is
    // enough for that, and costs nothing when nothing moves.
    const subscription = Dimensions.addEventListener("change", refresh);
    refresh();
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return useMemo(() => signals, [signals]);
}
