import { canonicalJson, type JsonValue, sha256 } from "./json.ts";

/**
 * The four things PRODUCT.md requires to found a civilization, "and no more".
 * A fifth required field is a product change, not an implementation detail.
 */
export interface MandateConfig {
  schemaVersion: 1;
  domain: string;
  sources: string[];
  mayActAlone: string[];
  mustEscalate: string[];
}

export interface CivilizationConfig extends MandateConfig {
  name: string;
}

export interface ParsedMandateConfig {
  config: MandateConfig;
  canonical: string;
}

export interface ParsedCivilizationConfig {
  config: CivilizationConfig;
  mandate: ParsedMandateConfig;
}

export class InstitutionError extends Error {
  readonly code = "invalid_mandate";

  constructor(message: string) {
    super(message);
    this.name = "InstitutionError";
  }
}

/**
 * The digest of a mandate is derived from its canonical bytes, never supplied.
 * A digest a caller hands in proves nothing about what is stored.
 */
export function mandateDigest(mandate: JsonValue): string {
  return `sha256:${sha256(canonicalJson(mandate))}`;
}

export function parseMandateConfig(input: unknown): ParsedMandateConfig {
  const mandate = objectAt(input, "mandate");
  exactKeys(
    mandate,
    ["schemaVersion", "domain", "sources", "mayActAlone", "mustEscalate"],
    "mandate",
  );
  if (mandate.schemaVersion !== 1) {
    throw new InstitutionError("mandate.schemaVersion must be 1");
  }
  const config: MandateConfig = {
    schemaVersion: 1,
    domain: nonEmptyStringAt(mandate.domain, "mandate.domain"),
    sources: stringArrayAt(mandate.sources, "mandate.sources"),
    mayActAlone: stringArrayAt(mandate.mayActAlone, "mandate.mayActAlone"),
    mustEscalate: stringArrayAt(mandate.mustEscalate, "mandate.mustEscalate"),
  };
  const canonical = canonicalJson(config as unknown as JsonValue);
  return { config, canonical };
}

export function parseCivilizationConfig(input: unknown): ParsedCivilizationConfig {
  const civilization = objectAt(input, "civilization");
  exactKeys(
    civilization,
    ["schemaVersion", "name", "domain", "sources", "mayActAlone", "mustEscalate"],
    "civilization",
  );
  const name = nonEmptyStringAt(civilization.name, "civilization.name");
  const { name: _name, ...mandateInput } = civilization;
  const mandate = parseMandateConfig(mandateInput);
  return { config: { ...mandate.config, name }, mandate };
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InstitutionError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  path: string,
): void {
  const present = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (present.length !== expected.length || present.some((key, index) => key !== expected[index])) {
    throw new InstitutionError(`${path} must have exactly the keys ${expected.join(", ")}`);
  }
}

function nonEmptyStringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "") {
    throw new InstitutionError(`${path} must be a non-empty string`);
  }
  return value;
}

function stringArrayAt(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new InstitutionError(`${path} must be an array`);
  }
  return value.map((entry, index) => nonEmptyStringAt(entry, `${path}[${index}]`));
}
