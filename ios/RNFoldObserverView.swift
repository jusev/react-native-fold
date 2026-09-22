import UIKit

/**
 An invisible view whose only job is to notice that layout happened.

 UIKit posts no notification when reserved regions change; it expects a view
 to re-query them while it lays out. From JavaScript the nearest available
 signal is a window resize, and that arrives BEFORE the window has finished
 moving to the other display of a foldable — so reading then returns the
 regions of the display being left, and the app lays out against the wrong
 panel until something else disturbs it.

 Rather than leave every app to guess when to look, the package installs this
 into the window and looks at the moment UIKit itself says the layout is
 settled. `layoutSubviews` fires for a fold, a rotation, a Split View resize
 and a display change alike, which is the whole set of events that can move a
 reserved region.

 It is deliberately inert: no background, no touch handling, and it sits at
 the back of the window, so it cannot draw over anything or swallow a tap.
 It exists to be laid out.
 */
final class RNFoldObserverView: UIView {
  var onLayout: (() -> Void)?

  init() {
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    backgroundColor = .clear
    isOpaque = false
    // Full-size and flexible, because a zero-sized view is not re-laid-out
    // when its window changes shape — and that change is the entire point.
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayout?()
  }

  // Fires on some transitions that do not resize the view, so both are
  // observed rather than assuming one implies the other.
  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    onLayout?()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { onLayout?() }
  }
}
