// The monitor's own log: one line per thing it did or saw. The caller decides
// where the lines go; the pass summary keeps only a few notes, and when a read
// goes wrong on someone else's machine the log is the whole record.

export interface LogEntry {
  t: string;
  ev: string;
  [key: string]: unknown;
}

export type LogSink = (entry: LogEntry) => void;

export type Logger = (ev: string, data?: Record<string, unknown>) => void;

/** makeLogger binds a sink. It never throws: a log line that cannot be written
 *  must not end a pass. Without a sink nothing is logged. */
export function makeLogger(sink: LogSink | undefined, now: () => number = Date.now): Logger {
  if (!sink) return () => undefined;
  return (ev, data = {}) => {
    try {
      sink({ t: new Date(now()).toISOString(), ev, ...data });
    } catch {
      /* not the monitor's problem */
    }
  };
}

/** errorText names an error for a log line or a note. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
