import { describe, expect, it } from "vitest";
import { NbcError, nbcBrowser, parseEnvelope, runtimeEnv, sessionUnavailable, type Exec, type ExecResult } from "./nbc.js";

function ok(data: unknown): ExecResult {
  return { stdout: JSON.stringify({ ok: true, command: "x", data, warnings: [] }), stderr: "", code: 0 };
}

function failed(code: string, message = "", hint = ""): ExecResult {
  return { stdout: JSON.stringify({ ok: false, error: { code, message, hint } }), stderr: "", code: 1 };
}

/** fakeExec answers each call with the first responder that claims it. */
function fakeExec(respond: (args: string[]) => ExecResult) {
  const calls: { binary: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const exec: Exec = async (binary, args, options) => {
    calls.push({ binary, args, env: options.env });
    return respond(args);
  };
  return { exec, calls };
}

/** commandOf drops the profile flags and the output flags. */
const commandOf = (args: string[]) => args.slice(2).filter((arg, index, all) => arg !== "--format" && all[index - 1] !== "--format");

describe("parseEnvelope", () => {
  it("skips what nbc prints before the envelope and after it", () => {
    expect(parseEnvelope('Installing…\n{"ok":true,"data":{"a":1}}\ntrailing')).toEqual({ ok: true, data: { a: 1 } });
    expect(parseEnvelope("no json here")).toBeUndefined();
  });
});

describe("nbcBrowser", () => {
  it("targets the profile, asks for JSON, and runs in the app's runtime", async () => {
    const { exec, calls } = fakeExec(() => ok({ result: { found: true } }));
    const browser = nbcBrowser({ profile: "work", binary: "/bin/nbc", runtimeRoot: "/rt", exec });
    expect(await browser.evaluate<{ found: boolean }>("1")).toEqual({ found: true });
    expect(calls[0]).toMatchObject({ binary: "/bin/nbc", args: ["--profile", "work", "eval", "1", "--format", "json"] });
    expect(calls[0]!.env).toMatchObject(runtimeEnv("/rt"));
    expect(calls[0]!.env.CLAWBROWSER_SESSION_ROOT).toBe("/rt/sessions");
  });

  it("keeps browser arguments after the separator, behind the output flag", async () => {
    const { exec, calls } = fakeExec((args) => (commandOf(args)[0] === "status" ? ok({ status: "stopped" }) : ok({})));
    await nbcBrowser({ profile: "p", binary: "nbc", runtimeRoot: null, exec, browserArgs: ["--lang=en-US"] }).start();
    expect(calls.at(-1)!.args).toEqual(["--profile", "p", "start", "--no-remote", "--format", "json", "--", "--lang=en-US"]);
  });

  it("starts with no browser switches unless given some, which nbc refuses on proxied profiles", async () => {
    const { exec, calls } = fakeExec((args) => (commandOf(args)[0] === "status" ? ok({ status: "stopped" }) : ok({})));
    await nbcBrowser({ profile: "p", binary: "nbc", exec }).start();
    expect(calls.at(-1)!.args).toEqual(["--profile", "p", "start", "--no-remote", "--format", "json"]);
  });

  it("reuses a running profile that answers", async () => {
    const { exec, calls } = fakeExec((args) => (commandOf(args)[0] === "status" ? ok({ status: "running" }) : ok({ result: 1 })));
    await nbcBrowser({ profile: "p", binary: "nbc", exec }).start();
    expect(calls.map((call) => commandOf(call.args)[0])).toEqual(["status", "eval"]);
  });

  it("restarts a running profile that does not answer", async () => {
    const { exec, calls } = fakeExec((args) => {
      const command = commandOf(args)[0];
      if (command === "status") return ok({ status: "running" });
      if (command === "eval") return failed("CDP_UNREACHABLE", "gone");
      return ok({});
    });
    await nbcBrowser({ profile: "p", binary: "nbc", exec }).start();
    expect(calls.map((call) => commandOf(call.args)[0])).toEqual(["status", "eval", "stop", "start"]);
  });

  it("turns nbc's error envelope into an NbcError", async () => {
    const { exec } = fakeExec(() => failed("SESSION_NOT_FOUND", "no session", "start it"));
    const error = await nbcBrowser({ profile: "p", binary: "nbc", exec }).open("https://www.tiktok.com").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NbcError);
    expect(error).toMatchObject({ command: "open", code: "SESSION_NOT_FOUND", hint: "start it" });
    expect(sessionUnavailable(error)).toBe(true);
  });

  it("fails an eval that returned nothing, and a call that printed no envelope", async () => {
    const empty = nbcBrowser({ profile: "p", binary: "nbc", exec: fakeExec(() => ok({})).exec });
    await expect(empty.evaluate("1")).rejects.toThrow("returned no value");
    const garbage = nbcBrowser({ profile: "p", binary: "nbc", exec: fakeExec(() => ({ stdout: "", stderr: "boom", code: 2 })).exec });
    await expect(garbage.open("about:blank")).rejects.toThrow("boom");
  });
});
