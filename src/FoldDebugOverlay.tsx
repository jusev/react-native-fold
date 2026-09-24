import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFoldSignals } from "./index";

/**
 * Draws what the system actually reported, on top of whatever is showing.
 *
 * Diagnosing this by eye does not work. "The right side is over my content"
 * can mean the app ignored an inset, or that the system reported no inset
 * and the obstruction is something else entirely — and those have opposite
 * fixes. A screenshot cannot tell them apart. This can, because it outlines
 * the regions the system declared and prints the numbers the layout was
 * given.
 *
 * It is deliberately inert: absolutely positioned and pointerEvents="none",
 * so it cannot change a single measurement it is there to report, and cannot
 * swallow a tap.
 *
 * ## It cannot ship by accident
 *
 * Left mounted in a release build it renders `null` and nothing else. That
 * is not a convention or a lint rule, it is this component's first line: in
 * production it returns before it reads anything, unless the caller has
 * written `showInProduction` at the call site, which is not a thing anybody
 * types by mistake.
 *
 *     <FoldDebugOverlay />                       // dev only
 *     <FoldDebugOverlay enabled={debugLayout} /> // dev only, behind a flag
 *     <FoldDebugOverlay showInProduction />      // deliberate, and obvious
 *
 * Mount it last, so it paints over everything.
 */
export type FoldDebugOverlayProps = {
  /**
   * Turn it off without unmounting it — a settings toggle, a shake gesture,
   * a dev menu. Defaults to on, but only ever within a debug build.
   */
  enabled?: boolean;
  /**
   * The deliberate escape hatch. Without this, the overlay draws nothing in
   * a release build no matter what `enabled` says.
   *
   * There are real reasons to want it — a TestFlight build chasing a layout
   * bug that only reproduces on someone else's device — and that is why it
   * exists rather than being impossible. It is a separate prop from
   * `enabled` precisely so that shipping it is a decision somebody made,
   * not a flag that happened to be true.
   */
  showInProduction?: boolean;
  /**
   * Which parts to draw. `"full"` is everything, an array is exactly the
   * parts you name, and `[]` draws nothing while staying mounted.
   *
   *     <FoldDebugOverlay />                            // full
   *     <FoldDebugOverlay show={["regions"]} />         // outlines only
   *     <FoldDebugOverlay show={["edges", "readout"]} />
   *
   * All four are on by default because the first question is usually "what
   * does the system say", and the answer is easier to see all at once. They
   * come apart because each one gets in the way of a different thing:
   *
   *   edges    four hairlines on the safe-area boundary
   *   regions  an outline per reserved region, amber and cyan
   *   band     the glyph band's centre line, across the full width — the one
   *            to keep when aligning a bar of your own to the system's clock
   *   readout  the numbers, in a box in the corner. Opaque, and it sits
   *            exactly where a header does, so it is the part most often
   *            worth turning off.
   */
  show?: "full" | FoldDebugPart[];
};

/** An individually drawable part of the overlay. */
export type FoldDebugPart = "edges" | "regions" | "band" | "readout";

const r = (n: number) => Math.round(n * 10) / 10;

const ALL_PARTS: FoldDebugPart[] = ["edges", "regions", "band", "readout"];

export default function FoldDebugOverlay({
  enabled = true,
  showInProduction = false,
  show = "full",
}: FoldDebugOverlayProps) {
  // Before anything else, and before any hook could make this conditional
  // on more than the build: a release build draws nothing unless asked.
  const allowed = __DEV__ || showInProduction;

  const { regions, insets, topChrome, chromeSide, outerSide, foldAxis, fold, railReserve, source } =
    useFoldSignals();

  if (!allowed || !enabled) return null;

  const parts = show === "full" ? ALL_PARTS : show;
  const draws = (part: FoldDebugPart) => parts.includes(part);

  return (
    <View style={styles.root} pointerEvents="none">
      {/* The safe-area boundary, one hairline per edge. Where a line sits
          away from the screen edge, that edge has an inset; where it hugs
          the edge, the system reported nothing there. */}
      {draws("edges") ? (
        <>
          <View style={[styles.edge, { top: insets.top, left: 0, right: 0, height: 1 }]} />
          <View style={[styles.edge, { bottom: insets.bottom, left: 0, right: 0, height: 1 }]} />
          <View style={[styles.edge, { left: insets.left, top: 0, bottom: 0, width: 1 }]} />
          <View style={[styles.edge, { right: insets.right, top: 0, bottom: 0, width: 1 }]} />
        </>
      ) : null}

      {/* Each reserved region, outlined where the system says it is. Amber
          for an occlusion — something is drawn over this — and cyan for a
          division, the fold. Nothing drawn means the system reported
          nothing, which is itself worth seeing. */}
      {draws("regions")
        ? regions.map((region, index) => (
            <View
              key={`${region.kind}-${index}`}
              style={[
                styles.region,
                region.kind === "division" ? styles.division : styles.occlusion,
                { left: region.x, top: region.y, width: region.width, height: region.height },
              ]}
            />
          ))
        : null}

      {/* The centre of the glyph band, across the whole width, so a bar of
          your own can be checked against the system's clock in a single
          screenshot. It is NOT the middle of the reservation: the top of a
          corner reservation falls under the display's curve, and the system
          lays its glyphs out below it. */}
      {draws("band") && topChrome ? (
        <View style={[styles.band, { top: topChrome.top + topChrome.height / 2 }]} />
      ) : null}

      {draws("readout") ? (
        <View style={[styles.readout, { top: insets.top + 4, left: insets.left + 4 }]}>
          <Text style={styles.text}>
            source:{source} chrome:{chromeSide ?? "none"} outer:{outerSide ?? "none"}
          </Text>
          <Text style={styles.text}>
            insets t{r(insets.top)} r{r(insets.right)} b{r(insets.bottom)} l{r(insets.left)} · reserve{" "}
            {r(railReserve)}
          </Text>
          <Text style={styles.text}>
            fold: {fold ? `${foldAxis} ${r(fold.x)},${r(fold.y)} ${r(fold.width)}×${r(fold.height)}` : "none"}
          </Text>
          <Text style={styles.text}>
            band:{" "}
            {topChrome
              ? `${topChrome.side} w${r(topChrome.width)} t${r(topChrome.top)} h${r(topChrome.height)} of ${r(
                  topChrome.reserved
                )}${topChrome.estimated ? " (est)" : ""}`
              : "none"}
          </Text>
          {/* Each region's own frame and the margins it already includes —
              the pair that decides where a matching row actually belongs. */}
          {regions.map((region, index) => (
            <Text key={`m-${index}`} style={styles.text}>
              {region.kind[0]} {r(region.x)},{r(region.y)} {r(region.width)}×{r(region.height)} m
              {r(region.margins.top)}/{r(region.margins.right)}/{r(region.margins.bottom)}/{r(region.margins.left)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 9999 },
  edge: { position: "absolute", backgroundColor: "rgba(0,255,128,0.55)" },
  region: { position: "absolute", borderWidth: 1 },
  occlusion: { borderColor: "rgba(255,176,0,0.9)", backgroundColor: "rgba(255,176,0,0.12)" },
  division: { borderColor: "rgba(0,208,255,0.9)", backgroundColor: "rgba(0,208,255,0.12)" },
  band: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,0,200,0.95)" },
  readout: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  text: { color: "#00FF80", fontSize: 10, lineHeight: 13 },
});
