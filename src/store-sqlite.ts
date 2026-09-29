import { performance } from "node:perf_hooks";
import type { DatabaseSync, StatementResultingChanges } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

import { StoreContentionError } from "./store-errors.ts";
import type { ContentionBudget } from "./store-types.ts";

export const BUSY_RETRY_WINDOW_MILLISECONDS = 250;

export function createCollectionContentionBudget(): ContentionBudget {
  return { remainingMilliseconds: BUSY_RETRY_WINDOW_MILLISECONDS };
}

export async function retryTransactionWithinContentionBudget<T>(
  database: DatabaseSync,
  busyTimeoutMilliseconds: number,
  contentionBudget: ContentionBudget,
  retryableOperation: () => T,
): Promise<T> {
  while (true) {
    const attemptTimeoutMilliseconds = Math.min(
      busyTimeoutMilliseconds,
      Math.max(0, Math.floor(contentionBudget.remainingMilliseconds)),
    );
    const attemptStartedAt = performance.now();
    let chargedMilliseconds = 0;
    try {
      return withBusyTimeout(database, busyTimeoutMilliseconds, attemptTimeoutMilliseconds, () =>
        runImmediateTransaction(database, retryableOperation, (elapsedMilliseconds) => {
          chargedMilliseconds += elapsedMilliseconds;
          consumeContentionBudget(contentionBudget, elapsedMilliseconds);
        }),
      );
    } catch (error) {
      if (!isSqliteContentionError(error)) {
        throw error;
      }
      consumeContentionBudget(
        contentionBudget,
        Math.max(0, performance.now() - attemptStartedAt - chargedMilliseconds),
      );
      const retryDelay = Math.min(10, contentionBudget.remainingMilliseconds);
      if (retryDelay <= 0) {
        throw new StoreContentionError(error);
      }
      const retryStartedAt = performance.now();
      await delay(retryDelay);
      consumeContentionBudget(
        contentionBudget,
        performance.now() - retryStartedAt,
      );
    }
  }
}

export function runImmediateTransaction<T>(
  database: DatabaseSync,
  operation: () => T,
  recordWait?: (milliseconds: number) => void,
): T {
  const startedAt = performance.now();
  try {
    database.exec("BEGIN IMMEDIATE");
  } catch (error) {
    if (isSqliteContentionError(error)) {
      throw new StoreContentionError(error);
    }
    throw error;
  } finally {
    recordWait?.(performance.now() - startedAt);
  }
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    rollbackKeepingCause(database);
    throw contentionAware(error);
  }
}

function rollbackKeepingCause(database: DatabaseSync): void {
  if (!database.isTransaction) {
    return;
  }
  try {
    database.exec("ROLLBACK");
  } catch {
    // The error that caused the rollback is the one the caller must see.
  }
}

function contentionAware(error: unknown): unknown {
  return isSqliteContentionError(error) ? new StoreContentionError(error) : error;
}

export function withBusyTimeout<T>(
  database: DatabaseSync,
  busyTimeoutMilliseconds: number,
  timeoutMilliseconds: number,
  operation: () => T,
): T {
  if (timeoutMilliseconds === busyTimeoutMilliseconds) {
    return operation();
  }
  database.exec(`PRAGMA busy_timeout = ${timeoutMilliseconds}`);
  try {
    return operation();
  } finally {
    database.exec(`PRAGMA busy_timeout = ${busyTimeoutMilliseconds}`);
  }
}

export function runReadTransaction<T>(database: DatabaseSync, operation: () => T): T {
  try {
    database.exec("BEGIN");
  } catch (error) {
    throw contentionAware(error);
  }
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    rollbackKeepingCause(database);
    throw contentionAware(error);
  }
}

export function numberOfChanges(result: StatementResultingChanges): number {
  return Number(result.changes);
}

export function isSqliteContentionError(error: unknown): boolean {
  if (error instanceof StoreContentionError) {
    return true;
  }
  if (
    error === null ||
    typeof error !== "object" ||
    !("errcode" in error) ||
    typeof error.errcode !== "number"
  ) {
    return false;
  }
  const primaryResultCode = error.errcode & 0xff;
  return primaryResultCode === 5 || primaryResultCode === 6;
}

function consumeContentionBudget(
  budget: ContentionBudget,
  elapsedMilliseconds: number,
): void {
  budget.remainingMilliseconds = Math.max(
    0,
    budget.remainingMilliseconds - elapsedMilliseconds,
  );
}
