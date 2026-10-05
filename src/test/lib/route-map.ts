/**
 * Route map, library half. Pre-registration:
 *   docs/measurements/route-map-2026-10-04/route-map-prereg-2026-10-04.md
 *
 * Milestone 1: the Express family (express, koa-router, fastify, hapi, restify).
 * Deterministic, zero-model: a tree of source files in, a map of routes out.
 * Per route: the declaration, the composed path through mounts, the handler,
 * the guard chain (mount-level, router-level, route-level, in that order), the
 * calls followed from the handler through relative imports to MAX_DEPTH, and
 * the data-access symbols reached. Pure functions over `typescript`'s parser;
 * no type checker, no network, no process. Nothing under src/test ships.
 *
 * Two passes. Pass 1 parses every non-test source file into a ModuleSummary
 * (imports, exports, top-level declarations with their call sites, receivers,
 * route and use() calls) and drops the AST. Pass 2 links modules, composes
 * mounts, builds the chains. Every iteration is over sorted keys so the map
 * is a function of the tree's bytes alone (C4).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as ts from "typescript";

// ---------------------------------------------------------------------------
// Constants frozen by the pre-registration (sections 3 and 4).
// ---------------------------------------------------------------------------

export const MAP_VERSION = 1;
/** Section 3: calls are followed from the handler to this depth; the handler is depth 0. */
export const MAX_DEPTH = 3;
export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "all", "head", "options"] as const;
const METHOD_SET = new Set<string>(HTTP_METHODS);
/** A receiver by name, as route-def-pattern.ts accepts it, when its declaration is not seen. */
export const RECEIVER_NAME_RE = /^(router|app|api|server|fastify|express)$|(Router|App|Api)$/;
export const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
export const TEST_SEG_RE = /(^|\/)(test|tests|__tests__|spec|e2e|fixture|fixtures|example|examples|demo)(\/|$)/i;
export const TEST_NAME_RE = /\.(test|spec)\.[^/]+$/i;
export const SKIP_DIR_RE = /^(node_modules|dist|build|out|vendor|generated|coverage|\.next|\.git|\.turbo|\.cache|public|locales|i18n|__snapshots__)$/i;
export const nonTestSource = (p: string): boolean => SOURCE_EXT_RE.test(p) && !TEST_SEG_RE.test(p) && !TEST_NAME_RE.test(p);

/** Section 3, guard-name heuristic. Descriptive only, never gating. */
export const GUARD_AUTH_RE = /auth|authent|login|session|jwt|passport|bearer|token|requireUser|isLoggedIn|protected/i;
/** The pre-registration writes the role pattern case-sensitively; names such as requireRole and isAdmin carry the word capitalised, so the match is case-insensitive here, with can[A-Z] kept as written. Descriptive only. */
export const GUARD_ROLE_RE = /admin|role|permission|authori[sz]|policy|ability|rbac|scope|owner|member/i;
const GUARD_CAN_RE = /can[A-Z]/;
export function guardKind(name: string): GuardKind {
  if (GUARD_AUTH_RE.test(name)) return "auth";
  if (GUARD_ROLE_RE.test(name) || GUARD_CAN_RE.test(name)) return "role";
  return "other";
}

/** Section 3, data-access symbols. The root identifiers and the member sets, frozen. */
const DA_ROOTS = new Set(["prisma", "db", "knex", "sequelize", "mongoose", "typeorm", "drizzle", "kysely", "pool", "client", "conn", "connection", "dataSource", "datasource", "em", "entityManager", "sql"]);
const DA_RAW_MEMBERS = new Set(["query", "execute", "raw", "exec"]);
const DA_REPO_MEMBERS = new Set(["find", "findOne", "findOneBy", "findBy", "findAndCount", "findOneOrFail", "save", "update", "delete", "remove", "insert", "query", "createQueryBuilder", "count", "exists", "upsert", "softDelete", "restore", "increment", "decrement"]);
const DA_KYSELY_MEMBERS = new Set(["selectFrom", "insertInto", "updateTable", "deleteFrom", "replaceInto", "mergeInto"]);
const DA_DRIZZLE_MEMBERS = new Set(["select", "insert", "update", "delete", "execute"]);
const DA_MODEL_MEMBERS = new Set(["find", "findOne", "findById", "findOneAndUpdate", "findOneAndDelete", "findByIdAndUpdate", "findByIdAndDelete", "updateOne", "updateMany", "deleteOne", "deleteMany", "create", "insertMany", "aggregate", "countDocuments", "update", "remove", "insert", "upsert", "findAll", "findByPk", "findAndCountAll", "destroy", "bulkCreate"]);
const RECEIVER_FACTORY_RE = /^(express|Router|express\.Router|new Router|new KoaRouter|KoaRouter|fastify|Fastify|Hapi\.server|new Hapi\.Server|Hapi\.Server|restify\.createServer)$/;

// ---------------------------------------------------------------------------
// Map types (section 4). File paths are relative to the root, forward slashes.
// ---------------------------------------------------------------------------

export type GuardKind = "auth" | "role" | "other";
export type GuardLevel = "mount" | "router" | "route";
export type Framework = "express" | "fastify" | "hapi";
export interface Span { file: string; start: number; end: number }
export interface GuardNode { name: string; kind: GuardKind; level: GuardLevel; resolved: boolean; span: Span; hash: string }
export interface HandlerNode { name: string; resolved: boolean; span: Span; hash: string }
export interface CallNode { name: string; depth: number; span: Span; hash: string }
export interface DataAccessNode { symbol: string; depth: number; span: Span }
export interface RouteNode {
  framework: Framework;
  methods: string[];
  path: string;
  receiver: string;
  mountedThrough: string[];
  declaration: Span;
  handler: HandlerNode;
  guards: GuardNode[];
  calls: CallNode[];
  dataAccess: DataAccessNode[];
  unresolved: number;
  hash: string;
}
export interface RouteMapDigest {
  files: number;
  parsed: number;
  parseErrors: number;
  receivers: number;
  routes: number;
  routesNoGuard: number;
  routesNoDataAccess: number;
  unresolvedEdges: number;
}
export interface RouteMap { version: number; maxDepth: number; digest: RouteMapDigest; routes: RouteNode[] }

// ---------------------------------------------------------------------------
// Pass 1: module summaries.
// ---------------------------------------------------------------------------

/** A reference to an expression as it appears in a call argument or callee. */
interface ExprRef {
  text: string;
  /** Root identifier of an identifier or member chain (`a` of `a.b.c`), "this", or "". */
  root: string;
  /** Members after the root (`["b","c"]`). */
  chain: string[];
  kind: "ident" | "member" | "call" | "fn" | "array" | "string" | "object" | "other";
  line: number;
  endLine: number;
  /** For "call": the callee and the arguments. */
  callee?: ExprRef;
  args?: ExprRef[];
  /** For "fn": the inline function's declaration. For "array": the elements. For "object": properties by name. */
  fn?: Decl;
  items?: ExprRef[];
  props?: Map<string, ExprRef>;
}
interface CallSite { callee: ExprRef; args: ExprRef[]; line: number; endLine: number }
type DeclKind = "function" | "class" | "object" | "var" | "receiver" | "model";
interface Decl {
  name: string;
  kind: DeclKind;
  span: Span;
  hash: string;
  /** Call sites inside a function-like declaration (nested functions flattened). */
  calls: CallSite[];
  /** Class methods or object-literal function properties. */
  members: Map<string, Decl>;
  /** For a var: its initializer. */
  init?: ExprRef;
  /** For a receiver: the factory text. */
  factory?: string;
}
interface ImportBinding { spec: string; imported: string }
interface RouteDecl { framework: Framework; receiver: string; methods: string[]; path: string; line: number; endLine: number; guards: ExprRef[]; handler: ExprRef | null; hash: string }
interface UseDecl { receiver: string; prefix: string | null; args: ExprRef[]; line: number; endLine: number; hash: string }
interface ModuleSummary {
  file: string;
  parseError: boolean;
  imports: Map<string, ImportBinding>;
  /** export name -> local name or expression ref. "default" for the default export. */
  exports: Map<string, ExprRef>;
  decls: Map<string, Decl>;
  routes: RouteDecl[];
  uses: UseDecl[];
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}
function spanOf(sf: ts.SourceFile, file: string, node: ts.Node): Span {
  return { file, start: lineOf(sf, node.getStart(sf)), end: lineOf(sf, node.getEnd()) };
}
function hashOf(sf: ts.SourceFile, node: ts.Node): string {
  return sha256(node.getText(sf));
}
function stringValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return null;
  return null;
}
function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

/** Root identifier and member chain of an expression, through calls and non-null/parenthesised wrappers. */
function rootChain(e: ts.Expression): { root: string; chain: string[]; viaCall: boolean } {
  const chain: string[] = [];
  let cur: ts.Expression = e;
  let viaCall = false;
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) { chain.unshift(cur.name.text); cur = cur.expression; continue; }
    if (ts.isElementAccessExpression(cur)) { chain.unshift("[]"); cur = cur.expression; continue; }
    if (ts.isCallExpression(cur)) { viaCall = true; cur = cur.expression; continue; }
    if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isAwaitExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isNewExpression(cur)) { viaCall = true; cur = cur.expression; continue; }
    break;
  }
  if (ts.isIdentifier(cur)) return { root: cur.text, chain, viaCall };
  if (cur.kind === ts.SyntaxKind.ThisKeyword) return { root: "this", chain, viaCall };
  return { root: "", chain, viaCall };
}

function exprRef(sf: ts.SourceFile, file: string, node: ts.Expression): ExprRef {
  const line = lineOf(sf, node.getStart(sf)), endLine = lineOf(sf, node.getEnd());
  let n: ts.Expression = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n)) n = n.expression;
  const text = n.getText(sf);
  if (isFunctionLike(n)) {
    return { text: "<fn>", root: "", chain: [], kind: "fn", line, endLine, fn: declFromFunction(sf, file, "<inline>", n) };
  }
  if (ts.isArrayLiteralExpression(n)) {
    return { text, root: "", chain: [], kind: "array", line, endLine, items: n.elements.map((el) => exprRef(sf, file, el)) };
  }
  if (ts.isObjectLiteralExpression(n)) {
    const props = new Map<string, ExprRef>();
    for (const p of n.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) props.set(p.name.text, exprRef(sf, file, p.initializer));
      else if (ts.isShorthandPropertyAssignment(p)) props.set(p.name.text, { text: p.name.text, root: p.name.text, chain: [], kind: "ident", line, endLine });
      else if (ts.isMethodDeclaration(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) props.set(p.name.text, { text: "<fn>", root: "", chain: [], kind: "fn", line, endLine, fn: declFromFunction(sf, file, p.name.text, p) });
    }
    return { text, root: "", chain: [], kind: "object", line, endLine, props };
  }
  const sv = stringValue(n);
  if (sv !== null) return { text: sv, root: "", chain: [], kind: "string", line, endLine };
  if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
    const callee = exprRef(sf, file, n.expression);
    const args = (n.arguments ?? ts.factory.createNodeArray<ts.Expression>()).map((a) => exprRef(sf, file, a));
    const rc = rootChain(n.expression);
    return { text, root: rc.root, chain: rc.chain, kind: "call", line, endLine, callee, args };
  }
  if (ts.isIdentifier(n)) return { text, root: n.text, chain: [], kind: "ident", line, endLine };
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || n.kind === ts.SyntaxKind.ThisKeyword) {
    const rc = rootChain(n);
    return { text, root: rc.root, chain: rc.chain, kind: "member", line, endLine };
  }
  return { text, root: "", chain: [], kind: "other", line, endLine };
}

/** Every call site inside a node, nested functions included, in source order. */
function collectCalls(sf: ts.SourceFile, file: string, node: ts.Node, into: CallSite[]): void {
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      into.push({ callee: exprRef(sf, file, n.expression), args: (n.arguments ?? ts.factory.createNodeArray<ts.Expression>()).map((a) => exprRef(sf, file, a)), line: lineOf(sf, n.getStart(sf)), endLine: lineOf(sf, n.getEnd()) });
    }
    ts.forEachChild(n, visit);
  };
  // Visit the node itself too: an arrow function with an expression body IS the call.
  visit(node);
}

function declFromFunction(sf: ts.SourceFile, file: string, name: string, fn: ts.FunctionLikeDeclaration): Decl {
  const d: Decl = { name, kind: "function", span: spanOf(sf, file, fn), hash: hashOf(sf, fn), calls: [], members: new Map() };
  if (fn.body) collectCalls(sf, file, fn.body, d.calls);
  return d;
}
function declFromClass(sf: ts.SourceFile, file: string, name: string, c: ts.ClassLikeDeclaration): Decl {
  const d: Decl = { name, kind: "class", span: spanOf(sf, file, c), hash: hashOf(sf, c), calls: [], members: new Map() };
  for (const m of c.members) {
    if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m)) && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) d.members.set(m.name.text, declFromFunction(sf, file, m.name.text, m));
    else if (ts.isPropertyDeclaration(m) && m.initializer && isFunctionLike(m.initializer) && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) d.members.set(m.name.text, declFromFunction(sf, file, m.name.text, m.initializer));
  }
  return d;
}
function declFromObject(sf: ts.SourceFile, file: string, name: string, o: ts.ObjectLiteralExpression, whole: ts.Node): Decl {
  const d: Decl = { name, kind: "object", span: spanOf(sf, file, whole), hash: hashOf(sf, whole), calls: [], members: new Map() };
  for (const p of o.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
      if (isFunctionLike(p.initializer)) d.members.set(p.name.text, declFromFunction(sf, file, p.name.text, p.initializer));
      else d.members.set(p.name.text, { name: p.name.text, kind: "var", span: spanOf(sf, file, p), hash: hashOf(sf, p), calls: [], members: new Map(), init: exprRef(sf, file, p.initializer) });
    } else if (ts.isMethodDeclaration(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) d.members.set(p.name.text, declFromFunction(sf, file, p.name.text, p));
    else if (ts.isShorthandPropertyAssignment(p)) d.members.set(p.name.text, { name: p.name.text, kind: "var", span: spanOf(sf, file, p), hash: hashOf(sf, p), calls: [], members: new Map(), init: { text: p.name.text, root: p.name.text, chain: [], kind: "ident", line: lineOf(sf, p.getStart(sf)), endLine: lineOf(sf, p.getEnd()) } });
  }
  return d;
}

function receiverFactory(init: ts.Expression): string | null {
  let n: ts.Expression = init;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isAwaitExpression(n)) n = n.expression;
  if (!ts.isCallExpression(n) && !ts.isNewExpression(n)) return null;
  const callee = n.expression.getText();
  const text = (ts.isNewExpression(n) ? "new " : "") + callee;
  return RECEIVER_FACTORY_RE.test(text) ? text : null;
}
function modelFactory(init: ts.Expression): boolean {
  let n: ts.Expression = init;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isAwaitExpression(n)) n = n.expression;
  if (ts.isCallExpression(n)) { const t = n.expression.getText(); return /^(mongoose\.model|model|sequelize\.define|.*\.define|getRepository|.*\.getRepository|.*\.getCustomRepository)$/.test(t); }
  if (ts.isNewExpression(n)) { const t = n.expression.getText(); return /^(Mongo\.Collection|Collection|Repository|.*Repository)$/.test(t); }
  return false;
}

function declareVar(sf: ts.SourceFile, file: string, m: ModuleSummary, name: string, init: ts.Expression | undefined, whole: ts.Node): void {
  if (!init) { m.decls.set(name, { name, kind: "var", span: spanOf(sf, file, whole), hash: hashOf(sf, whole), calls: [], members: new Map() }); return; }
  const factory = receiverFactory(init);
  if (factory) { m.decls.set(name, { name, kind: "receiver", span: spanOf(sf, file, whole), hash: hashOf(sf, whole), calls: [], members: new Map(), factory }); return; }
  if (isFunctionLike(init)) { m.decls.set(name, declFromFunction(sf, file, name, init)); return; }
  if (ts.isClassExpression(init)) { m.decls.set(name, declFromClass(sf, file, name, init)); return; }
  if (ts.isObjectLiteralExpression(init)) { m.decls.set(name, declFromObject(sf, file, name, init, whole)); return; }
  if (modelFactory(init)) { m.decls.set(name, { name, kind: "model", span: spanOf(sf, file, whole), hash: hashOf(sf, whole), calls: [], members: new Map(), init: exprRef(sf, file, init) }); return; }
  m.decls.set(name, { name, kind: "var", span: spanOf(sf, file, whole), hash: hashOf(sf, whole), calls: [], members: new Map(), init: exprRef(sf, file, init) });
}

/** `require("x")` → "x", else null. */
function requireSpec(e: ts.Expression | undefined): string | null {
  if (!e) return null;
  let n: ts.Expression = e;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isAwaitExpression(n)) n = n.expression;
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require" && n.arguments.length === 1) return stringValue(n.arguments[0]!);
  return null;
}

/** A route call on a receiver: `R.get(path, ...)`, `R.route(path).get(...)`, chained `R.get(...).post(...)`. */
function routeCall(sf: ts.SourceFile, file: string, call: ts.CallExpression): RouteDecl | UseDecl | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const method = call.expression.name.text;
  let base: ts.Expression = call.expression.expression;
  let routePath: string | null = null;
  // Walk down chained calls to the receiver identifier, picking up `.route(path)`.
  for (;;) {
    if (ts.isCallExpression(base) && ts.isPropertyAccessExpression(base.expression)) {
      const inner = base.expression.name.text;
      if (inner === "route" && base.arguments.length >= 1) { const p = stringValue(base.arguments[0]!); if (p === null) return null; routePath = p; }
      else if (!METHOD_SET.has(inner) && inner !== "use") return null;
      base = base.expression.expression; continue;
    }
    if (ts.isParenthesizedExpression(base) || ts.isNonNullExpression(base) || ts.isAsExpression(base)) { base = base.expression; continue; }
    break;
  }
  const rc = rootChain(base);
  const receiver = rc.chain.length === 0 ? rc.root : rc.root + "." + rc.chain.join(".");
  if (!receiver || rc.root === "this" && rc.chain.length === 0) return null;
  const args = call.arguments;
  const line = lineOf(sf, call.getStart(sf)), endLine = lineOf(sf, call.getEnd()), hash = hashOf(sf, call);
  if (method === "use") {
    if (args.length === 0) return null;
    const first = stringValue(args[0]!);
    const rest = first !== null ? args.slice(1) : args.slice(0);
    return { receiver, prefix: first !== null ? first : null, args: rest.map((a) => exprRef(sf, file, a)), line, endLine, hash };
  }
  if (method === "route") {
    // Hapi object form: server.route({ method, path, handler, options })
    if (args.length === 1 && ts.isObjectLiteralExpression(args[0]!)) return hapiRoute(sf, file, receiver, args[0] as ts.ObjectLiteralExpression, call);
    if (args.length === 1 && ts.isArrayLiteralExpression(args[0]!)) return null;
    return null;
  }
  if (!METHOD_SET.has(method)) return null;
  let path = routePath;
  let i = 0;
  if (path === null) {
    if (args.length === 0) return null;
    const p = stringValue(args[0]!);
    if (p === null) {
      if (ts.isTemplateExpression(args[0]!) || ts.isBinaryExpression(args[0]!) || ts.isIdentifier(args[0]!) || ts.isPropertyAccessExpression(args[0]!)) { path = "<dynamic>"; i = 1; }
      else return null;
    } else { path = p; i = 1; }
  }
  const rest = args.slice(i).map((a) => exprRef(sf, file, a));
  if (rest.length === 0) return null;
  // Fastify: an options object before the handler carries preHandler/onRequest/preValidation guards.
  const guards: ExprRef[] = [];
  let framework: Framework = "express";
  for (const r of rest.slice(0, -1)) {
    if (r.kind === "object" && r.props) {
      framework = "fastify";
      for (const k of ["onRequest", "preParsing", "preValidation", "preHandler"]) { const g = r.props.get(k); if (g) guards.push(g); }
    } else guards.push(r);
  }
  const last = rest[rest.length - 1]!;
  let handler: ExprRef | null = last;
  if (last.kind === "object" && last.props) { framework = "fastify"; handler = last.props.get("handler") ?? null; for (const k of ["onRequest", "preParsing", "preValidation", "preHandler"]) { const g = last.props.get(k); if (g) guards.push(g); } }
  return { framework, receiver, methods: [method], path, line, endLine, guards, handler, hash };
}
function hapiRoute(sf: ts.SourceFile, file: string, receiver: string, o: ts.ObjectLiteralExpression, whole: ts.CallExpression): RouteDecl | null {
  const ref = exprRef(sf, file, o);
  const props = ref.props!;
  const m = props.get("method"), p = props.get("path");
  if (!m || !p || p.kind !== "string") return null;
  const methods = m.kind === "string" ? [m.text.toLowerCase()] : m.kind === "array" && m.items ? m.items.filter((x) => x.kind === "string").map((x) => x.text.toLowerCase()) : ["<dynamic>"];
  const guards: ExprRef[] = [];
  const opts = props.get("options") ?? props.get("config");
  if (opts && opts.kind === "object" && opts.props) {
    const pre = opts.props.get("pre"); if (pre && pre.kind === "array" && pre.items) guards.push(...pre.items);
    const auth = opts.props.get("auth"); if (auth) guards.push({ ...auth, text: "auth:" + auth.text, kind: "other" });
  }
  let handler = props.get("handler") ?? null;
  if (!handler && opts && opts.kind === "object" && opts.props) handler = opts.props.get("handler") ?? null;
  return { framework: "hapi", receiver, methods, path: p.text, line: lineOf(sf, whole.getStart(sf)), endLine: lineOf(sf, whole.getEnd()), guards, handler, hash: hashOf(sf, whole) };
}

export function summarizeModule(file: string, text: string): ModuleSummary {
  const m: ModuleSummary = { file, parseError: false, imports: new Map(), exports: new Map(), decls: new Map(), routes: [], uses: [] };
  const kind = /\.(tsx|jsx)$/i.test(file) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  if ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length) m.parseError = true;
  const refOf = (e: ts.Expression): ExprRef => exprRef(sf, file, e);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      const c = st.importClause;
      if (c?.name) m.imports.set(c.name.text, { spec, imported: "default" });
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) m.imports.set(c.namedBindings.name.text, { spec, imported: "*" });
        else for (const el of c.namedBindings.elements) m.imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
      }
      continue;
    }
    if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference) && ts.isStringLiteral(st.moduleReference.expression)) {
      m.imports.set(st.name.text, { spec: st.moduleReference.expression.text, imported: "*" }); continue;
    }
    if (ts.isExportDeclaration(st)) {
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          const local = (el.propertyName ?? el.name).text;
          if (spec) { const alias = `__reexport_${el.name.text}`; m.imports.set(alias, { spec, imported: local }); m.exports.set(el.name.text, { text: alias, root: alias, chain: [], kind: "ident", line: lineOf(sf, st.getStart(sf)), endLine: lineOf(sf, st.getEnd()) }); }
          else m.exports.set(el.name.text, { text: local, root: local, chain: [], kind: "ident", line: lineOf(sf, st.getStart(sf)), endLine: lineOf(sf, st.getEnd()) });
        }
      } else if (spec && !st.exportClause) {
        // export * from "./x": recorded as a star re-export under a reserved name.
        const alias = `__star_${m.exports.size}`; m.imports.set(alias, { spec, imported: "*" }); m.exports.set(alias, { text: alias, root: alias, chain: [], kind: "ident", line: lineOf(sf, st.getStart(sf)), endLine: lineOf(sf, st.getEnd()) });
      }
      continue;
    }
    if (ts.isExportAssignment(st)) { m.exports.set("default", refOf(st.expression)); if (ts.isObjectLiteralExpression(st.expression)) m.decls.set("__default", declFromObject(sf, file, "__default", st.expression, st)); if (ts.isClassExpression(st.expression)) m.decls.set("__default", declFromClass(sf, file, "__default", st.expression)); if (isFunctionLike(st.expression)) m.decls.set("__default", declFromFunction(sf, file, "__default", st.expression)); continue; }
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : [];
    const isExport = mods.some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods.some((x) => x.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(st)) {
      const name = st.name?.text ?? "__default";
      m.decls.set(name, declFromFunction(sf, file, name, st));
      if (isExport) m.exports.set(isDefault ? "default" : name, { text: name, root: name, chain: [], kind: "ident", line: lineOf(sf, st.getStart(sf)), endLine: lineOf(sf, st.getEnd()) });
      continue;
    }
    if (ts.isClassDeclaration(st)) {
      const name = st.name?.text ?? "__default";
      m.decls.set(name, declFromClass(sf, file, name, st));
      if (isExport) m.exports.set(isDefault ? "default" : name, { text: name, root: name, chain: [], kind: "ident", line: lineOf(sf, st.getStart(sf)), endLine: lineOf(sf, st.getEnd()) });
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          const rs = requireSpec(d.initializer);
          if (rs) { m.imports.set(d.name.text, { spec: rs, imported: "*" }); continue; }
          // const { a, b } = require("x") is handled below; const x = require("x").y:
          if (d.initializer && ts.isPropertyAccessExpression(d.initializer)) { const rs2 = requireSpec(d.initializer.expression); if (rs2) { m.imports.set(d.name.text, { spec: rs2, imported: d.initializer.name.text }); continue; } }
          declareVar(sf, file, m, d.name.text, d.initializer, d);
          if (isExport) m.exports.set(d.name.text, { text: d.name.text, root: d.name.text, chain: [], kind: "ident", line: lineOf(sf, d.getStart(sf)), endLine: lineOf(sf, d.getEnd()) });
        } else if (ts.isObjectBindingPattern(d.name)) {
          const rs = requireSpec(d.initializer);
          for (const el of d.name.elements) {
            if (!ts.isIdentifier(el.name)) continue;
            const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
            if (rs) m.imports.set(el.name.text, { spec: rs, imported });
            else if (d.initializer) m.decls.set(el.name.text, { name: el.name.text, kind: "var", span: spanOf(sf, file, d), hash: hashOf(sf, d), calls: [], members: new Map(), init: { ...refOf(d.initializer), chain: [...rootChain(d.initializer).chain, imported], kind: "member" } });
            if (isExport) m.exports.set(el.name.text, { text: el.name.text, root: el.name.text, chain: [], kind: "ident", line: lineOf(sf, d.getStart(sf)), endLine: lineOf(sf, d.getEnd()) });
          }
        }
      }
      continue;
    }
    if (ts.isExpressionStatement(st)) {
      const e = st.expression;
      // module.exports = X / module.exports.x = X / exports.x = X
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const lhs = e.left.getText(sf);
        if (lhs === "module.exports") {
          m.exports.set("default", refOf(e.right));
          if (ts.isObjectLiteralExpression(e.right)) { m.decls.set("__default", declFromObject(sf, file, "__default", e.right, st)); for (const p of e.right.properties) { if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)) && ts.isIdentifier(p.name)) m.exports.set(p.name.text, { text: "__default", root: "__default", chain: [p.name.text], kind: "member", line: lineOf(sf, p.getStart(sf)), endLine: lineOf(sf, p.getEnd()) }); } }
          else if (isFunctionLike(e.right)) m.decls.set("__default", declFromFunction(sf, file, "__default", e.right));
          else if (ts.isClassExpression(e.right)) m.decls.set("__default", declFromClass(sf, file, "__default", e.right));
          continue;
        }
        const mm = lhs.match(/^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/);
        if (mm) {
          const name = mm[1]!;
          if (isFunctionLike(e.right) || ts.isClassExpression(e.right) || ts.isObjectLiteralExpression(e.right)) { declareVar(sf, file, m, `__exports_${name}`, e.right, st); m.exports.set(name, { text: `__exports_${name}`, root: `__exports_${name}`, chain: [], kind: "ident", line: lineOf(sf, st.getStart(sf)), endLine: lineOf(sf, st.getEnd()) }); }
          else m.exports.set(name, refOf(e.right));
          continue;
        }
        // X.prototype.y = function / Class.method = ... : recorded as members when X is a local class/function.
        const pm = lhs.match(/^([A-Za-z_$][\w$]*)(?:\.prototype)?\.([A-Za-z_$][\w$]*)$/);
        if (pm && isFunctionLike(e.right)) { const owner = m.decls.get(pm[1]!); if (owner) owner.members.set(pm[2]!, declFromFunction(sf, file, pm[2]!, e.right)); continue; }
      }
    }
  }
  // Route and use() calls anywhere in the file (top level, inside functions such as `export function registerRoutes(app)`, inside IIFEs).
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const r = routeCall(sf, file, n);
      if (r) { if ("methods" in r) m.routes.push(r); else m.uses.push(r); }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return m;
}

// ---------------------------------------------------------------------------
// Tree walking and module resolution.
// ---------------------------------------------------------------------------

/** Non-test source files under root, relative with forward slashes, sorted by code unit. */
export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = rel ? join(root, rel) : root;
    let names: string[];
    try { names = readdirSync(abs); } catch { return; }
    names.sort();
    for (const name of names) {
      if (SKIP_DIR_RE.test(name)) continue;
      const r = rel ? `${rel}/${name}` : name;
      let st; try { st = statSync(join(root, r)); } catch { continue; }
      if (st.isDirectory()) walk(r);
      else if (st.isFile() && nonTestSource(r)) out.push(r);
    }
  };
  walk("");
  return out.sort();
}

const RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
function normalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) { if (seg === "" || seg === ".") continue; if (seg === "..") parts.pop(); else parts.push(seg); }
  return parts.join("/");
}
/** Resolve a relative import specifier from `fromFile` to a file in the index; null for packages and misses. */
export function resolveSpec(fromFile: string, spec: string, files: Set<string>, aliases: Array<[string, string]>): string | null {
  let base: string;
  if (spec.startsWith(".")) {
    const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
    base = normalize(dir ? `${dir}/${spec}` : spec);
  } else {
    const hit = aliases.find(([prefix]) => spec === prefix || spec.startsWith(prefix + "/"));
    if (!hit) return null;
    base = normalize(hit[1] + spec.slice(hit[0].length));
  }
  const stripped = base.replace(/\.(js|mjs|cjs|jsx)$/, "");
  const candidates = [base, ...RESOLVE_EXTS.map((e) => stripped + e), ...RESOLVE_EXTS.map((e) => `${base}/index${e}`)];
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}
/** `paths` aliases from a root tsconfig: `{"@/*": ["./src/*"]}` → [["@", "src"]]. Best effort, never throws. */
export function readAliases(root: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const f of ["tsconfig.json", "jsconfig.json", "tsconfig.base.json"]) {
    let text: string;
    try { text = readFileSync(join(root, f), "utf8"); } catch { continue; }
    try {
      const json = JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1")) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const baseUrl = normalize(json.compilerOptions?.baseUrl ?? ".");
      for (const [k, v] of Object.entries(json.compilerOptions?.paths ?? {})) {
        const target = v[0]; if (!target) continue;
        const prefix = k.replace(/\/?\*$/, ""); const to = normalize((baseUrl === "" ? "" : baseUrl + "/") + target.replace(/\/?\*$/, ""));
        if (prefix) out.push([prefix, to]);
      }
    } catch { /* unreadable config: no aliases */ }
  }
  return out.sort((a, b) => b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Pass 2: linking, chains, the map.
// ---------------------------------------------------------------------------

interface Resolved { file: string; decl: Decl }
interface Index { modules: Map<string, ModuleSummary>; files: Set<string>; aliases: Array<[string, string]> }

/** Follow a name in a module to its declaration, through re-exports and imports. */
function resolveName(ix: Index, file: string, name: string, seen = new Set<string>()): Resolved | null {
  const key = `${file}#${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const m = ix.modules.get(file);
  if (!m) return null;
  const local = m.decls.get(name);
  if (local) {
    if (local.kind === "var" && local.init && local.init.kind === "ident" && local.init.root !== name) return resolveName(ix, file, local.init.root, seen) ?? { file, decl: local };
    if (local.kind === "var" && local.init && local.init.kind === "member" && local.init.root) { const r = resolveMember(ix, file, local.init.root, local.init.chain, seen); if (r) return r; }
    return { file, decl: local };
  }
  const imp = m.imports.get(name);
  if (imp) {
    const target = resolveSpec(file, imp.spec, ix.files, ix.aliases);
    if (!target) return null;
    if (imp.imported === "*") { const tm = ix.modules.get(target); if (!tm) return null; const d = tm.decls.get("__default"); return d ? { file: target, decl: d } : { file: target, decl: { name: "*", kind: "object", span: { file: target, start: 1, end: 1 }, hash: "", calls: [], members: new Map() } }; }
    return resolveExport(ix, target, imp.imported, seen);
  }
  return null;
}
function resolveExport(ix: Index, file: string, exported: string, seen: Set<string>): Resolved | null {
  const m = ix.modules.get(file);
  if (!m) return null;
  const ref = m.exports.get(exported);
  if (ref) {
    if (ref.kind === "ident") return resolveName(ix, file, ref.root, seen);
    if (ref.kind === "member" && ref.root) return resolveMember(ix, file, ref.root, ref.chain, seen);
    return null;
  }
  // Star re-exports.
  for (const [k, v] of [...m.exports.entries()].sort()) {
    if (k.startsWith("__star_")) { const imp = m.imports.get(v.root); if (!imp) continue; const target = resolveSpec(file, imp.spec, ix.files, ix.aliases); if (!target) continue; const r = resolveExport(ix, target, exported, seen); if (r) return r; }
  }
  // CommonJS default object: module.exports = { a, b } exposes members; `exports.a` handled above.
  if (exported !== "default") { const d = m.decls.get("__default"); if (d && d.members.has(exported)) return { file, decl: d.members.get(exported)! }; }
  return null;
}
/** Resolve `root.a.b` to a declaration: a member of an object/class/namespace, or a namespace import's export. */
function resolveMember(ix: Index, file: string, root: string, chain: string[], seen = new Set<string>()): Resolved | null {
  const m = ix.modules.get(file);
  if (!m) return null;
  let cur: Resolved | null;
  const imp = m.imports.get(root);
  if (imp && imp.imported === "*" && chain.length > 0) {
    const target = resolveSpec(file, imp.spec, ix.files, ix.aliases);
    if (!target) return null;
    cur = resolveExport(ix, target, chain[0]!, seen);
    if (!cur) return null;
    return chain.length === 1 ? cur : descend(ix, cur, chain.slice(1), seen);
  }
  cur = resolveName(ix, file, root, seen);
  if (!cur) return null;
  return chain.length === 0 ? cur : descend(ix, cur, chain, seen);
}
function descend(ix: Index, from: Resolved, chain: string[], seen: Set<string>): Resolved | null {
  let cur: Resolved | null = from;
  for (const part of chain) {
    if (!cur) return null;
    const d: Decl = cur.decl;
    const member = d.members.get(part);
    if (member) { cur = { file: cur.file, decl: member }; continue; }
    // A var holding `new Class()` or an identifier: step through.
    if (d.kind === "var" && d.init) {
      if (d.init.kind === "call" && d.init.callee && d.init.text.startsWith("new ")) { const cls = resolveMember(ix, cur.file, d.init.root, d.init.chain, seen); if (cls && cls.decl.members.has(part)) { cur = { file: cls.file, decl: cls.decl.members.get(part)! }; continue; } }
      if (d.init.kind === "ident") { const r = resolveName(ix, cur.file, d.init.root, seen); if (r && r.decl.members.has(part)) { cur = { file: r.file, decl: r.decl.members.get(part)! }; continue; } }
    }
    if (d.name === "*") { const r = resolveExport(ix, cur.file, part, seen); if (r) { cur = r; continue; } }
    return null;
  }
  return cur;
}
function resolveRef(ix: Index, file: string, ref: ExprRef): Resolved | null {
  if (ref.kind === "ident") return resolveName(ix, file, ref.root);
  if (ref.kind === "member" && ref.root && ref.root !== "this") return resolveMember(ix, file, ref.root, ref.chain);
  if (ref.kind === "call" && ref.callee) {
    // Wrappers: asyncHandler(fn), wrap(ctrl.x), catchAsync(...): the first function-valued argument is the handler.
    for (const a of ref.args ?? []) { if (a.kind === "fn" && a.fn) return { file, decl: a.fn }; const r = resolveRef(ix, file, a); if (r && (r.decl.kind === "function")) return r; }
    // A factory call `requireRole("admin")` names the factory.
    return resolveRef(ix, file, ref.callee);
  }
  if (ref.kind === "fn" && ref.fn) return { file, decl: ref.fn };
  return null;
}
function refName(ref: ExprRef): string {
  if (ref.kind === "fn") return "<inline>";
  if (ref.kind === "call" && ref.callee) return refName(ref.callee);
  if (ref.kind === "ident" || ref.kind === "member") return ref.root + (ref.chain.length ? "." + ref.chain.join(".") : "");
  return ref.text.length > 60 ? ref.text.slice(0, 60) : ref.text;
}

function dataAccessSymbol(ix: Index, file: string, c: CallSite): string | null {
  const cal = c.callee;
  const chain = cal.chain;
  const root = cal.root;
  if (!root || root === "this" && chain.length === 0) return null;
  const last = chain[chain.length - 1];
  const sym = root + (chain.length ? "." + chain.join(".") : "");
  if (DA_ROOTS.has(root) && chain.length >= 1) {
    if (root === "sequelize" && last && !DA_RAW_MEMBERS.has(last) && !DA_MODEL_MEMBERS.has(last)) return null;
    if ((root === "pool" || root === "client" || root === "conn" || root === "connection" || root === "sql") && !(last && DA_RAW_MEMBERS.has(last))) return null;
    if (root === "db" && chain.length === 1 && last && !(DA_DRIZZLE_MEMBERS.has(last) || DA_KYSELY_MEMBERS.has(last) || DA_RAW_MEMBERS.has(last) || DA_MODEL_MEMBERS.has(last) || DA_REPO_MEMBERS.has(last))) return null;
    return sym;
  }
  if (last && DA_KYSELY_MEMBERS.has(last)) return sym;
  if (last && DA_REPO_MEMBERS.has(last) && /(Repository|Repo|repository|repo)$/.test(chain.length > 1 ? chain[chain.length - 2]! : root)) return sym;
  if (last && (DA_MODEL_MEMBERS.has(last) || DA_REPO_MEMBERS.has(last))) {
    // A model/collection: the root (or the member before the last) resolves to a `model` declaration.
    const r = chain.length > 1 ? resolveMember(ix, file, root, chain.slice(0, -1)) : resolveName(ix, file, root);
    if (r && r.decl.kind === "model") return sym;
  }
  if (cal.kind === "call" && cal.callee && /^(getRepository|knex|sql|db)$/.test(cal.callee.root)) return sym;
  return null;
}

interface ChainBuild { calls: CallNode[]; dataAccess: DataAccessNode[]; unresolved: number }
function followCalls(ix: Index, start: Resolved, depth: number, visited: Set<string>, acc: ChainBuild): void {
  const key = `${start.file}#${start.decl.span.start}#${start.decl.name}`;
  if (visited.has(key)) return;
  visited.add(key);
  for (const c of start.decl.calls) {
    const sym = dataAccessSymbol(ix, start.file, c);
    if (sym) acc.dataAccess.push({ symbol: sym, depth, span: { file: start.file, start: c.line, end: c.endLine } });
    if (depth >= MAX_DEPTH) continue;
    const cal = c.callee;
    if (cal.kind !== "ident" && cal.kind !== "member") continue;
    if (cal.root === "this") { if (cal.chain.length) acc.unresolved++; continue; }
    const r = resolveRef(ix, start.file, cal);
    if (!r) { const m = ix.modules.get(start.file); if (m && m.imports.has(cal.root)) acc.unresolved++; continue; }
    if (r.decl.kind !== "function") { if (r.decl.kind === "class" || r.decl.kind === "object") acc.unresolved++; continue; }
    acc.calls.push({ name: refName(cal), depth: depth + 1, span: r.decl.span, hash: r.decl.hash });
    followCalls(ix, r, depth + 1, visited, acc);
  }
}

interface ReceiverNode { file: string; name: string; key: string }
interface Mount { parent: ReceiverNode; child: ReceiverNode; prefix: string; guards: ExprRef[]; line: number; file: string }

function receiverKey(ix: Index, file: string, name: string): string {
  const r = name.includes(".") ? null : resolveName(ix, file, name);
  if (r && r.decl.kind === "receiver") return `${r.file}#${r.decl.name}`;
  if (r && r.decl.kind === "var" && r.decl.init && r.decl.init.kind === "call" && RECEIVER_FACTORY_RE.test(r.decl.init.callee?.text ?? "")) return `${r.file}#${r.decl.name}`;
  return `${file}#${name}`;
}

function guardNode(ix: Index, file: string, ref: ExprRef, level: GuardLevel): GuardNode | null {
  if (ref.kind === "string" || ref.kind === "other") return null;
  const name = refName(ref);
  if (ref.kind === "fn" && ref.fn) return { name, kind: guardKind(name), level, resolved: true, span: ref.fn.span, hash: ref.fn.hash };
  const r = resolveRef(ix, file, ref);
  if (r && (r.decl.kind === "function" || r.decl.kind === "var" || r.decl.kind === "object" || r.decl.kind === "class")) return { name, kind: guardKind(name), level, resolved: r.decl.kind === "function", span: r.decl.span, hash: r.decl.hash };
  return { name, kind: guardKind(name), level, resolved: false, span: { file, start: ref.line, end: ref.endLine }, hash: sha256(ref.text) };
}
function flatten(refs: ExprRef[]): ExprRef[] {
  const out: ExprRef[] = [];
  for (const r of refs) { if (r.kind === "array" && r.items) out.push(...flatten(r.items)); else out.push(r); }
  return out;
}
function joinPath(prefix: string, path: string): string {
  if (path === "<dynamic>" || prefix === "<dynamic>") return "<dynamic>";
  const p = (prefix.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "")).replace(/\/+/g, "/");
  return p === "" ? "/" : p.length > 1 ? p.replace(/\/$/, "") : p;
}
function prefixCovers(prefix: string, path: string): boolean {
  if (prefix === "/" || prefix === "") return true;
  if (path === "<dynamic>") return true;
  const p = prefix.replace(/\/+$/, "");
  return path === p || path.startsWith(p + "/");
}

export function buildRouteMap(root: string): RouteMap {
  const files = listSourceFiles(root);
  const ix: Index = { modules: new Map(), files: new Set(files), aliases: readAliases(root) };
  let parseErrors = 0;
  for (const f of files) {
    let text: string;
    try { text = readFileSync(join(root, f), "utf8"); } catch { continue; }
    if (text.length > 2_000_000) continue;
    const m = summarizeModule(f, text);
    if (m.parseError) parseErrors++;
    ix.modules.set(f, m);
  }
  // Receivers: declared ones, plus names that look like receivers where routes are declared on them.
  const receivers = new Map<string, ReceiverNode>();
  const addReceiver = (file: string, name: string): ReceiverNode => {
    const key = receiverKey(ix, file, name);
    let r = receivers.get(key);
    if (!r) { r = { file: key.split("#")[0]!, name: key.split("#")[1]!, key }; receivers.set(key, r); }
    return r;
  };
  const mounts: Mount[] = [];
  const routerUses = new Map<string, UseDecl[]>(); // receiver key -> pathless/prefixed middleware uses, in order
  for (const f of files) {
    const m = ix.modules.get(f); if (!m) continue;
    for (const r of m.routes) addReceiver(f, r.receiver);
    for (const u of m.uses) {
      const parent = addReceiver(f, u.receiver);
      const refs = flatten(u.args);
      // A use() whose argument resolves to a receiver is a mount; anything else is middleware.
      const mws: ExprRef[] = [];
      for (const ref of refs) {
        let child: ReceiverNode | null = null;
        if (ref.kind === "ident" || ref.kind === "member") {
          const res = ref.kind === "ident" ? resolveName(ix, f, ref.root) : resolveMember(ix, f, ref.root, ref.chain);
          if (res && res.decl.kind === "receiver") child = addReceiver(res.file, res.decl.name);
          else if (res && res.decl.kind === "var" && res.decl.init && res.decl.init.kind === "call" && RECEIVER_FACTORY_RE.test(res.decl.init.callee?.text ?? "")) child = addReceiver(res.file, res.decl.name);
          else if (!res && ref.kind === "ident" && RECEIVER_NAME_RE.test(ref.root) && !m.imports.has(ref.root) && !m.decls.has(ref.root)) child = null;
        } else if (ref.kind === "call" && ref.callee && /Router$|^router$|Routes$|^routes$/i.test(refName(ref.callee)) && !RECEIVER_FACTORY_RE.test(ref.callee.text)) {
          // A factory call that returns a router (`createUserRouter(deps)`): its module's routes are declared on a local receiver we cannot link; recorded as a mount of nothing.
          child = null;
        }
        if (child) mounts.push({ parent, child, prefix: u.prefix ?? "", guards: [...mws], line: u.line, file: f });
        else mws.push(ref);
      }
      if (mws.length && !mounts.some((mt) => mt.file === f && mt.line === u.line)) {
        const arr = routerUses.get(parent.key) ?? []; arr.push({ ...u, args: mws }); routerUses.set(parent.key, arr);
      } else if (mws.length) {
        // Middleware before a router in the same use(): already attached to that mount as guards; leftover after the router applies to nothing.
      }
    }
  }
  // Mount chains: for each receiver, the list of (ancestor chain) paths. A receiver mounted twice yields a route per mount.
  const mountsByChild = new Map<string, Mount[]>();
  for (const mt of mounts) { const arr = mountsByChild.get(mt.child.key) ?? []; arr.push(mt); mountsByChild.set(mt.child.key, arr); }
  interface Chain { prefix: string; guards: GuardNode[]; through: string[] }
  const chainsFor = (key: string, seen: Set<string>): Chain[] => {
    const ms = (mountsByChild.get(key) ?? []).slice().sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    if (ms.length === 0 || seen.has(key)) return [{ prefix: "", guards: [], through: [] }];
    const out: Chain[] = [];
    for (const mt of ms) {
      const parentUses = (routerUses.get(mt.parent.key) ?? []).filter((u) => u.line < mt.line || u.receiver !== mt.parent.name).filter((u) => u.prefix === null || prefixCovers(u.prefix, mt.prefix));
      const parentGuards: GuardNode[] = [];
      for (const u of parentUses) for (const ref of u.args) { const g = guardNode(ix, mt.file, ref, "mount"); if (g) parentGuards.push(g); }
      for (const ref of mt.guards) { const g = guardNode(ix, mt.file, ref, "mount"); if (g) parentGuards.push(g); }
      for (const up of chainsFor(mt.parent.key, new Set([...seen, key]))) {
        out.push({ prefix: joinPath(up.prefix, mt.prefix), guards: [...up.guards, ...parentGuards], through: [...up.through, `${mt.parent.file}#${mt.parent.name}`] });
      }
    }
    return out;
  };
  const routes: RouteNode[] = [];
  let unresolvedEdges = 0;
  for (const f of files) {
    const m = ix.modules.get(f); if (!m) continue;
    for (const rd of m.routes) {
      const recv = addReceiver(f, rd.receiver);
      const chains = chainsFor(recv.key, new Set());
      const ownUses = (routerUses.get(recv.key) ?? []).filter((u) => u.line < rd.line && (u.prefix === null || prefixCovers(u.prefix, rd.path)));
      const routerGuards: GuardNode[] = [];
      for (const u of ownUses) for (const ref of u.args) { const g = guardNode(ix, f, ref, "router"); if (g) routerGuards.push(g); }
      const routeGuards: GuardNode[] = [];
      for (const ref of flatten(rd.guards)) { const g = guardNode(ix, f, ref, "route"); if (g) routeGuards.push(g); }
      let handler: HandlerNode;
      let hres: Resolved | null = null;
      if (rd.handler) {
        hres = resolveRef(ix, f, rd.handler);
        if (hres && hres.decl.kind === "function") handler = { name: refName(rd.handler), resolved: true, span: hres.decl.span, hash: hres.decl.hash };
        else { handler = { name: refName(rd.handler), resolved: false, span: { file: f, start: rd.handler.line, end: rd.handler.endLine }, hash: sha256(rd.handler.text) }; if (hres === null) unresolvedEdges++; hres = null; }
      } else handler = { name: "<none>", resolved: false, span: { file: f, start: rd.line, end: rd.endLine }, hash: rd.hash };
      const build: ChainBuild = { calls: [], dataAccess: [], unresolved: 0 };
      if (hres) followCalls(ix, hres, 0, new Set(), build);
      // Guards that are functions are followed one level for data access too (an ownership check may query).
      for (const g of [...routeGuards, ...routerGuards]) {
        if (!g.resolved) continue;
        const gm = ix.modules.get(g.span.file); if (!gm) continue;
        const gd = [...gm.decls.values()].find((d) => d.span.start === g.span.start && d.kind === "function");
        if (gd) for (const c of gd.calls) { const sym = dataAccessSymbol(ix, g.span.file, c); if (sym) build.dataAccess.push({ symbol: sym, depth: 0, span: { file: g.span.file, start: c.line, end: c.endLine } }); }
      }
      unresolvedEdges += build.unresolved;
      for (const ch of chains) {
        const path = joinPath(ch.prefix, rd.path);
        const guards = [...ch.guards, ...routerGuards, ...routeGuards];
        const node: RouteNode = {
          framework: rd.framework, methods: rd.methods.slice().sort(), path, receiver: rd.receiver, mountedThrough: ch.through,
          declaration: { file: f, start: rd.line, end: rd.endLine }, handler, guards, calls: build.calls.slice(), dataAccess: build.dataAccess.slice(), unresolved: build.unresolved,
          hash: sha256(rd.hash + "|" + handler.hash + "|" + guards.map((g) => g.hash).join(",")),
        };
        routes.push(node);
      }
    }
  }
  routes.sort((a, b) => (a.declaration.file < b.declaration.file ? -1 : a.declaration.file > b.declaration.file ? 1 : a.declaration.start - b.declaration.start || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.methods.join() < b.methods.join() ? -1 : 1)));
  const digest: RouteMapDigest = {
    files: files.length, parsed: ix.modules.size, parseErrors, receivers: receivers.size, routes: routes.length,
    routesNoGuard: routes.filter((r) => r.guards.length === 0).length, routesNoDataAccess: routes.filter((r) => r.dataAccess.length === 0).length, unresolvedEdges,
  };
  return { version: MAP_VERSION, maxDepth: MAX_DEPTH, digest, routes };
}

/** Canonical JSON: key order as constructed, LF, trailing newline. */
export function serializeMap(map: RouteMap): string {
  return JSON.stringify(map, null, 1) + "\n";
}

// ---------------------------------------------------------------------------
// Scoring helpers (section 4): C1 and C2 against defect windows and hunks.
// ---------------------------------------------------------------------------

export interface Hunk { file: string; oldStart: number; oldCount: number }
/** Parse a `git diff -U0 parent fix` into parent-side hunks per file (renames use the parent-side path). */
export function parseUnifiedDiff(text: string): Hunk[] {
  const out: Hunk[] = [];
  let file: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("--- ")) { const p = line.slice(4).trim(); file = p === "/dev/null" ? null : p.replace(/^a\//, ""); continue; }
    if (line.startsWith("+++ ")) continue;
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
    if (m && file) out.push({ file, oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]) });
  }
  return out;
}
/** Parent-side range of a hunk: the removed lines, or the insertion point and the line after it for a pure insertion. */
export function hunkRange(h: Hunk): [number, number] {
  if (h.oldCount > 0) return [h.oldStart, h.oldStart + h.oldCount - 1];
  return [Math.max(1, h.oldStart), h.oldStart + 1];
}
export function chainSpans(r: RouteNode): Span[] {
  return [r.declaration, r.handler.span, ...r.guards.map((g) => g.span), ...r.calls.map((c) => c.span), ...r.dataAccess.map((d) => d.span)];
}
const intersects = (a: [number, number], s: Span): boolean => a[0] <= s.end && s.start <= a[1];
const contains = (a: [number, number], s: Span): boolean => s.start <= a[0] && a[1] <= s.end;
export interface CaseScore { c1: boolean; c2: boolean; c1Routes: number; c2Routes: number; c2NodeKinds: string[] }
/** C1: a route's chain intersects a (padded) window; C2: an unpadded hunk range lies inside one chain node. */
export function scoreCase(map: RouteMap, windows: Array<{ file: string; range: [number, number] }>, hunks: Array<{ file: string; range: [number, number] }>): CaseScore {
  let c1Routes = 0, c2Routes = 0;
  const kinds = new Set<string>();
  for (const r of map.routes) {
    const spans = chainSpans(r);
    const hit1 = windows.some((w) => spans.some((s) => s.file === w.file && intersects(w.range, s)));
    if (hit1) c1Routes++;
    let hit2 = false;
    for (const h of hunks) {
      const named: Array<[string, Span]> = [["declaration", r.declaration], ["handler", r.handler.span], ...r.guards.map((g): [string, Span] => ["guard", g.span]), ...r.calls.map((c): [string, Span] => [`call@${c.depth}`, c.span]), ...r.dataAccess.map((d): [string, Span] => [`data@${d.depth}`, d.span])];
      for (const [k, s] of named) if (s.file === h.file && contains(h.range, s)) { hit2 = true; kinds.add(k); }
    }
    if (hit2) c2Routes++;
  }
  return { c1: c1Routes > 0, c2: c2Routes > 0, c1Routes, c2Routes, c2NodeKinds: [...kinds].sort() };
}
