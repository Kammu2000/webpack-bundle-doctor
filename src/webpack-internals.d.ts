/**
 * Minimal ambient declarations for webpack internal modules that have no public
 * TypeScript types but are needed at runtime for instanceof checks.
 */

declare module "webpack/lib/optimize/ConcatenatedModule" {
  import type { Module } from "webpack";

  class ConcatenatedModule extends Module {
    readonly modules: Set<Module>;
  }

  export default ConcatenatedModule;
}
