import { utcInstantOrderingKey } from "./time.ts";

/** Exact ordering for bounded source-reported UTC instants, not fact time keys. */
export function sourceReportInstantOrderingKey(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parts = /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,43}))?Z$/.exec(value);
  if (parts === null) return null;
  const base = utcInstantOrderingKey(`${parts[1]}Z`);
  if (base === null) return null;
  // Calendar validation belongs to the existing UTC parser. Retain the entire
  // fractional component separately so Date's millisecond precision loses none.
  return BigInt(new Date(base).getTime()) / 1000n * 10n ** 43n
    + BigInt((parts[2] ?? "").padEnd(43, "0"));
}

/** SQLite TEXT key extending existing millisecond keys without rewriting them. */
export function sourceReportFactTimeKey(value: unknown): string | null {
  if (typeof value !== "string" || sourceReportInstantOrderingKey(value) === null) return null;
  const fraction = value.slice(19, -1).replace(/^\./, "");
  // The legacy Z is a delimiter here, not a timestamp suffix. Extra digits sort
  // after the exact millisecond and before the next millisecond. Trimming only
  // trailing zeros makes equivalent spellings share the same identity key.
  return `${value.slice(0, 19)}.${fraction.slice(0, 3).padEnd(3, "0")}Z${fraction.slice(3).replace(/0+$/, "")}`;
}
