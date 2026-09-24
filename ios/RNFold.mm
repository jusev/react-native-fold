// Port of @jusev/react-native-fold 0.2.1 (ios/RNFoldModule.swift and
// ios/RNFoldObserverView.swift, commit c4a80aec6fd2) from an Expo module to a
// plain TurboModule. Behaviour follows upstream; the deliberate differences are
// marked NOTE. MIT, see LICENSE.

#import "RNFold.h"

#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

// UIViewReservedRegion only exists in the iOS 27.1 SDK. @available guards the
// RUNTIME; it does not stop the compiler rejecting a symbol the SDK never
// declared. So the 27.1 calls are compiled out against older SDKs, and the
// module builds everywhere and reports isSupported: NO where it cannot answer.
#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && __IPHONE_OS_VERSION_MAX_ALLOWED >= 270100
#define RNFOLD_HAS_RESERVED_REGIONS 1
#else
#define RNFOLD_HAS_RESERVED_REGIONS 0
#endif

#pragma mark - Observer view

// An invisible view whose only job is to notice that layout happened. UIKit
// posts no notification when reserved regions change; it expects a view to
// re-query them while it lays out. layoutSubviews fires for a fold, a
// rotation, a Split View resize and a display change alike.
@interface RNFoldObserverView : UIView
@property (nonatomic, copy, nullable) void (^onLayout)(void);
@end

@implementation RNFoldObserverView

- (instancetype)init
{
  if (self = [super initWithFrame:CGRectZero]) {
    self.userInteractionEnabled = NO;
    self.backgroundColor = UIColor.clearColor;
    self.opaque = NO;
    // Full-size and flexible: a zero-sized view is not re-laid-out when its
    // window changes shape, and that change is the entire point.
    self.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  if (self.onLayout) self.onLayout();
}

// Fires on some transitions that do not resize the view.
- (void)safeAreaInsetsDidChange
{
  [super safeAreaInsetsDidChange];
  if (self.onLayout) self.onLayout();
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window != nil && self.onLayout) self.onLayout();
}

@end

#pragma mark - Module

@implementation RNFold {
  RNFoldObserverView *_observer;
  // The last state sent, so layout passes that change nothing stay silent.
  // Holds the window metrics as well as the regions: a window can move
  // across the display without its regions changing.
  NSDictionary *_lastSent;
  NSMutableArray<id<NSObject>> *_sceneTokens;
  // NOTE: the generated emitter calls an empty std::function (and
  // throws) if used before JS has wired it up, so nothing is emitted until
  // setEventEmitterCallback: has run. Touched only on the main queue.
  BOOL _canEmit;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _sceneTokens = [NSMutableArray new];
  }
  return self;
}

// NOTE: upstream installs the observer when JS starts listening
// (Expo's OnStartObserving). A codegen EventEmitter has no such hook, so it is
// installed once the module is wired up — i.e. when the app first imports the
// package. An app that never imports it still pays nothing.
- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  [super setEventEmitterCallback:eventEmitterCallbackWrapper];
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_canEmit = YES;
    [self attachObserver];
    [self observeSceneChanges];
  });
}

- (void)invalidate
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_canEmit = NO;
    [self stopObservingSceneChanges];
    [self detachObserver];
  });
}

#pragma mark Spec

// NOTE: these are synchronous, so they run on the JS thread, but they
// read UIKit (connectedScenes, window bounds, reserved regions), which must be
// read on the main thread. They hop there for the read.
- (NSArray<NSDictionary *> *)getReservedRegions
{
  __block NSArray<NSDictionary *> *result = @[];
  RCTUnsafeExecuteOnMainQueueSync(^{
    result = [RNFold reservedRegions];
  });
  return result;
}

- (NSDictionary *)getWindowSize
{
  __block NSDictionary *result = @{};
  RCTUnsafeExecuteOnMainQueueSync(^{
    result = [RNFold windowMetrics];
  });
  return result;
}

- (NSNumber *)isSupported
{
#if RNFOLD_HAS_RESERVED_REGIONS
  if (@available(iOS 27.1, *)) {
    return @YES;
  }
#endif
  return @NO;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeRNFoldSpecJSI>(params);
}

#pragma mark Observer lifecycle (main queue)

- (void)attachObserver
{
  if (_observer != nil) return;
  UIWindow *window = [RNFold keyWindow];
  if (window == nil) return;

  RNFoldObserverView *view = [RNFoldObserverView new];
  view.frame = window.bounds;
  __weak RNFold *weakSelf = self;
  view.onLayout = ^{
    [weakSelf emitIfChanged];
  };
  // At the back, under everything the app draws.
  [window insertSubview:view atIndex:0];
  _observer = view;
  [self emitIfChanged];
}

- (void)detachObserver
{
  _observer.onLayout = nil;
  [_observer removeFromSuperview];
  _observer = nil;
  _lastSent = nil;
}

// A window can be handed to a different UIWindow when the app is resized into
// or out of a shared display, and the observer goes with the old one.
// layoutSubviews cannot catch that; scene notifications can.
- (void)observeSceneChanges
{
  if (_sceneTokens.count > 0) return;
  __weak RNFold *weakSelf = self;
  for (NSNotificationName name in @[ UISceneDidActivateNotification, UIApplicationDidBecomeActiveNotification ]) {
    id token = [NSNotificationCenter.defaultCenter addObserverForName:name
                                                               object:nil
                                                                queue:NSOperationQueue.mainQueue
                                                           usingBlock:^(NSNotification *_Nonnull note) {
                                                             [weakSelf reattachIfNeeded];
                                                           }];
    [_sceneTokens addObject:token];
  }
}

- (void)stopObservingSceneChanges
{
  for (id token in _sceneTokens) {
    [NSNotificationCenter.defaultCenter removeObserver:token];
  }
  [_sceneTokens removeAllObjects];
}

- (void)reattachIfNeeded
{
  // NOTE: upstream returns here when there is no observer. Because
  // this port attaches at module setup rather than on subscription, a key
  // window that did not exist yet at that moment would otherwise never get
  // one. Activation is the natural retry point.
  if (_observer == nil) {
    [self attachObserver];
    return;
  }
  if (_observer.window != [RNFold keyWindow]) {
    // detachObserver clears _lastSent, so the move is always followed by a
    // fresh report rather than being deduped against the old window's.
    [self detachObserver];
    [self attachObserver];
  } else {
    [self emitIfChanged];
  }
}

- (void)emitIfChanged
{
  NSDictionary *state = @{@"regions" : [RNFold reservedRegions], @"window" : [RNFold windowMetrics]};
  if (_lastSent != nil && [_lastSent isEqualToDictionary:state]) return;
  _lastSent = state;
  if (_canEmit && _eventEmitterCallback) {
    [self emitOnReservedRegionsChange];
  }
}

#pragma mark Measurements (main queue)

+ (nullable UIWindow *)keyWindow
{
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (window.isKeyWindow) return window;
    }
  }
  return nil;
}

// The window's size, where it sits ON THE DISPLAY, and its safe area.
+ (NSDictionary *)windowMetrics
{
  UIWindow *window = [RNFold keyWindow];
  if (window == nil) {
    return @{
      @"width" : @0, @"height" : @0, @"x" : @0, @"y" : @0,
      @"screenWidth" : @0, @"screenHeight" : @0,
      @"insetTop" : @0, @"insetRight" : @0, @"insetBottom" : @0, @"insetLeft" : @0,
    };
  }
  CGRect bounds = window.bounds;
  // Not window.frame: a window sharing the display is given its own
  // coordinate space, so its frame origin is {0, 0} whichever half it is in.
  // Converting into the screen's coordinateSpace (not fixedCoordinateSpace,
  // which is locked to portrait) is what answers which side it is on.
  UIScreen *screen = window.windowScene.screen;
  CGRect onScreen = screen ? [window convertRect:bounds toCoordinateSpace:screen.coordinateSpace] : bounds;
  CGRect screenBounds = screen ? screen.bounds : bounds;
  UIEdgeInsets safe = window.safeAreaInsets;
  return @{
    @"width" : @(bounds.size.width),
    @"height" : @(bounds.size.height),
    @"x" : @(onScreen.origin.x),
    @"y" : @(onScreen.origin.y),
    @"screenWidth" : @(screenBounds.size.width),
    @"screenHeight" : @(screenBounds.size.height),
    @"insetTop" : @(safe.top),
    @"insetRight" : @(safe.right),
    @"insetBottom" : @(safe.bottom),
    @"insetLeft" : @(safe.left),
  };
}

+ (NSArray<NSDictionary *> *)reservedRegions
{
  NSMutableArray<NSDictionary *> *out = [NSMutableArray new];
#if RNFOLD_HAS_RESERVED_REGIONS
  if (@available(iOS 27.1, *)) {
    UIWindow *window = [RNFold keyWindow];
    if (window == nil) return out;

    // UIViewReservedRegionKind is a class with factory methods, not an enum.
    NSArray<NSArray *> *kinds = @[
      @[ @"occlusion", [UIViewReservedRegionKind occlusionRegionKind] ],
      @[ @"division", [UIViewReservedRegionKind divisionRegionKind] ],
    ];
    for (NSArray *pair in kinds) {
      // The single-argument form excludes inactive regions, deliberately: a
      // region not currently there should not push the layout around.
      for (UIViewReservedRegion *region in [window reservedRegionsOfKind:pair[1]]) {
        CGRect f = region.frame;
        UIEdgeInsets m = region.margins;
        [out addObject:@{
          @"kind" : pair[0],
          @"x" : @(f.origin.x),
          @"y" : @(f.origin.y),
          @"width" : @(f.size.width),
          @"height" : @(f.size.height),
          // The frame already includes these; reported separately so a
          // caller can tell the hardware from the system's breathing room.
          @"marginTop" : @(m.top),
          @"marginRight" : @(m.right),
          @"marginBottom" : @(m.bottom),
          @"marginLeft" : @(m.left),
        }];
      }
    }
  }
#endif
  return out;
}

@end
