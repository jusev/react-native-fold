import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
// Imported by name, not as CodegenTypes.EventEmitter: codegen's TypeScript
// parser recognises an event emitter by the literal type name `EventEmitter`.
import type { EventEmitter, UnsafeObject } from "react-native/Libraries/Types/CodegenTypes";

export interface Spec extends TurboModule {
  // Synchronous on purpose, as upstream: layout needs these on the first
  // frame, and a promise would render once without them and again with them.
  getReservedRegions(): Array<UnsafeObject>;
  getWindowSize(): UnsafeObject;
  isSupported(): boolean;

  // Carries no payload. Upstream's listener ignores it and re-reads through
  // the getters above, so there is nothing to serialise and nothing to drift.
  readonly onReservedRegionsChange: EventEmitter<void>;
}

// `get`, not `getEnforcing`: this module must never be the reason the app
// fails to start on a build or platform where it is absent.
export default TurboModuleRegistry.get<Spec>("RNFold");
