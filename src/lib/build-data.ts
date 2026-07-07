import { env } from "./env";

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isStrictBuild(): boolean {
  return env.NODE_ENV === "production" && !env.ALLOW_EMPTY_BUILD_DATA;
}

export function handleBuildDataError(scope: string, error: unknown): void {
  console.error(`[build-data] ${scope}:`, error);

  if (!isStrictBuild()) return;

  throw new Error(`[build-data] ${scope} failed: ${formatError(error)}`);
}

export function assertBuildDataNonEmpty(scope: string, count: number): void {
  if (!isStrictBuild() || count > 0) return;

  throw new Error(`[build-data] ${scope} returned 0 items during a production build`);
}
