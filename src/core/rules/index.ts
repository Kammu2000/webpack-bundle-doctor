import { Rule } from "../../shared/types.js";
import { duplicatePackagesRule } from "./duplicate-packages.js";
import { largeChunkRule } from "./large-chunk.js";
import { largeModuleRule } from "./large-module.js";
import { inlinedSvgRule } from "./inlined-svg.js";
import { unnamedChunkRule } from "./unnamed-chunk.js";

export const defaultRules: Map<string, Rule<Record<string, unknown>>> = new Map([
  [duplicatePackagesRule.id, duplicatePackagesRule as Rule<Record<string, unknown>>],
  [largeChunkRule.id, largeChunkRule as Rule<Record<string, unknown>>],
  [largeModuleRule.id, largeModuleRule as Rule<Record<string, unknown>>],
  [inlinedSvgRule.id, inlinedSvgRule as Rule<Record<string, unknown>>],
  [unnamedChunkRule.id, unnamedChunkRule as Rule<Record<string, unknown>>],
]);
