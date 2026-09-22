import { useEffect, useMemo, useState } from "react";
import { Dimensions, type EmitterSubscription } from "react-native";
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

export type FoldSignals = {
  regions: ReservedRegion[];
  /** True when the system declares a division — a fold, a hinge, a seam. */
  hasFold: boolean;
  /** The fold's rect, for layouts that must keep content out of it. */
  fold: ReservedRegion | null;
  /**
   * How far down a side rail the system's own chrome reaches, in points.
   *
   * This is the number that otherwise gets hard-coded. It is the bottom of
   * the lowest occlusion region that starts at the top of the window — the
   * Island, the clock, the Wi-Fi glyph — so an app placing a toolbar under
   * them can ask instead of measuring a screenshot. 0 when nothing is there.
   */
  railReserve: number;
  source: "native" | "fallback";
};

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
  isSupported: () => boolean;
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

export function getFoldSignals(): FoldSignals {
  if (!native?.isSupported?.()) {
    return { regions: [], hasFold: false, fold: null, railReserve: 0, source: "fallback" };
  }

  const regions = native.getReservedRegions().map(toRegion);
  const fold = regions.find((region) => region.kind === "division") ?? null;
  const railReserve = regions
    .filter((region) => region.kind === "occlusion" && startsAtTop(region))
    .reduce((deepest, region) => Math.max(deepest, region.y + region.height), 0);

  return { regions, hasFold: fold !== null, fold, railReserve, source: "native" };
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
    let subscription: EmitterSubscription | undefined;
    const refresh = () => setSignals(getFoldSignals());
    subscription = Dimensions.addEventListener("change", refresh);
    // Once on mount as well: the first read can happen before the window has
    // its final size, and nothing emits for that.
    refresh();
    return () => subscription?.remove();
  }, []);

  return useMemo(() => signals, [signals]);
}
