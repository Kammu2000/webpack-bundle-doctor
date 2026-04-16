import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { gzipSync } from "zlib";
import { ModuleBoundsById, BundleModuleSizes } from "./types.js";
import {
  asArray, asFn, asMember,
  buildModuleBoundsById,
  isChunkIdList,
  isJsonpPushCall,
  isModuleContainer,
  isObjectContainer,
  isWebWorkerChunkCall,
  tryExtractFromIIFEBody,
} from "./patterns.js";

interface SearchState {
  found: ModuleBoundsById | null;
  stmtDepth: number;
}

/**
 * Walks the AST and returns the first module container found, or null.
 *
 * Handles:
 *   - Webpack 5 production: top-level no-arg IIFE, container in first var decl
 *   - Webpack 4 main chunk: IIFE called with container as first argument
 *   - Webpack 4 async chunk (jsonp push): `(webpackChunk||[]).push([[id], container])`
 *   - Webpack legacy jsonp: `webpackJsonp([chunkIds], container, ...)`
 *   - WebWorker chunk: `globalObject.callback([chunkIds], container)`
 *   - Nested IIFEs from UMD / DedupePlugin wrappers
 */
function locateModuleBoundsById(ast: acorn.Program): ModuleBoundsById | null {
  const state: SearchState = { found: null, stmtDepth: 0 };

  walk.recursive(ast, state, {
    ExpressionStatement(
      node: acorn.ExpressionStatement,
      st: SearchState,
      descend: (n: acorn.AnyNode, s: SearchState) => void,
    ) {
      if (st.found) return;
      st.stmtDepth++;

      if (st.stmtDepth === 1 && (ast.body as acorn.Statement[]).includes(node)) {
        // Webpack 5: outermost statement is a no-arg IIFE
        const expr = node.expression;
        const callExpr: acorn.CallExpression | null =
          expr.type === "CallExpression"
            ? (expr as acorn.CallExpression)
            : expr.type === "UnaryExpression" &&
                (expr as acorn.UnaryExpression).argument.type === "CallExpression"
              ? ((expr as acorn.UnaryExpression).argument as acorn.CallExpression)
              : null;

        if (callExpr && callExpr.arguments.length === 0) {
          const fn = callExpr.callee;
          if (fn.type === "FunctionExpression" || fn.type === "ArrowFunctionExpression") {
            st.found = tryExtractFromIIFEBody(asFn(fn));
            if (st.found) { st.stmtDepth--; return; }
          }
        }
      }

      if (!st.found) descend(node.expression as acorn.AnyNode, st);
      st.stmtDepth--;
    },

    AssignmentExpression(node: acorn.AssignmentExpression, st: SearchState) {
      if (st.found) return;
      // CommonJS chunk: `exports.modules = { ... }`
      const { left, right } = node;
      if (
        left.type === "MemberExpression" &&
        asMember(left).object.type === "Identifier" &&
        (asMember(left).object as acorn.Identifier).name === "exports" &&
        asMember(left).property.type === "Identifier" &&
        (asMember(left).property as acorn.Identifier).name === "modules" &&
        isObjectContainer(right)
      ) {
        st.found = buildModuleBoundsById(right);
      }
    },

    CallExpression(
      node: acorn.CallExpression,
      st: SearchState,
      descend: (n: acorn.AnyNode, s: SearchState) => void,
    ) {
      if (st.found) return;
      const { callee, arguments: args } = node;

      // Webpack 4 main chunk: `(function(modules) { ... })(container)`
      if (
        callee.type === "FunctionExpression" &&
        !asFn(callee).id &&
        args.length === 1 &&
        isModuleContainer(args[0])
      ) {
        st.found = buildModuleBoundsById(args[0] as acorn.Node);
        return;
      }

      // Legacy jsonp: `webpackJsonp([chunkIds], container, ...)`
      if (
        callee.type === "Identifier" &&
        args.length >= 2 &&
        args[0].type !== "SpreadElement" &&
        isChunkIdList(args[0]) &&
        args[1].type !== "SpreadElement" &&
        isModuleContainer(args[1])
      ) {
        st.found = buildModuleBoundsById(args[1] as acorn.Node);
        return;
      }

      // Webpack 4+ jsonp push: `(webpackChunk||[]).push([[id], container])`
      if (isJsonpPushCall(node)) {
        const payload = asArray(args[0]).elements;
        if (payload[1] != null) st.found = buildModuleBoundsById(payload[1] as acorn.Node);
        return;
      }

      // WebWorker chunk: `globalObj.callback([chunkIds], container)`
      if (isWebWorkerChunkCall(node)) {
        st.found = buildModuleBoundsById(args[1] as acorn.Node);
        return;
      }

      // Descend into args to unwrap UMD / DedupePlugin IIFEs
      for (const arg of args) descend(arg as acorn.AnyNode, st);
    },
  });

  return state.found;
}

/**
 * Parses a webpack bundle string and returns the exact post-Terser byte sizes
 * for every module found in its module container.
 *
 * Returns an empty Map when the source cannot be parsed or contains no
 * recognisable webpack module container (e.g. a runtime-only chunk).
 * Callers must fall back to proportional estimation for absent module IDs.
 *
 * Module IDs are returned as strings, matching context-builder's moduleMap keys.
 *
 * @param source  Bundle text from `compilation.assets[name].source()`
 * @param isESM   `true` when the asset is an ES-module output (`output.module: true`)
 */
export function parseSourceForModuleSizes(
  source: string,
  isESM: boolean,
): BundleModuleSizes {
  const sizes: BundleModuleSizes = new Map();

  let ast: acorn.Program;
  try {
    ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: isESM ? "module" : "script" });
  } catch {
    return sizes; // non-JS or unsupported syntax — Pass 1.5 handles proportionally
  }

  const boundsById = locateModuleBoundsById(ast);
  if (!boundsById) return sizes;

  for (const [id, bounds] of Object.entries(boundsById)) {
    const buf = Buffer.from(source.slice(bounds.start, bounds.end), "utf8");
    sizes.set(id, { parsed: buf.length, gzipped: gzipSync(buf).length });
  }

  return sizes;
}
