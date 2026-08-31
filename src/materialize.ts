import type { ConnectionConfig, Selector, SourceTime } from "./config.ts";
import { canonicalJson, isJsonScalar, type JsonScalar } from "./json.ts";
import type { SourceRecord } from "./readers.ts";
import type { FactInput } from "./store.ts";
import { sha256 } from "./json.ts";
import { isRepresentableUtcInstant, parseCalendarInstant } from "./time.ts";

const MISSING = Symbol("missing source field");
const MAX_SAFE_INTEGER_DECIMAL_DIGITS = Number.MAX_SAFE_INTEGER.toString().length;

export class SourceMappingError extends Error {
  readonly code = "source_malformed";

  constructor() {
    super("source record does not satisfy its connection mapping");
    this.name = "SourceMappingError";
  }
}

export function materializeFacts(
  config: ConnectionConfig,
  source: SourceRecord,
): FactInput[] {
  const identity = config.sourceRecord.identity.map((selector) => {
    const value = requiredScalar(selector, source);
    if (value === null) {
      throw new SourceMappingError();
    }
    return value;
  });
  const sourceRecordId = `sha256:${sha256(canonicalJson(identity))}`;
  const sourceRecordedAt = materializeTime(config.sourceRecord.recordedAt, source);
  const facts: FactInput[] = [];

  for (const fact of config.facts) {
    if (
      fact.required.some((selector) => {
        const value = select(selector, source);
        return value === MISSING || value === null;
      })
    ) {
      continue;
    }
    const subject = requiredScalar(fact.subject, source);
    if (typeof subject !== "string" || subject.length === 0) {
      throw new SourceMappingError();
    }
    const payload: Record<string, JsonScalar> = {};
    for (const [name, selector] of Object.entries(fact.payload)) {
      payload[name] = requiredScalar(selector, source);
    }
    facts.push({
      epistemicStatus: fact.epistemicStatus,
      factOwner: config.factOwner,
      kind: fact.kind,
      payload,
      sourceRecordedAt,
      sourceRecordId,
      subject,
    });
  }
  return facts;
}

function materializeTime(sourceTime: SourceTime, source: SourceRecord): null | string {
  if ("unavailable" in sourceTime) {
    return null;
  }
  const selected = selectWithNumericLexeme(sourceTime.selector, source);
  const value = selected.value;
  if (value === MISSING) {
    throw new SourceMappingError();
  }
  if (value === null) {
    return null;
  }

  let milliseconds: number;
  switch (sourceTime.format) {
    case "iso8601":
      if (!isRepresentableUtcInstant(value)) {
        throw new SourceMappingError();
      }
      return value;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new SourceMappingError();
      }
      milliseconds = parseCalendarInstant(`${value}T00:00:00.000Z`) ?? Number.NaN;
      break;
    case "unix-seconds":
      milliseconds = exactMilliseconds(value, selected.numericLexeme, 3);
      break;
    case "unix-milliseconds":
      milliseconds = exactMilliseconds(value, selected.numericLexeme, 0);
  }
  if (!Number.isFinite(milliseconds)) {
    throw new SourceMappingError();
  }
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw new SourceMappingError();
  }
  const timestamp = date.toISOString();
  if (!isRepresentableUtcInstant(timestamp)) {
    throw new SourceMappingError();
  }
  return timestamp;
}

function requiredScalar(selector: Selector, source: SourceRecord): JsonScalar {
  const value = select(selector, source);
  if (value === MISSING || !isJsonScalar(value)) {
    throw new SourceMappingError();
  }
  return value;
}

function select(selector: Selector, source: SourceRecord): unknown | typeof MISSING {
  return selectWithNumericLexeme(selector, source).value;
}

interface SelectedValue {
  numericLexeme: string | undefined;
  value: unknown | typeof MISSING;
}

function selectWithNumericLexeme(selector: Selector, source: SourceRecord): SelectedValue {
  if ("coalesce" in selector) {
    let foundNull = false;
    for (const choice of selector.coalesce) {
      const selected = selectWithNumericLexeme(choice, source);
      if (selected.value === null) {
        foundNull = true;
      } else if (selected.value !== MISSING) {
        return selected;
      }
    }
    return { numericLexeme: undefined, value: foundNull ? null : MISSING };
  }
  if ("default" in selector) {
    const selected = selectWithNumericLexeme(selector.selector, source);
    return selected.value === MISSING || selected.value === null
      ? { numericLexeme: undefined, value: selector.default }
      : selected;
  }
  if (selector.scope === "meta") {
    return {
      numericLexeme: undefined,
      value:
        selector.value === "record-index"
          ? source.meta.recordIndex
          : source.meta.sourcePath,
    };
  }

  let value: unknown = selector.scope === "record" ? source.record : source.root;
  const segments = selector.path.split(".");
  for (const [index, segment] of segments.entries()) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      return { numericLexeme: undefined, value: MISSING };
    }
    const container = value;
    value = (container as Record<string, unknown>)[segment];
    if (index === segments.length - 1) {
      return {
        numericLexeme:
          typeof value === "number"
            ? source.numericLexemes?.get(container)?.get(segment)
            : undefined,
        value,
      };
    }
  }
  return { numericLexeme: undefined, value };
}

function exactMilliseconds(
  value: unknown,
  numericLexeme: string | undefined,
  millisecondScalePower: 0 | 3,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SourceMappingError();
  }
  const milliseconds =
    numericLexeme === undefined
      ? millisecondsFromBinary(value, millisecondScalePower)
      : millisecondsFromDecimal(numericLexeme, millisecondScalePower);
  const result = Number(milliseconds);
  if (!Number.isSafeInteger(result) || BigInt(result) !== milliseconds) {
    throw new SourceMappingError();
  }
  return result;
}

function millisecondsFromDecimal(value: string, millisecondScalePower: 0 | 3): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (match === null) {
    throw new SourceMappingError();
  }
  const fraction = match[3] ?? "";
  let coefficient = BigInt(`${match[2]}${fraction}`);
  if (coefficient === 0n) {
    return 0n;
  }
  if (match[1] === "-") {
    coefficient = -coefficient;
  }
  const exponent = Number(match[4] ?? "0");
  const shift = exponent - fraction.length + millisecondScalePower;
  if (!Number.isSafeInteger(exponent) || !Number.isSafeInteger(shift)) {
    throw new SourceMappingError();
  }
  const coefficientDigits = (coefficient < 0n ? -coefficient : coefficient).toString().length;
  if (shift >= 0) {
    if (coefficientDigits + shift > MAX_SAFE_INTEGER_DECIMAL_DIGITS) {
      throw new SourceMappingError();
    }
    return coefficient * 10n ** BigInt(shift);
  }
  const divisorPlaces = -shift;
  if (divisorPlaces > coefficientDigits) {
    throw new SourceMappingError();
  }
  const divisor = 10n ** BigInt(divisorPlaces);
  if (coefficient % divisor !== 0n) {
    throw new SourceMappingError();
  }
  return coefficient / divisor;
}

function millisecondsFromBinary(value: number, millisecondScalePower: 0 | 3): bigint {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  const high = bytes.getUint32(0);
  const low = bytes.getUint32(4);
  const exponentBits = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  const significand = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
  if (significand === 0n) {
    return 0n;
  }

  // Decode the Number's exact integer-times-power-of-two value before scaling.
  const binaryExponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
  const numerator = significand * (millisecondScalePower === 3 ? 1_000n : 1n);
  let milliseconds: bigint;
  if (binaryExponent >= 0) {
    milliseconds = numerator << BigInt(binaryExponent);
  } else {
    const divisor = 1n << BigInt(-binaryExponent);
    if (numerator % divisor !== 0n) {
      throw new SourceMappingError();
    }
    milliseconds = numerator / divisor;
  }
  if ((high & 0x80000000) !== 0) {
    milliseconds = -milliseconds;
  }
  return milliseconds;
}
