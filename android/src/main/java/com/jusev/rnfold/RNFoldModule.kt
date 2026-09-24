// Port of @jusev/react-native-fold 0.2.1 (android/.../RNFoldModule.kt, commit
// c4a80aec6fd2) from an Expo module to a plain TurboModule. Behaviour follows
// upstream; the deliberate differences are marked NOTE. MIT, see
// LICENSE.
package com.jusev.rnfold

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
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.CxxCallbackImpl
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.Executor

/**
 * Reports the regions the system has reserved inside the app's own window —
 * the Android half of the same idea as the iOS module, in the same shapes.
 *
 *   division   a FoldingFeature from Jetpack WindowManager, the only thing on
 *              the platform that reports a hinge.
 *   occlusion  the DisplayCutout's bounding rects and the status bar.
 *
 * FoldingFeature.bounds is in PIXELS; everything leaving this file is divided
 * by density, because React Native lays out in dp.
 */
class RNFoldModule(reactContext: ReactApplicationContext) :
  NativeRNFoldSpec(reactContext), LifecycleEventListener {

  companion object {
    const val NAME = NativeRNFoldSpec.NAME
  }

  private data class State(val regions: List<Map<String, Any>>, val window: Map<String, Any>)

  private var tracker: WindowInfoTrackerCallbackAdapter? = null
  private var listener: Consumer<WindowLayoutInfo>? = null
  private var listeningTo: Activity? = null

  // WindowManager only calls back when the FOLDING FEATURES change. Moving to
  // the other display, rotating an unfolded device, a multi-window resize —
  // none necessarily change the feature list. A layout listener catches them.
  private var layoutListener: View.OnLayoutChangeListener? = null
  private var layoutHost: View? = null

  /** The most recent layout, written on the UI thread. */
  @Volatile private var latest: WindowLayoutInfo? = null

  // NOTE: upstream keeps this only to dedupe. Here it is also the
  // cache the synchronous getters read from. Those run on the JS thread, and
  // reading Views from there is not thread-safe; the state is computed on the
  // UI thread instead and published through this volatile reference.
  @Volatile private var lastSent: State? = null

  private val mainExecutor = Executor { command -> UiThreadUtil.runOnUiThread(command) }

  init {
    reactContext.addLifecycleEventListener(this)
  }

  // NOTE: upstream attaches on OnStartObserving. A codegen
  // EventEmitter has no such hook, so it attaches once JS has wired the
  // module up — and the generated emit dereferences this callback, so nothing
  // may be emitted before it exists.
  override fun setEventEmitterCallback(eventEmitterCallback: CxxCallbackImpl) {
    super.setEventEmitterCallback(eventEmitterCallback)
    UiThreadUtil.runOnUiThread { attach() }
  }

  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    UiThreadUtil.runOnUiThread { detach() }
    super.invalidate()
  }

  // The activity can be recreated under us, and the listener goes with the old
  // one. Upstream's OnActivityEntersForeground / OnActivityDestroys.
  override fun onHostResume() {
    UiThreadUtil.runOnUiThread { attach() }
  }

  override fun onHostPause() {}

  override fun onHostDestroy() {
    UiThreadUtil.runOnUiThread { detach() }
  }

  override fun getReservedRegions(): WritableArray = toArray(lastSent?.regions ?: regions())

  override fun getWindowSize(): WritableMap = toMap(lastSent?.window ?: windowMetrics())

  // Always true: WindowManager answers on every supported version, and an
  // empty answer is a real answer rather than a missing one.
  override fun isSupported(): Boolean = true

  private fun attach() {
    val activity = reactApplicationContext.currentActivity ?: return
    if (listeningTo === activity && listener != null) return
    detach()

    val adapter = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(activity))
    val consumer = Consumer<WindowLayoutInfo> { info ->
      latest = info
      emitIfChanged()
    }
    // Deliberately NOT gated on FEATURE_SENSOR_HINGE_ANGLE, which many
    // foldables never expose.
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

  /** UI thread only. */
  private fun emitIfChanged() {
    val state = State(regions(), windowMetrics())
    if (state == lastSent) return
    lastSent = state
    if (mEventEmitterCallback != null) emitOnReservedRegionsChange()
  }

  private fun density(): Float = reactApplicationContext.resources.displayMetrics.density

  private fun regions(): List<Map<String, Any>> {
    val activity = reactApplicationContext.currentActivity ?: return emptyList()
    // A feature that no longer fits inside this window is a stale reading from
    // the other display, not a crease.
    val bounds = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(activity).bounds
    val d = density()
    val out = mutableListOf<Map<String, Any>>()

    latest?.displayFeatures?.forEach { feature ->
      if (feature !is FoldingFeature) return@forEach
      // isSeparating, not "there is a hinge": a crease you cannot see is not
      // one a layout has to avoid.
      if (!feature.isSeparating) return@forEach
      if (!bounds.contains(feature.bounds)) return@forEach
      out.add(region("division", feature.bounds, d))
    }

    val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
    insets?.displayCutout?.boundingRects?.forEach { out.add(region("occlusion", it, d)) }

    // The status bar spans the whole top edge; reporting only the cutout would
    // describe a free row beside it that is not free.
    val bars = insets?.getInsets(WindowInsetsCompat.Type.statusBars())
    if (bars != null && bars.top > 0) {
      out.add(region("occlusion", Rect(0, 0, bounds.width(), bars.top), d))
    }
    return out
  }

  private fun region(kind: String, bounds: Rect, d: Float): Map<String, Any> = mapOf(
    "kind" to kind,
    "x" to (bounds.left / d).toDouble(),
    "y" to (bounds.top / d).toDouble(),
    "width" to (bounds.width() / d).toDouble(),
    "height" to (bounds.height() / d).toDouble(),
    // Android reports no breathing room around a feature. Zero is honest.
    "marginTop" to 0.0,
    "marginRight" to 0.0,
    "marginBottom" to 0.0,
    "marginLeft" to 0.0,
  )

  private fun windowMetrics(): Map<String, Any> {
    val activity = reactApplicationContext.currentActivity ?: return emptyMetrics()
    val d = density()
    val calculator = WindowMetricsCalculator.getOrCreate()
    // current is this window; maximum is the whole display. The offset between
    // them says which side of the display the app is on.
    val window = calculator.computeCurrentWindowMetrics(activity).bounds
    val display = calculator.computeMaximumWindowMetrics(activity).bounds
    val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
      ?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())

    return mapOf(
      "width" to (window.width() / d).toDouble(),
      "height" to (window.height() / d).toDouble(),
      "x" to (window.left / d).toDouble(),
      "y" to (window.top / d).toDouble(),
      "screenWidth" to (display.width() / d).toDouble(),
      "screenHeight" to (display.height() / d).toDouble(),
      "insetTop" to ((insets?.top ?: 0) / d).toDouble(),
      "insetRight" to ((insets?.right ?: 0) / d).toDouble(),
      "insetBottom" to ((insets?.bottom ?: 0) / d).toDouble(),
      "insetLeft" to ((insets?.left ?: 0) / d).toDouble(),
    )
  }

  private fun emptyMetrics(): Map<String, Any> = mapOf(
    "width" to 0.0, "height" to 0.0, "x" to 0.0, "y" to 0.0,
    "screenWidth" to 0.0, "screenHeight" to 0.0,
    "insetTop" to 0.0, "insetRight" to 0.0, "insetBottom" to 0.0, "insetLeft" to 0.0,
  )

  private fun toMap(values: Map<String, Any>): WritableMap = Arguments.createMap().apply {
    values.forEach { (key, value) ->
      when (value) {
        is String -> putString(key, value)
        is Number -> putDouble(key, value.toDouble())
        is Boolean -> putBoolean(key, value)
      }
    }
  }

  private fun toArray(list: List<Map<String, Any>>): WritableArray =
    Arguments.createArray().apply { list.forEach { pushMap(toMap(it)) } }
}
