package expo.modules.rnfold

import android.app.Activity
import android.graphics.Rect
import android.view.View
import androidx.core.util.Consumer
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import androidx.window.layout.WindowMetricsCalculator
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executor

/**
 * Reports the regions the system has reserved inside the app's own window.
 *
 * The Android half of the same idea as the iOS module, reporting the same
 * shapes so that nothing above this has to know which platform answered.
 *
 * What differs is where the answers come from. iOS 27.1 declares reserved
 * regions directly; Android has no such concept, so they are assembled:
 *
 *   division   a FoldingFeature from Jetpack WindowManager, which is the
 *              only thing on the platform that reports a hinge — the inset
 *              API is as blind to it here as it is on iOS.
 *   occlusion  the DisplayCutout's bounding rects, which is the same claim
 *              in Android's vocabulary: the system draws here, you cannot.
 *
 * Two conversions matter and are easy to get wrong:
 *
 *   - FoldingFeature.bounds is in PIXELS. React Native lays out in dp, and
 *     a fold reported at x=1200 that is really x=400dp lands off the side of
 *     the screen. Everything leaving this file is divided by density.
 *   - WindowManager is asynchronous — a Flow, or this callback adapter —
 *     while the JS side reads synchronously so that it can lay out on the
 *     first frame. The latest layout is therefore cached here, and the event
 *     is what tells JS to read it again.
 */
class RNFoldModule : Module() {
  private var tracker: WindowInfoTrackerCallbackAdapter? = null
  private var listener: Consumer<WindowLayoutInfo>? = null
  private var listeningTo: Activity? = null

  // WindowManager only calls back when the FOLDING FEATURES change. Moving
  // to the other display of a foldable, rotating a device that is not
  // folded, being resized in multi-window — none of those necessarily change
  // the feature list, so none of them recompute anything, and the app goes
  // on laying out for the window it used to be in. Closing a Pixel Fold onto
  // its outer display left the inner display's crease drawn down the middle
  // of a phone-sized screen.
  //
  // A layout listener is the counterpart of the observer view the iOS side
  // installs: it fires for every layout pass, which is the whole set of
  // events that can move any of this.
  private var layoutListener: View.OnLayoutChangeListener? = null
  private var layoutHost: View? = null

  /** The most recent layout, because JS reads synchronously and this is not. */
  private var latest: WindowLayoutInfo? = null

  /** The last state sent, so layouts that change nothing stay silent. */
  private var lastSent: Map<String, Any?>? = null

  // The callback runs on whatever executor it is given. Everything it
  // touches is read back on the JS thread, so it runs on the main thread
  // rather than a pool of its own — the reference implementation this was
  // studied from span a new single-thread executor on every start and never
  // shut any of them down.
  private val mainExecutor = Executor { command ->
    appContext.activityProvider?.currentActivity?.runOnUiThread(command)
      ?: command.run()
  }

  override fun definition() = ModuleDefinition {
    Name("RNFold")

    Events("onReservedRegionsChange")

    OnStartObserving { attach() }
    OnStopObserving { detach() }

    // The activity can be recreated under us — a rotation without the right
    // configChanges, or a return from the background — and the listener goes
    // with the old one: still registered, about a window nobody is looking
    // at. This is the Android counterpart of the iOS scene-activation check.
    OnActivityEntersForeground { attach() }
    OnActivityDestroys { detach() }

    Function("getReservedRegions") { regions() }

    Function("getWindowSize") { windowMetrics() }

    // Always true: WindowManager answers on every supported version, and an
    // empty answer ("no fold, no cutout") is a real answer rather than a
    // missing one — which is the distinction `source` exists to preserve.
    Function("isSupported") { true }
  }

  private fun attach() {
    val activity = appContext.activityProvider?.currentActivity ?: return
    if (listeningTo === activity && listener != null) return
    detach()

    val adapter = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(activity))
    val consumer = Consumer<WindowLayoutInfo> { info ->
      latest = info
      emitIfChanged()
    }
    // Deliberately NOT gated on FEATURE_SENSOR_HINGE_ANGLE. That feature
    // describes a hinge ANGLE sensor, which many foldables never expose and
    // which has nothing to do with whether WindowManager reports a folding
    // feature — gating on it silently leaves the tracker uncreated on
    // devices that do fold.
    adapter.addWindowLayoutInfoListener(activity, mainExecutor, consumer)

    val decor = activity.window.decorView
    val onLayout = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> emitIfChanged() }
    decor.addOnLayoutChangeListener(onLayout)

    tracker = adapter
    listener = consumer
    listeningTo = activity
    layoutListener = onLayout
    layoutHost = decor
    emitIfChanged()
  }

  private fun detach() {
    listener?.let { tracker?.removeWindowLayoutInfoListener(it) }
    layoutListener?.let { layoutHost?.removeOnLayoutChangeListener(it) }
    tracker = null
    listener = null
    listeningTo = null
    layoutListener = null
    layoutHost = null
    latest = null
    lastSent = null
  }

  private fun emitIfChanged() {
    val state = mapOf("regions" to regions(), "window" to windowMetrics())
    if (state == lastSent) return
    lastSent = state
    sendEvent("onReservedRegionsChange", mapOf("regions" to state["regions"]))
  }

  private fun density(): Float =
    appContext.reactContext?.resources?.displayMetrics?.density ?: 1f

  private fun regions(): List<Map<String, Any>> {
    val activity = appContext.activityProvider?.currentActivity ?: return emptyList()
    // A folding feature reported for the inner display says nothing about
    // the outer one. WindowManager does not always call back when the app
    // moves between them, so a feature that no longer fits inside this
    // window is a stale reading and not a crease.
    val bounds = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(activity).bounds
    val d = density()
    val out = mutableListOf<Map<String, Any>>()

    latest?.displayFeatures?.forEach { feature ->
      if (feature !is FoldingFeature) return@forEach
      // isSeparating, not "there is a hinge". It is true whenever the fold
      // should be treated as dividing the window — always when half-opened,
      // and when flat only if the hardware actually interrupts the display.
      // That matches the iOS side, where a reserved region is inactive and
      // zero-width until the device is folded: a crease you cannot see is
      // not a crease a layout has to avoid.
      if (!feature.isSeparating) return@forEach
      if (!bounds.contains(feature.bounds)) return@forEach
      out.add(region("division", feature.bounds, d))
    }

    // The camera cutout is the same claim as an iOS occlusion: the system
    // draws here. Reporting it is what lets topChrome and railReserve mean
    // the same thing on both platforms.
    val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
    insets?.displayCutout?.boundingRects?.forEach { out.add(region("occlusion", it, d)) }

    // And so is the status bar — more so, because it is the piece that
    // actually spans the top edge. Reporting only the cutout describes a
    // corner with a free row beside it, which is true on a foldable whose
    // glyphs live in that corner and false here: Android draws the clock and
    // the icons across the whole width. A bar placed in that "free" row
    // lands underneath them.
    //
    // Reported as its own region rather than left to the inset, because a
    // caller comparing regions against each other should see everything the
    // system has claimed, not most of it.
    val bars = insets?.getInsets(WindowInsetsCompat.Type.statusBars())
    val windowWidth = WindowMetricsCalculator.getOrCreate()
      .computeCurrentWindowMetrics(activity).bounds.width()
    if (bars != null && bars.top > 0) {
      out.add(region("occlusion", Rect(0, 0, windowWidth, bars.top), d))
    }

    return out
  }

  private fun region(kind: String, bounds: Rect, d: Float): Map<String, Any> = mapOf(
    "kind" to kind,
    "x" to bounds.left / d,
    "y" to bounds.top / d,
    "width" to bounds.width() / d,
    "height" to bounds.height() / d,
    // Android reports no breathing room around a feature, only the feature.
    // Zero here is honest, and it is what makes topChrome.estimated true —
    // the same as iOS 27.1, which also reports none.
    "marginTop" to 0.0,
    "marginRight" to 0.0,
    "marginBottom" to 0.0,
    "marginLeft" to 0.0,
  )

  private fun windowMetrics(): Map<String, Any> {
    val activity = appContext.activityProvider?.currentActivity ?: return emptyMetrics()
    val d = density()
    val calculator = WindowMetricsCalculator.getOrCreate()
    // current is this window; maximum is the whole display. In split-screen
    // or a freeform window the two differ, and the offset between them is
    // what says which side of the display the app is on — the question the
    // insets cannot answer, here as on iOS.
    val window = calculator.computeCurrentWindowMetrics(activity).bounds
    val display = calculator.computeMaximumWindowMetrics(activity).bounds

    val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
      ?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())

    return mapOf(
      "width" to window.width() / d,
      "height" to window.height() / d,
      "x" to window.left / d,
      "y" to window.top / d,
      "screenWidth" to display.width() / d,
      "screenHeight" to display.height() / d,
      "insetTop" to (insets?.top ?: 0) / d,
      "insetRight" to (insets?.right ?: 0) / d,
      "insetBottom" to (insets?.bottom ?: 0) / d,
      "insetLeft" to (insets?.left ?: 0) / d,
    )
  }

  private fun emptyMetrics(): Map<String, Any> = mapOf(
    "width" to 0.0, "height" to 0.0, "x" to 0.0, "y" to 0.0,
    "screenWidth" to 0.0, "screenHeight" to 0.0,
    "insetTop" to 0.0, "insetRight" to 0.0, "insetBottom" to 0.0, "insetLeft" to 0.0,
  )
}
