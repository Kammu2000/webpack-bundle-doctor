/**
 * Parses an emitted webpack bundle (JS string) and extracts per-module byte sizes.
 *
 * This is a TypeScript port of webpack-bundle-analyzer's parseUtils.js. The key
 * adaptation is that we accept the bundle source as a string (already in memory
 * from compilation.assets) rather than reading from disk, and we return computed
 * sizes instead of raw source slices.
 *
 * Only modules that appear as individual entries in the bundle's module registry
 * (non-scope-hoisted) will have exact sizes. Scope-hoisted (ConcatenatedModule)
 * inner modules are not present in the registry and are handled by the proportional
 * fallback in context-builder.ts.
 */

import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { gzipSync } from "zlib";

// ── Internal types ────────────────────────────────────────────────────────────

/** Character offset range of a module node within the bundle source. */
interface ModuleLoc {
  start: number;
  end: number;
}

/** Map from module ID string to its location in the bundle source. */
type ModuleLocations = Record<string, ModuleLoc>;

/** State threaded through the acorn-walk recursive visitor. */
interface WalkState {
  locations: ModuleLocations | null;
  expressionStatementDepth: number;
}

// ── Public types ──────────────────────────────────────────────────────────────

/** Map from module ID (string) to its exact post-Terser byte sizes. */
export type BundleModuleSizes = Map<string, { parsed: number; gzipped: number }>;

// ── Predicate helpers (ported from parseUtils.js) ────────────────────────────
// These detect the various bundle format patterns webpack emits.

function isNumericId(node: acorn.Node): boolean {
  return (
    node.type === "Literal" &&
    (node as acorn.Literal).value !== null &&
    (node as acorn.Literal).value !== undefined &&
    Number.isInteger((node as acorn.Literal).value) &&
    ((node as acorn.Literal).value as number) >= 0
  );
}

function isModuleId(node: acorn.Node | null | undefined): boolean {
  return (
    node != null &&
    node.type === "Literal" &&
    (isNumericId(node) || typeof (node as acorn.Literal).value === "string")
  );
}

function isModuleWrapper(node: acorn.Node | null | undefined): boolean {
  if (node == null) return false;
  return (
    // Anonymous function expression or arrow function wrapping a module
    ((node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") &&
      !(node as acorn.FunctionExpression).id) ||
    // DedupePlugin: a module ID referencing a deduplicated module
    isModuleId(node) ||
    // Array [<module_id>, ...args] (used by some plugins)
    (node.type === "ArrayExpression" &&
      (node as acorn.ArrayExpression).elements.length > 1 &&
      isModuleId((node as acorn.ArrayExpression).elements[0]))
  );
}

function isModulesHash(node: acorn.Node | null | undefined): boolean {
  return (
    node != null &&
    node.type === "ObjectExpression" &&
    (node as acorn.ObjectExpression).properties
      .filter((p) => p.type !== "SpreadElement")
      .map((p) => (p as acorn.Property).value)
      .every(isModuleWrapper)
  );
}

function isModulesArray(node: acorn.Node | null | undefined): boolean {
  return (
    node != null &&
    node.type === "ArrayExpression" &&
    (node as acorn.ArrayExpression).elements.every(
      (el) => el == null || isModuleWrapper(el),
    )
  );
}

function isSimpleModulesList(node: acorn.Node | null | undefined): boolean {
  return isModulesHash(node) || isModulesArray(node);
}

function isOptimizedModulesArray(node: acorn.Node | null | undefined): boolean {
  // Matches: Array(<minId>).concat([<module>, <module>, ...])
  // Webpack v1 optimization: https://github.com/webpack/webpack/blob/v1.14.0/lib/Template.js#L91
  if (node == null || node.type !== "CallExpression") return false;
  const call = node as acorn.CallExpression;
  return (
    call.callee.type === "MemberExpression" &&
    (call.callee as acorn.MemberExpression).object.type === "CallExpression" &&
    ((call.callee as acorn.MemberExpression).object as acorn.CallExpression).callee
      .type === "Identifier" &&
    (
      ((call.callee as acorn.MemberExpression).object as acorn.CallExpression)
        .callee as acorn.Identifier
    ).name === "Array" &&
    ((call.callee as acorn.MemberExpression).object as acorn.CallExpression).arguments
      .length === 1 &&
    ((call.callee as acorn.MemberExpression).object as acorn.CallExpression)
      .arguments[0].type !== "SpreadElement" &&
    isNumericId(
      ((call.callee as acorn.MemberExpression).object as acorn.CallExpression)
        .arguments[0],
    ) &&
    (call.callee as acorn.MemberExpression).property.type === "Identifier" &&
    ((call.callee as acorn.MemberExpression).property as acorn.Identifier).name ===
      "concat" &&
    call.arguments.length === 1 &&
    isModulesArray(call.arguments[0])
  );
}

function isModulesList(node: acorn.Node | null | undefined): boolean {
  return isSimpleModulesList(node) || isOptimizedModulesArray(node);
}

function isIIFE(node: acorn.ExpressionStatement): boolean {
  return (
    node.type === "ExpressionStatement" &&
    (node.expression.type === "CallExpression" ||
      (node.expression.type === "UnaryExpression" &&
        (node.expression as acorn.UnaryExpression).argument.type === "CallExpression"))
  );
}

function getIIFECallExpression(
  node: acorn.ExpressionStatement,
): acorn.CallExpression {
  if (node.expression.type === "UnaryExpression") {
    return (node.expression as acorn.UnaryExpression)
      .argument as acorn.CallExpression;
  }
  return node.expression as acorn.CallExpression;
}

function isChunkIds(node: acorn.Node): boolean {
  return (
    node.type === "ArrayExpression" &&
    (node as acorn.ArrayExpression).elements.every(isModuleId)
  );
}

function mayBeAsyncChunkArguments(
  args: (acorn.Node | acorn.SpreadElement | null)[],
): boolean {
  return (
    args.length >= 2 &&
    args[0] != null &&
    args[0].type !== "SpreadElement" &&
    isChunkIds(args[0])
  );
}

function isAsyncChunkPushExpression(node: acorn.CallExpression): boolean {
  const { callee, arguments: args } = node;
  return (
    callee.type === "MemberExpression" &&
    (callee as acorn.MemberExpression).property.type === "Identifier" &&
    ((callee as acorn.MemberExpression).property as acorn.Identifier).name === "push" &&
    (callee as acorn.MemberExpression).object.type === "AssignmentExpression" &&
    args.length === 1 &&
    args[0].type === "ArrayExpression" &&
    mayBeAsyncChunkArguments((args[0] as acorn.ArrayExpression).elements) &&
    isModulesList((args[0] as acorn.ArrayExpression).elements[1])
  );
}

function isAsyncWebWorkerChunkExpression(node: acorn.CallExpression): boolean {
  const { callee, arguments: args } = node;
  return (
    callee.type === "MemberExpression" &&
    args.length === 2 &&
    args[0].type !== "SpreadElement" &&
    isChunkIds(args[0]) &&
    isModulesList(args[1])
  );
}

// ── Location extraction ───────────────────────────────────────────────────────

/**
 * Given the module registry AST node (an ObjectExpression or ArrayExpression),
 * returns a map of module IDs to their {start, end} character offsets.
 */
function getModulesLocations(node: acorn.Node): ModuleLocations {
  const result: ModuleLocations = {};

  if (node.type === "ObjectExpression") {
    for (const prop of (node as acorn.ObjectExpression).properties) {
      if (prop.type !== "Property") continue;
      const p = prop as acorn.Property;
      const moduleId: string =
        p.key.type === "Identifier"
          ? (p.key as acorn.Identifier).name
          : String((p.key as acorn.Literal).value);
      if (moduleId === "undefined") continue;
      result[moduleId] = { start: p.value.start, end: p.value.end };
    }
    return result;
  }

  const isOptimizedArray = node.type === "CallExpression";
  if (node.type === "ArrayExpression" || isOptimizedArray) {
    const minId: number =
      isOptimizedArray &&
      (node as acorn.CallExpression).callee.type === "MemberExpression" &&
      ((node as acorn.CallExpression).callee as acorn.MemberExpression).object
        .type === "CallExpression" &&
      (
        ((node as acorn.CallExpression).callee as acorn.MemberExpression)
          .object as acorn.CallExpression
      ).arguments[0]?.type === "Literal"
        ? (
            (
              ((node as acorn.CallExpression).callee as acorn.MemberExpression)
                .object as acorn.CallExpression
            ).arguments[0] as acorn.Literal
          ).value as number
        : 0;

    const elements: (acorn.Node | null)[] = isOptimizedArray
      ? (node as acorn.CallExpression).arguments[0]?.type === "ArrayExpression"
        ? ((node as acorn.CallExpression).arguments[0] as acorn.ArrayExpression)
            .elements
        : []
      : (node as acorn.ArrayExpression).elements;

    elements.forEach((el, i) => {
      if (el) result[i + minId] = { start: el.start, end: el.end };
    });
  }

  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parses a webpack bundle source string and returns exact post-Terser byte sizes
 * for each module found in the bundle's module registry.
 *
 * Returns an empty Map if acorn cannot parse the source (e.g. non-JS asset,
 * unsupported syntax). Callers should fall back to proportional estimation
 * for any module IDs not present in the returned Map.
 *
 * @param source  Full text of the emitted bundle file (from compilation.assets[name].source())
 * @param isESM   True when the asset was emitted as an ES module (output.module: true)
 */
export function parseSourceForModuleSizes(
  source: string,
  isESM: boolean,
): BundleModuleSizes {
  const result: BundleModuleSizes = new Map();

  let ast: acorn.Program;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: isESM ? "module" : "script",
    });
  } catch {
    // Acorn parse failure: non-JS asset, unsupported syntax, or binary content.
    // Return empty map; Pass 1.5 proportional fallback handles all modules.
    return result;
  }

  const walkState: WalkState = {
    locations: null,
    expressionStatementDepth: 0,
  };

  walk.recursive(ast, walkState, {
    ExpressionStatement(
      node: acorn.ExpressionStatement,
      state: WalkState,
      callback: (node: acorn.AnyNode, state: WalkState) => void,
    ) {
      if (state.locations) return;
      state.expressionStatementDepth++;

      if (
        // Webpack 5: modules are in the top-level IIFE's first variable declaration
        state.expressionStatementDepth === 1 &&
        (ast.body as acorn.Statement[]).includes(node) &&
        isIIFE(node)
      ) {
        const fn = getIIFECallExpression(node);
        if (
          fn.type === "CallExpression" &&
          fn.arguments.length === 0 &&
          (fn.callee.type === "FunctionExpression" ||
            fn.callee.type === "ArrowFunctionExpression") &&
          (fn.callee as acorn.FunctionExpression).params.length === 0 &&
          (fn.callee as acorn.FunctionExpression).body.type === "BlockStatement"
        ) {
          const body = (
            (fn.callee as acorn.FunctionExpression).body as acorn.BlockStatement
          ).body;
          const firstVarDecl = body.find(
            (n): n is acorn.VariableDeclaration => n.type === "VariableDeclaration",
          );
          if (firstVarDecl) {
            for (const decl of firstVarDecl.declarations) {
              if (decl.init && isModulesList(decl.init)) {
                state.locations = getModulesLocations(decl.init);
                if (state.locations) break;
              }
            }
          }
        }
      }

      if (!state.locations) callback(node.expression as acorn.AnyNode, state);
      state.expressionStatementDepth--;
    },

    AssignmentExpression(node: acorn.AssignmentExpression, state: WalkState) {
      if (state.locations) return;
      // Webpack: exports.modules = { ... }
      const { left, right } = node;
      if (
        left.type === "MemberExpression" &&
        (left as acorn.MemberExpression).object.type === "Identifier" &&
        ((left as acorn.MemberExpression).object as acorn.Identifier).name ===
          "exports" &&
        (left as acorn.MemberExpression).property.type === "Identifier" &&
        ((left as acorn.MemberExpression).property as acorn.Identifier).name ===
          "modules" &&
        isModulesHash(right)
      ) {
        state.locations = getModulesLocations(right);
      }
    },

    CallExpression(
      node: acorn.CallExpression,
      state: WalkState,
      callback: (node: acorn.AnyNode, state: WalkState) => void,
    ) {
      if (state.locations) return;
      const args = node.arguments;

      // Webpack 4 main chunk: (function(...) { ... })(<modules>)
      if (
        node.callee.type === "FunctionExpression" &&
        !(node.callee as acorn.FunctionExpression).id &&
        args.length === 1 &&
        isSimpleModulesList(args[0])
      ) {
        state.locations = getModulesLocations(args[0] as acorn.Node);
        return;
      }

      // Async webpack <v4: webpackJsonp([<chunks>], <modules>, ...)
      if (
        node.callee.type === "Identifier" &&
        mayBeAsyncChunkArguments(args) &&
        args[1].type !== "SpreadElement" &&
        isModulesList(args[1])
      ) {
        state.locations = getModulesLocations(args[1] as acorn.Node);
        return;
      }

      // Async webpack v4: (window.webpackJsonp||[]).push([[<chunks>], <modules>, ...])
      if (
        isAsyncChunkPushExpression(node) &&
        args[0].type === "ArrayExpression" &&
        (args[0] as acorn.ArrayExpression).elements[1]
      ) {
        state.locations = getModulesLocations(
          (args[0] as acorn.ArrayExpression).elements[1] as acorn.Node,
        );
        return;
      }

      // Webpack WebWorkerChunkTemplatePlugin: globalObject.chunkCallbackName([<chunks>], <modules>, ...)
      if (isAsyncWebWorkerChunkExpression(node)) {
        state.locations = getModulesLocations(args[1] as acorn.Node);
        return;
      }

      // Walk into arguments — some plugins (DedupePlugin, UMD output) wrap modules in additional IIFEs
      for (const arg of args) {
        callback(arg as acorn.AnyNode, state);
      }
    },
  });

  if (!walkState.locations) return result;

  for (const [id, loc] of Object.entries(walkState.locations)) {
    const slice = source.slice(loc.start, loc.end);
    // Use Buffer.from for byte-accurate size (multi-byte UTF-8), consistent with
    // how getChunkAssetSizes uses asset.buffer().length.
    const buf = Buffer.from(slice, "utf8");
    result.set(String(id), {
      parsed: buf.length,
      gzipped: gzipSync(buf).length,
    });
  }

  return result;
}
