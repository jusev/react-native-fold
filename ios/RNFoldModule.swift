import ExpoModulesCore
import UIKit

/**
 Reports the regions the system has reserved inside the app's own window.

 This exists because the safe-area inset does not describe them. On a
 foldable the inset says an edge is 84pt wide and nothing about how far down
 that column the Dynamic Island and the status glyphs reach, or where the
 fold falls — and `insets.top` is 0 there, because those glyphs sit beside
 the content rather than above it. Layouts built on the inset alone end up
 drawing underneath the system's own chrome, and the only way to avoid it is
 to measure a screenshot and hard-code the answer, which is wrong the moment
 the device changes or the other display is used.

 `reservedRegionsOfKind:` (iOS 27.1) answers it properly, per view and per
 display. Two kinds matter:

   occlusion  something is drawn over this area — the Island, the camera.
   division   the layout should split here — the fold.

 Every value is returned in POINTS in the window's coordinate space, which is
 what React Native lays out in, so callers need no conversion.
 */
public class RNFoldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RNFold")

    // Synchronous on purpose. Layout needs this on the first frame, and a
    // promise would mean rendering once with no regions and again with them
    // — which is exactly the jump this is meant to prevent.
    Function("getReservedRegions") { () -> [[String: Any]] in
      RNFoldModule.reservedRegions()
    }

    // Whether the running OS can answer at all. Callers fall back to their
    // own guesses when it cannot, and should say so rather than pretend.
    Function("isSupported") { () -> Bool in
      if #available(iOS 27.1, *) { return true }
      return false
    }
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  private static func reservedRegions() -> [[String: Any]] {
    guard #available(iOS 27.1, *), let window = keyWindow() else { return [] }

    var out: [[String: Any]] = []
    // Swift renames all of this: the ObjC UIViewReservedRegionKind becomes
    // UIView.ReservedRegion.Kind, and reservedRegionsOfKind: becomes
    // reservedRegions(kind:options:). Taken from UIKit's own swiftinterface
    // rather than from the ObjC header, which describes a shape Swift never
    // sees.
    for (name, kind) in [
      ("occlusion", UIView.ReservedRegion.Kind.occlusion),
      ("division", UIView.ReservedRegion.Kind.division),
    ] {
      for region in window.reservedRegions(kind: kind) {
        // Inactive regions are excluded by default and deliberately not
        // asked for: a region that is not currently there should not push
        // the layout around on the chance that it comes back.
        out.append([
          "kind": name,
          "x": region.frame.origin.x,
          "y": region.frame.origin.y,
          "width": region.frame.size.width,
          "height": region.frame.size.height,
          // The frame already includes these; they are reported separately
          // so a caller can tell the hardware apart from the breathing room
          // the system wants around it.
          "marginTop": region.margins.top,
          "marginRight": region.margins.right,
          "marginBottom": region.margins.bottom,
          "marginLeft": region.margins.left,
        ])
      }
    }
    return out
  }
}
