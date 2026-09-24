/**
 * The overlay's two guarantees: it cannot draw in a release build unless
 * asked, and `show` draws exactly the parts named and nothing else.
 *
 * Both are the kind of claim a README makes and nobody checks. The second
 * matters because the parts are gated independently — it is easy to add a
 * fifth and forget to gate it, and the failure is invisible until someone
 * turns everything else off and wonders why the screen is not clear.
 */

(globalThis as { __DEV__?: boolean }).__DEV__ = true;

jest.mock("react-native", () => ({
  StyleSheet: { create: (s: unknown) => s },
  View: "View",
  Text: "Text",
}));

// The overlay is the unit under test, not the hook: it is called directly
// rather than rendered, so the hook is replaced with a fixed reading. The
// reading includes a topChrome, because otherwise the band has nothing to
// draw and "band: false" would pass for the wrong reason.
jest.mock("../index", () => ({
  useFoldSignals: () => ({
    regions: [
      { kind: "occlusion", x: 0, y: 0, width: 100, height: 40, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
    ],
    hasFold: false,
    fold: null,
    foldAxis: null,
    halves: null,
    railReserve: 0,
    topChrome: { side: "right", width: 200, top: 10, height: 30, reserved: 44, estimated: true },
    outerSide: null,
    chromeSide: null,
    insets: { top: 44, right: 0, bottom: 34, left: 0 },
    source: "native",
  }),
}));

import FoldDebugOverlay, { type FoldDebugPart } from "../FoldDebugOverlay";

// Counts the styles actually rendered, without a renderer: the element tree
// is plain objects, so walking it is enough to say what was drawn.
const walk = (node: unknown, seen: unknown[] = []): unknown[] => {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, seen));
    return seen;
  }
  if (node && typeof node === "object") {
    const el = node as { props?: Record<string, unknown> };
    if (el.props) {
      if (el.props.style) seen.push(el.props.style);
      if (el.props.children) walk(el.props.children, seen);
    }
  }
  return seen;
};

const drawn = (show?: "full" | FoldDebugPart[]) => {
  const tree = FoldDebugOverlay({ show } as never);
  const styles = JSON.stringify(walk(tree));
  return {
    edges: styles.includes('"backgroundColor":"rgba(0,255,128,0.55)"'),
    regions: styles.includes('"borderWidth":1'),
    band: styles.includes('"backgroundColor":"rgba(255,0,200,0.95)"'),
    readout: styles.includes('"backgroundColor":"rgba(0,0,0,0.72)"'),
  };
};

describe("show", () => {
  it("draws everything by default", () => {
    expect(drawn()).toEqual({ edges: true, regions: true, band: true, readout: true });
  });

  it('"full" is the same as the default', () => {
    expect(drawn("full")).toEqual(drawn());
  });

  it("draws nothing for an empty array, while staying mounted", () => {
    expect(drawn([])).toEqual({ edges: false, regions: false, band: false, readout: false });
  });

  it.each<FoldDebugPart>(["edges", "readout"])("draws only %s when asked for only it", (part) => {
    const result = drawn([part]);
    expect(result[part]).toBe(true);
    for (const other of Object.keys(result) as FoldDebugPart[]) {
      if (other !== part) expect(result[other]).toBe(false);
    }
  });

  it("draws exactly the combination named", () => {
    expect(drawn(["edges", "readout"])).toEqual({
      edges: true,
      regions: false,
      band: false,
      readout: true,
    });
  });
});

describe("the production guard", () => {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  });

  it("renders nothing in a release build", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(FoldDebugOverlay({} as never)).toBeNull();
  });

  it("renders nothing in a release build even when enabled is true", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(FoldDebugOverlay({ enabled: true } as never)).toBeNull();
  });

  it("renders in a release build only when showInProduction is written", () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    expect(FoldDebugOverlay({ showInProduction: true } as never)).not.toBeNull();
  });

  it("renders nothing when disabled, in any build", () => {
    expect(FoldDebugOverlay({ enabled: false } as never)).toBeNull();
  });
});
