/**
 * Loads the dashboard's own source (apps/dashboard/src) into a keyless root
 * test: each `@/…` or relative import is transpiled at require time, and
 * everything around it (Next, Clerk, React's JSX runtime, `@/components/*`,
 * and whatever data modules the test names) is replaced by a stub.
 *
 * A page rendered this way returns its element tree unrendered: the page's
 * own function components are expanded by `expand`, stubbed components stay
 * as `{ type: "<Name>", props }` markers, so a test can assert what a page
 * would show without React or a browser.
 *
 * One loader per process. Used by test-org-access.ts and
 * test-dashboard-token-expiry.ts.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("module") as {
  _resolveFilename: (req: string, parent: { filename?: string } | undefined, ...rest: unknown[]) => string;
};

export const DASH_SRC = path.join(process.cwd(), "apps", "dashboard", "src");

/** Thrown by the stubbed `notFound()`; a page that calls it renders as "404". */
export class NotFound extends Error {}

/** A stub component: renders as a marker carrying its props. */
export function marker(name: string): (props: unknown) => unknown {
  const f = (props: unknown) => ({ type: name, props });
  Object.defineProperty(f, "name", { value: name });
  (f as unknown as { __stub: true }).__stub = true;
  return f;
}

const componentModule = new Proxy({}, {
  get: (_t, key) => (key === "__esModule" ? true : typeof key === "string" && key !== "then" ? marker(key) : undefined),
});

/** Stubs every dashboard test needs; a test's own stubs are merged over them. */
function baseStubs(): Record<string, unknown> {
  return {
    "server-only": {},
    "react/jsx-runtime": {
      jsx: (type: unknown, props: unknown) => ({ type, props }),
      jsxs: (type: unknown, props: unknown) => ({ type, props }),
      Fragment: "Fragment",
    },
    "next/link": { __esModule: true, default: marker("Link") },
    "next/navigation": { notFound: () => { throw new NotFound("NEXT_NOT_FOUND"); } },
    "next/server": {
      NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
    },
    "@clerk/nextjs": { UserButton: marker("UserButton") },
    "@/lib/utils": { cn: (...a: unknown[]) => a.filter(Boolean).join(" ") },
  };
}

export interface DashboardLoader {
  /** Requires a dashboard module by its path under apps/dashboard/src, without extension. */
  load<T>(rel: string): T;
}

/**
 * Installs the resolver. `outDirName` keeps each test's transpiled output
 * apart under dist/test/. `stubs` are module ids (bare or `@/…`) mapped to
 * their replacement exports; `@/components/*` is always stubbed.
 */
export function installDashboardLoader(opts: {
  outDirName: string;
  stubs: Record<string, unknown>;
}): DashboardLoader {
  const outRoot = path.join(process.cwd(), "dist", "test", opts.outDirName);
  const stubs = { ...baseStubs(), ...opts.stubs };
  for (const [id, stub] of Object.entries(stubs)) {
    const key = `\0stub:${id}`;
    (require.cache as Record<string, unknown>)[key] = { id: key, filename: key, loaded: true, exports: stub };
  }
  (require.cache as Record<string, unknown>)["\0stub:@components"] = { id: "c", filename: "c", loaded: true, exports: componentModule };

  const sourceFor = (abs: string): string | null => {
    for (const ext of [".ts", ".tsx"]) if (fs.existsSync(abs + ext)) return abs + ext;
    return null;
  };
  const transpileTo = (srcFile: string): string => {
    const rel = path.relative(DASH_SRC, srcFile).replace(/\.tsx?$/, ".js");
    const out = path.join(outRoot, rel);
    const text = ts.transpileModule(fs.readFileSync(srcFile, "utf8"), {
      fileName: srcFile,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    return out;
  };

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return `\0stub:${request}`;
    if (request.startsWith("@/components/")) return "\0stub:@components";
    let target: string | null = null;
    if (request.startsWith("@/")) target = path.join(DASH_SRC, request.slice(2));
    else if (request.startsWith(".") && parent?.filename?.startsWith(outRoot)) {
      const parentSrc = path.join(DASH_SRC, path.relative(outRoot, path.dirname(parent.filename)));
      target = path.join(parentSrc, request);
    }
    if (target) {
      const src = sourceFor(target);
      if (!src) throw new Error(`dashboard loader: no dashboard source for ${request}`);
      return transpileTo(src);
    }
    return origResolve.call(this, request, parent, ...rest);
  };

  return {
    load<T>(rel: string): T {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(`@/${rel}`) as T;
    },
  };
}

/** Expands the page's own function components; stubbed components stay as markers. */
export function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  if (!("type" in node) || !("props" in node)) {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, expand(v)]));
  }
  const el = node as { type: unknown; props?: Record<string, unknown> };
  if (typeof el.type === "function" && !(el.type as { __stub?: true }).__stub) {
    return expand((el.type as (p: unknown) => unknown)(el.props ?? {}));
  }
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.props ?? {})) props[k] = expand(v);
  return { type: typeof el.type === "function" ? (el.type as { name: string }).name : el.type, props };
}

/** Renders a page module's default export to a JSON string, or "404". */
export async function renderPage(
  page: (a: unknown) => Promise<unknown>,
  params: Record<string, string | null>,
): Promise<string> {
  try {
    const tree = await page({ params: Promise.resolve(params), searchParams: Promise.resolve({}) });
    return JSON.stringify(expand(tree));
  } catch (err) {
    if (err instanceof NotFound) return "404";
    throw err;
  }
}
