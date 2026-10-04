// The monitor's state as a JSON file. Written whole to a temporary file and
// renamed into place, so a process killed mid-write leaves the previous state,
// never half of one.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { emptyState, normalizeState, type MonitorState } from "../state.js";

/** defaultStatePath is where the CLI keeps one profile's state. */
export function defaultStatePath(profile: string): string {
  const safe = profile.replace(/[^A-Za-z0-9._-]+/g, "_") || "default";
  return join(homedir(), ".nextbrowser", "tiktok-monitoring", `${safe}.json`);
}

/** loadState reads a state file; a missing file is a fresh state. A file that
 *  is there but unreadable is an error: starting over silently would read
 *  every source as a new baseline and lose the counts on record. */
export async function loadState(path: string): Promise<MonitorState> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw error;
  }
  return normalizeState(JSON.parse(text));
}

export async function saveState(path: string, state: MonitorState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
