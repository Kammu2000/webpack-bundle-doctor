/**
 * AST pattern recognisers for webpack bundle formats.
 */

import * as acorn from "acorn";
import type { ModuleBoundsById } from "./types.js";

export const asLiteral  = (n: acorn.Node) => n as acorn.Literal;
export const asMember   = (n: acorn.Node) => n as acorn.MemberExpression;
export const asCall     = (n: acorn.Node) => n as acorn.CallExpression;
export const asArray    = (n: acorn.Node) => n as acorn.ArrayExpression;
export const asObject   = (n: acorn.Node) => n as acorn.ObjectExpression;
export const asFn       = (n: acorn.Node) => n as acorn.FunctionExpression;
export const asBlock    = (n: acorn.Node) => n as acorn.BlockStatement;

export function isNonNegativeInt(n: acorn.Node | null | undefined): boolean {
  if (n == null || n.type !== "Literal") return false;
  const v = asLiteral(n).value;
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** Non-negative integer or any string — covers both ID formats webpack uses. */
export function isModuleKey(n: acorn.Node | null | undefined): boolean {
  if (n == null || n.type !== "Literal") return false;
  const v = asLiteral(n).value;
  return (typeof v === "number" && Number.isInteger(v) && v >= 0) || typeof v === "string";
}

/** Module factory value: anonymous fn (normal), module-ID literal (DedupePlugin alias), or [id, ...] array. */
export function isModuleValue(n: acorn.Node | null | undefined): boolean {
  if (n == null) return false;
  if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression")
    return !(n as acorn.FunctionExpression).id;
  if (isModuleKey(n)) return true;
  if (n.type === "ArrayExpression") {
    const els = asArray(n).elements;
    return els.length > 1 && isModuleKey(els[0]);
  }
  return false;
}

/** `{ "./foo.js": fn, 42: fn, ... }` — object-keyed index. */
export function isObjectContainer(n: acorn.Node | null | undefined): boolean {
  if (n == null || n.type !== "ObjectExpression") return false;
  return asObject(n).properties
    .filter((p: acorn.SpreadElement | acorn.Property): p is acorn.Property => p.type === "Property")
    .map((p: acorn.Property): acorn.Expression => (p as acorn.Property).value)
    .every(isModuleValue);
}

/** `[fn, null, fn, ...]` — array-indexed, position = module ID. */
export function isArrayContainer(n: acorn.Node | null | undefined): boolean {
  if (n == null || n.type !== "ArrayExpression") return false;
  return asArray(n).elements.every((el): boolean => el == null || isModuleValue(el));
}

/** `Array(startId).concat([fn, ...])` — sparse array optimisation when module IDs don't start at 0. */
export function isConcatContainer(n: acorn.Node | null | undefined): boolean {
  if (n == null || n.type !== "CallExpression") return false;
  const call = asCall(n);
  if (call.callee.type !== "MemberExpression") return false;
  const member = asMember(call.callee);
  if (
    member.property.type !== "Identifier" ||
    (member.property as acorn.Identifier).name !== "concat" ||
    member.object.type !== "CallExpression"
  ) return false;
  const arrayCtor = asCall(member.object);
  if (
    arrayCtor.callee.type !== "Identifier" ||
    (arrayCtor.callee as acorn.Identifier).name !== "Array" ||
    arrayCtor.arguments.length !== 1 ||
    !isNonNegativeInt(arrayCtor.arguments[0] as acorn.Node)
  ) return false;
  return call.arguments.length === 1 && isArrayContainer(call.arguments[0] as acorn.Node);
}

export function isModuleContainer(n: acorn.Node | null | undefined): boolean {
  return isObjectContainer(n) || isArrayContainer(n) || isConcatContainer(n);
}

/** Array of chunk-ID literals — first argument of async chunk calls. */
export function isChunkIdList(n: acorn.Node): boolean {
  return n.type === "ArrayExpression" && asArray(n).elements.every(isModuleKey);
}

/** Webpack jsonp push: `(webpackChunk||[]).push([[chunkId], container])` */
export function isJsonpPushCall(n: acorn.CallExpression): boolean {
  const { callee, arguments: args } = n;
  if (
    callee.type !== "MemberExpression" ||
    (callee as acorn.MemberExpression).property.type !== "Identifier" ||
    ((callee as acorn.MemberExpression).property as acorn.Identifier).name !== "push" ||
    (callee as acorn.MemberExpression).object.type !== "AssignmentExpression" ||
    args.length !== 1 ||
    args[0].type !== "ArrayExpression"
  ) return false;
  const payload = asArray(args[0]).elements;
  return (
    payload.length >= 2 &&
    payload[0] != null && isChunkIdList(payload[0] as acorn.Node) &&
    isModuleContainer(payload[1])
  );
}

/** Webpack WebWorker chunk: `globalObj.callback([chunkIds], container)` */
export function isWebWorkerChunkCall(n: acorn.CallExpression): boolean {
  const { callee, arguments: args } = n;
  return (
    callee.type === "MemberExpression" &&
    args.length === 2 &&
    args[0].type !== "SpreadElement" &&
    isChunkIdList(args[0]) &&
    isModuleContainer(args[1])
  );
}

export function buildModuleBoundsById(node: acorn.Node): ModuleBoundsById {
  const out: ModuleBoundsById = {};

  if (node.type === "ObjectExpression") {
    for (const prop of asObject(node).properties) {
      if (prop.type !== "Property") continue;
      const p = prop as acorn.Property;
      const key =
        p.key.type === "Identifier"
          ? (p.key as acorn.Identifier).name
          : String(asLiteral(p.key).value);
      if (key === "undefined") continue;
      out[key] = { start: p.value.start, end: p.value.end };
    }
    return out;
  }

  let startId = 0;
  let elements: (acorn.Node | acorn.SpreadElement | null)[];

  if (node.type === "ArrayExpression") {
    elements = asArray(node).elements;
  } else {
    const concatCall = asCall(node);
    const arrayCtor = asCall(asMember(concatCall.callee).object);
    startId = asLiteral(arrayCtor.arguments[0] as acorn.Node).value as number;
    elements = asArray(concatCall.arguments[0] as acorn.Node).elements;
  }

  elements.forEach((el: acorn.Node | acorn.SpreadElement | null,   i: number): void => {
    if (el != null && el.type !== "SpreadElement") {
      out[i + startId] = { start: (el as acorn.Node).start, end: (el as acorn.Node).end };
    }
  });

  return out;
}

/** Webpack 5: extracts module container from the first var decl inside a no-arg IIFE body. */
export function tryExtractFromIIFEBody(
  callee: acorn.FunctionExpression | acorn.ArrowFunctionExpression,
): ModuleBoundsById | null {
  if (callee.params.length > 0 || callee.body.type !== "BlockStatement") return null;
  const firstVar = asBlock(callee.body).body.find(
    (s: acorn.Statement): s is acorn.VariableDeclaration => s.type === "VariableDeclaration",
  );
  if (!firstVar) return null;
  for (const decl of firstVar.declarations) {
    if (decl.init && isModuleContainer(decl.init)) return buildModuleBoundsById(decl.init);
  }
  return null;
}
