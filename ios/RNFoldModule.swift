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
  private var observer: RNFoldObserverView?
  // The last state sent, so layout passes that change nothing stay silent.
  // layoutSubviews runs often; a re-render per pass would be a cost this
  // package imposed on every app using it.
  //
  // It holds the WINDOW METRICS as well as the regions, because both decide
  // what a caller sees. Comparing regions alone meant a window that moved
  // across the display without its reserved regions changing — resized into
  // or out of a shared display, where neither half reserves anything — sent
  // nothing at all, and the app went on laying out for the side it used to
  // be on.
  private var lastSent: [String: Any]?
  // Tokens for the scene notifications, kept so they can be removed when JS
  // stops listening.
  private var sceneTokens: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("RNFold")

    Events("onReservedRegionsChange")

    // The observer is installed while JS is listening and removed when it
    // stops, so an app that never asks pays nothing.
    OnStartObserving {
      DispatchQueue.main.async {
        self.attachObserver()
        self.observeSceneChanges()
      }
    }

    OnStopObserving {
      DispatchQueue.main.async {
        self.stopObservingSceneChanges()
        self.detachObserver()
      }
    }

    // Synchronous on purpose. Layout needs this on the first frame, and a
    // promise would mean rendering once with no regions and again with them
    // — which is exactly the jump this is meant to prevent.
    Function("getReservedRegions") { () -> [[String: Any]] in
      RNFoldModule.reservedRegions()
    }

    // The window's size, so the JS side can express the halves a fold leaves
    // without having to reconcile two sources of truth for the same window.
    Function("getWindowSize") { () -> [String: Any] in
      RNFoldModule.windowMetrics()
    }

    // Whether the running OS can answer at all. Callers fall back to their
    // own guesses when it cannot, and should say so rather than pretend.
    Function("isSupported") { () -> Bool in
      if #available(iOS 27.1, *) { return true }
      return false
    }
  }

  private func attachObserver() {
    guard observer == nil, let window = RNFoldModule.keyWindow() else { return }
    let view = RNFoldObserverView()
    view.frame = window.bounds
    view.onLayout = { [weak self] in self?.emitIfChanged() }
    // At the back, under everything the app draws.
    window.insertSubview(view, at: 0)
    observer = view
    emitIfChanged()
  }

  private func detachObserver() {
    observer?.onLayout = nil
    observer?.removeFromSuperview()
    observer = nil
    lastSent = nil
  }

  // A window can be handed to a different UIWindow when the app is resized
  // into or out of a shared display, and the observer view goes with the old
  // one — still laid out, still reporting, about a window nobody is looking
  // at. layoutSubviews cannot catch that, because the view it belongs to is
  // no longer in the window that matters. These notifications can.
  private func observeSceneChanges() {
    guard sceneTokens.isEmpty else { return }
    let center = NotificationCenter.default
    for name in [UIScene.didActivateNotification, UIApplication.didBecomeActiveNotification] {
      sceneTokens.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.reattachIfNeeded()
        }
      )
    }
  }

  private func stopObservingSceneChanges() {
    sceneTokens.forEach(NotificationCenter.default.removeObserver)
    sceneTokens.removeAll()
  }

  private func reattachIfNeeded() {
    guard observer != nil else { return }
    if observer?.window !== RNFoldModule.keyWindow() {
      // detachObserver clears lastSent, so the move is always followed by a
      // fresh report rather than being deduped against the old window's.
      detachObserver()
      attachObserver()
    } else {
      emitIfChanged()
    }
  }

  private func emitIfChanged() {
    let regions = RNFoldModule.reservedRegions()
    let state: [String: Any] = ["regions": regions, "window": RNFoldModule.windowMetrics()]
    if let previous = lastSent, NSDictionary(dictionary: previous).isEqual(to: state) { return }
    lastSent = state
    sendEvent("onReservedRegionsChange", ["regions": regions])
  }

  // The window's size, where it sits ON THE DISPLAY, and what it has
  // reserved — everything about the window itself that a layout depends on.
  private static func windowMetrics() -> [String: Any] {
    guard let window = keyWindow() else {
      return [
        "width": 0, "height": 0, "x": 0, "y": 0, "screenWidth": 0, "screenHeight": 0,
        "insetTop": 0, "insetRight": 0, "insetBottom": 0, "insetLeft": 0,
      ]
    }
    let bounds = window.bounds
    // Not window.frame: a window sharing the display with another app is
    // given its own coordinate space, so its frame origin is {0, 0}
    // whichever half it occupies, and an app cannot tell which side of the
    // screen it is on. Converting into the screen's coordinate space is what
    // actually answers it.
    //
    // coordinateSpace, not fixedCoordinateSpace: the fixed one is locked to
    // the device's portrait origin, so on a landscape display the offset
    // comes back on the other axis and a left/right question gets a
    // top/bottom answer.
    let screen = window.windowScene?.screen ?? window.screen
    let onScreen = window.convert(bounds, to: screen.coordinateSpace)
    let safeArea = window.safeAreaInsets
    return [
      "width": bounds.width,
      "height": bounds.height,
      "x": onScreen.origin.x,
      "y": onScreen.origin.y,
      "screenWidth": screen.bounds.width,
      "screenHeight": screen.bounds.height,
      "insetTop": safeArea.top,
      "insetRight": safeArea.right,
      "insetBottom": safeArea.bottom,
      "insetLeft": safeArea.left,
    ]
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
