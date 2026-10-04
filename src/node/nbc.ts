// A MonitorBrowser over the nbc/nextctl CLI, for running the monitor outside
// the NextBrowser app: a terminal, a server, a test.
//
// Every call runs `nbc --profile <name> <command> … --format json` and reads
// the {ok, data, error} envelope nbc prints. Pointed at the app's runtime root,
// it drives the very profiles the app manages — nbc keeps their sessions under
// ~/.nextbrowser/runtime (macOS) and finds none of them without it.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MonitorBrowser } from "../browser.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Exit code; null when the process was killed. */
  code: number | null;
}

/** Exec runs one CLI invocation. Tests replace it. */
export type Exec = (binary: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<ExecResult>;

export interface NbcOptions {
  profile: string;
  /** nbc or nextctl. Defaults to $NBC_BIN, $NEXTCTL_BIN, the app's managed
   *  nextctl, then nbc on PATH. */
  binary?: string;
  /** The app's runtime root, which the profile's session lives under.
   *  Defaults to the NextBrowser app's; pass null to leave nbc's own. */
  runtimeRoot?: string | null;
  /** The runtime nbc drives the profile with (--runtime), when not the
   *  profile's own. */
  runtime?: string;
  /** Extra environment for every call. */
  env?: Record<string, string>;
  timeoutMs?: number;
  startTimeoutMs?: number;
  /** Browser command-line switches for start. nbc refuses them on proxied
   *  profiles. */
  browserArgs?: string[];
  exec?: Exec;
  /** Called once per CLI call, for a debug trace. */
  trace?: (entry: { command: string; ms: number; ok: boolean; code?: string; error?: string }) => void;
}

/** NbcError is a failure nbc reported in its envelope, or a call that never
 *  produced one. */
export class NbcError extends Error {
  readonly command: string;
  readonly code: string;
  readonly hint: string;

  constructor(command: string, code: string, message: string, hint = "") {
    super([`nbc ${command} failed`, code, message, hint].filter(Boolean).join(": "));
    this.name = "NbcError";
    this.command = command;
    this.code = code;
    this.hint = hint;
  }
}

/** Codes after which the profile must be started or reattached. */
const SESSION_GONE = new Set(["SESSION_NOT_FOUND", "CDP_UNREACHABLE", "TAB_NOT_FOUND"]);

/** sessionUnavailable reports an error that a (re)start of the profile cures. */
export function sessionUnavailable(error: unknown): boolean {
  return error instanceof NbcError && SESSION_GONE.has(error.code);
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_START_TIMEOUT_MS = 5 * 60_000;
const APP_DATA_NAME = "nextbrowser";

/** appDataDir is where the NextBrowser app keeps its data (Electron's
 *  userData for an app named "nextbrowser"). */
export function appDataDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", APP_DATA_NAME);
  if (platform === "win32") return join(env.APPDATA || join(homedir(), "AppData", "Roaming"), APP_DATA_NAME);
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), APP_DATA_NAME);
}

/** defaultRuntimeRoot is the app's runtime root: ~/.nextbrowser/runtime on
 *  macOS, <userData>/runtime elsewhere (electron/main.cjs nextbrowserRuntimeRoot). */
export function defaultRuntimeRoot(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (env.NEXTBROWSER_RUNTIME_ROOT) return env.NEXTBROWSER_RUNTIME_ROOT;
  return platform === "darwin" ? join(homedir(), ".nextbrowser", "runtime") : join(appDataDir(platform, env), "runtime");
}

/** runtimeEnv is what the app puts in every nbc call's environment so nbc
 *  finds the profiles and sessions the app manages (electron/main.cjs childEnv). */
export function runtimeEnv(root: string): Record<string, string> {
  return {
    NEXTBROWSER_CONFIG_DIR: join(root, "config"),
    CLAWBROWSER_CACHE_DIR: join(root, "cache"),
    CLAWBROWSER_DATA_DIR: join(root, "data"),
    CLAWBROWSER_STATE_ROOT: join(root, "state"),
    CLAWBROWSER_SESSION_ROOT: join(root, "sessions"),
    NBC_PROFILE_ROOT: join(root, "profiles"),
    NBC_AUTO_UPDATE: "0",
    CLAWCTL_AUTO_UPDATE: "0",
  };
}

/** defaultBinary finds the CLI the way the app does, minus its dev paths. */
export function defaultBinary(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (env.NBC_BIN) return env.NBC_BIN;
  if (env.NEXTCTL_BIN) return env.NEXTCTL_BIN;
  const managedRoot = platform === "darwin" ? join(homedir(), ".nextbrowser", "managed-nextctl") : join(appDataDir(platform, env), "managed-nextctl");
  const managed = join(managedRoot, platform === "win32" ? "nextctl.exe" : "nextctl");
  return existsSync(managed) ? managed : "nbc";
}

export const execCli: Exec = (binary, args, options) =>
  new Promise((resolve) => {
    execFile(binary, args, { env: options.env, timeout: options.timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : null) : 0;
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") || (error && code === null ? error.message : ""), code });
    });
  });

interface Envelope {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string; hint?: string };
}

/** parseEnvelope reads the first JSON object nbc printed. nbc may print
 *  installation or diagnostic lines before it, so leading noise is skipped. */
export function parseEnvelope(stdout: string): Envelope | undefined {
  const start = stdout.indexOf("{");
  if (start < 0) return undefined;
  const body = stdout.slice(start);
  try {
    return JSON.parse(body) as Envelope;
  } catch {
    const end = body.lastIndexOf("}");
    if (end < 0) return undefined;
    try {
      return JSON.parse(body.slice(0, end + 1)) as Envelope;
    } catch {
      return undefined;
    }
  }
}

export interface NbcBrowser extends MonitorBrowser {
  readonly profile: string;
  /** Raw call, for commands the monitor has no method for. */
  call<T>(args: string[], timeoutMs?: number): Promise<T>;
  /** Whether nbc reports the profile's browser as running. */
  running(): Promise<boolean>;
  /** Starts the profile, or confirms a running one actually answers. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** nbcBrowser binds the CLI to one profile. */
export function nbcBrowser(options: NbcOptions): NbcBrowser {
  const binary = options.binary || defaultBinary();
  const exec = options.exec ?? execCli;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const root = options.runtimeRoot === null ? undefined : options.runtimeRoot || defaultRuntimeRoot();
  const env: NodeJS.ProcessEnv = { ...process.env, ...(root ? runtimeEnv(root) : {}), ...(options.env ?? {}) };
  const target = ["--profile", options.profile, ...(options.runtime ? ["--runtime", options.runtime] : [])];

  const call = async <T>(args: string[], callTimeoutMs = timeoutMs): Promise<T> => {
    const command = args[0] ?? "";
    // nbc reads everything after "--" as the browser's command line, so the
    // output flag has to go in ahead of it.
    const split = args.indexOf("--");
    const own = split < 0 ? args : args.slice(0, split);
    const browserArgs = split < 0 ? [] : args.slice(split);
    const started = Date.now();
    const result = await exec(binary, [...target, ...own, "--format", "json", ...browserArgs], { env, timeoutMs: callTimeoutMs });
    const envelope = parseEnvelope(result.stdout);
    const finish = (error?: NbcError) => {
      options.trace?.({ command, ms: Date.now() - started, ok: !error, ...(error ? { code: error.code, error: error.message } : {}) });
    };
    if (envelope && envelope.ok === false) {
      const error = new NbcError(command, envelope.error?.code ?? "", envelope.error?.message ?? "", envelope.error?.hint ?? "");
      finish(error);
      throw error;
    }
    if (!envelope || result.code !== 0) {
      const detail = result.stderr.trim().slice(0, 512) || (envelope ? `exit code ${result.code}` : "no JSON envelope in its output");
      const error = new NbcError(command, result.code === null ? "TIMEOUT" : "", detail);
      finish(error);
      throw error;
    }
    finish();
    return envelope.data as T;
  };

  const evaluate = async <T>(script: string): Promise<T> => {
    const data = await call<{ result?: T } | null>(["eval", script]);
    if (!data || !("result" in data)) throw new NbcError("eval", "", "the page returned no value");
    return data.result as T;
  };

  const running = async (): Promise<boolean> => {
    const data = await call<{ status?: string }>(["status"]);
    return data?.status === "running";
  };

  return {
    profile: options.profile,
    call,
    running,
    async open(url) {
      await call(["open", url]);
    },
    evaluate,
    async waitForLoad(timeoutSeconds = 15) {
      await call(["wait", "--load", "--timeout", `${timeoutSeconds}s`], (timeoutSeconds * 1000) + timeoutMs);
    },
    async start() {
      if (await running()) {
        // "Running" is read from the session's state file, and a browser that
        // was killed leaves that file behind; whether it answers is asked over
        // CDP with the cheapest expression there is.
        try {
          await evaluate("1");
          return;
        } catch (error) {
          if (!sessionUnavailable(error)) throw error;
          await call(["stop"]).catch(() => undefined);
        }
      }
      const browserArgs = options.browserArgs?.length ? ["--", ...options.browserArgs] : [];
      await call(["start", "--no-remote", ...browserArgs], startTimeoutMs);
    },
    async stop() {
      await call(["stop"]);
    },
  };
}
