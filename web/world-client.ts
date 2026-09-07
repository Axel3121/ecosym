import { worldForm, type WorldForm } from "../src/world-form.ts";
import { validateWorldSnapshot } from "../src/world-snapshot.ts";

export type WorldLoadResult =
  | { kind: "loaded"; form: WorldForm }
  | { kind: "cancelled" }
  | { kind: "failure"; reason: "http"; status: number }
  | { kind: "failure"; reason: "invalid-response" | "request" };

/** One bounded read of the product contract. Sequencing and retained state belong to the caller. */
export async function loadWorld(options: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<WorldLoadResult> {
  const caller = options.signal;
  if (caller?.aborted) return { kind: "cancelled" };
  const timeout = new AbortController();
  const request = new AbortController();
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("World read aborted")); });
  const abort = () => { request.abort(); rejectAbort(); };
  caller?.addEventListener("abort", abort, { once: true });
  timeout.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => timeout.abort(), 10000);
  try {
    const read = async (): Promise<WorldLoadResult> => {
      const response = await (options.fetch ?? fetch)("/api/world-snapshot", { method: "GET", cache: "no-store", signal: request.signal });
      if (!response.ok) return { kind: "failure", reason: "http", status: response.status };
      // Read separately so a body transport error cannot masquerade as malformed JSON.
      const body = await response.text();
      try {
        return { kind: "loaded", form: worldForm(validateWorldSnapshot(JSON.parse(body))) };
      } catch { return { kind: "failure", reason: "invalid-response" }; }
    };
    const result = await Promise.race([read(), aborted]);
    if (caller?.aborted) return { kind: "cancelled" };
    if (timeout.signal.aborted) return { kind: "failure", reason: "request" };
    return result;
  } catch {
    // Check the caller independently: cancellation wins a same-tick timeout tie.
    return caller?.aborted ? { kind: "cancelled" } : { kind: "failure", reason: "request" };
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", abort);
    timeout.signal.removeEventListener("abort", abort);
  }
}
