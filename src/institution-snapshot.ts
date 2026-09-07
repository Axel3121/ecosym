/** Version of the institution owner's closed, read-only display contract. */
export const INSTITUTION_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * User-declared institutional state, not evidence of activity. No observation,
 * claim, connection status, or work claim is attributed by this institution-only
 * contract. Application composition links sources to connection IDs by exact
 * equality in WorldSnapshot, alongside observation-owned facts and collection
 * health. That declared link is not causal attribution or runtime enforcement;
 * names and keywords must never invent one.
 *
 * mandateDigest is deliberately absent. It is authority-context material for
 * petition callers of resolveAuthorityContext, not for a surface that owns no
 * authority and has no petition path through this read-only contract.
 *
 * When bodyReadable is false, domain "" and empty sources/mayActAlone/mustEscalate
 * are placeholders: these mean unknown, not a verified empty mandate. Revision
 * metadata remains available; status "unreadable" means no revision row exists. Only its
 * body is digest-checked; status, IDs, revision, timestamps, and name are not
 * digest-protected. This contract adds no integrity guarantee for those fields.
 */
export interface FoundedCivilizationSnapshot {
  civilizationId: string;
  name: string;
  foundedAt: string;
  bodyReadable: boolean;
  domain: string;
  sources: string[];
  mayActAlone: string[];
  mustEscalate: string[];
  mandate:
    | { status: "active" | "dissolved"; mandateId: string; revision: string; recordedAt: string }
    | { status: "unreadable" };
}

/**
 * Institution-only input for application-core composition, not a world snapshot
 * or raw export. WorldSnapshot composes this input alongside observation-owned
 * state without routing institutional state through the observation owner.
 * Civilizations are ordered by foundedAt then civilizationId;
 * forgotten civilizations are absent. Unverifiable mandates are unknown per
 * entry so a damaged record does not make all founded civilizations unviewable.
 */
export interface InstitutionSnapshot {
  schemaVersion: typeof INSTITUTION_SNAPSHOT_SCHEMA_VERSION;
  civilizations: FoundedCivilizationSnapshot[];
}
