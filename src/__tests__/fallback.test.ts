/**
 * The fallback contract: on a platform with no native module, nothing here
 * throws and everything is inert.
 *
 * This is the test that matters most. The package is optional by design —
 * `requireOptionalNativeModule` returns undefined on Android, on web, on
 * iOS before 27.1, in Expo Go, and in Jest — and every one of those has to
 * end with the app rendering as though the package were not installed.
 *
 * A crash here is not a degraded experience; it is an app that will not
 * start on a platform this package does not even claim to cover.
 */

jest.mock("expo-modules-core", () => ({
  // Exactly what expo-modules-core does when the native module is absent.
  requireOptionalNativeModule: () => null,
}));

// The whole of react-native that this package touches. StyleSheet, View and
// Text are here because index re-exports FoldDebugOverlay, so importing the
// package at all pulls the overlay in — see the note on that in the README.
jest.mock("react-native", () => ({
  Dimensions: { addEventListener: () => ({ remove: () => {} }) },
  StyleSheet: { create: (s: unknown) => s },
  View: "View",
  Text: "Text",
}));

import { getFoldSignals } from "../index";

describe("with no native module", () => {
  it("does not throw", () => {
    expect(() => getFoldSignals()).not.toThrow();
  });

  it("reports that it could not answer", () => {
    expect(getFoldSignals().source).toBe("fallback");
  });

  it("is inert in every field, so a caller's null checks all fall through", () => {
    const signals = getFoldSignals();
    expect(signals).toEqual({
      regions: [],
      hasFold: false,
      fold: null,
      foldAxis: null,
      halves: null,
      railReserve: 0,
      topChrome: null,
      outerSide: null,
      chromeSide: null,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      source: "fallback",
    });
  });

  it("stays inert when called repeatedly", () => {
    expect(getFoldSignals()).toEqual(getFoldSignals());
  });
});
