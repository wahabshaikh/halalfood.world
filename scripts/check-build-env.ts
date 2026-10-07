/** Runs before `vinext build`; see lib/build-guard.ts. */
import { buildGuardFailure } from "../lib/build-guard";

const failure = buildGuardFailure(process.env);
if (failure) {
  console.error(failure);
  process.exit(1);
}
