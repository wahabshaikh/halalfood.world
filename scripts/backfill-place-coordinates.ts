import {
  GOOGLE_PLACES_COORDINATE_FIELD_MASK,
  getGooglePlaceDetails,
  getGooglePlacesApiKey,
} from "../src/lib/google-places";
import {
  listPlacesNeedingCoordinateBackfill,
  updatePlaceCoordinatesIfMissing,
} from "../src/lib/places";

type BackfillOptions = {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  delayMs: number;
};

const DEFAULTS: BackfillOptions = {
  dryRun: false,
  limit: 100,
  batchSize: 25,
  delayMs: 250,
};

function usage() {
  console.log(`Usage: npm run backfill:places -- [options]

Options:
  --dry-run             fetch and report coordinates without writing rows
  --limit N             maximum candidates to inspect (default: ${DEFAULTS.limit})
  --batch-size N        sequential work group size (default: ${DEFAULTS.batchSize})
  --delay-ms N          delay between Google requests (default: ${DEFAULTS.delayMs})
  --help                show this help`);
}

function valueFor(args: string[], name: string) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function positiveInteger(value: string | undefined, name: string, max: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, name: string, max: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`${name} must be an integer from 0 to ${max}`);
  }
  return parsed;
}

function parseOptions(args: string[]): BackfillOptions | null {
  if (args.includes("--help")) {
    usage();
    return null;
  }

  const valueFlags = ["--limit", "--batch-size", "--delay-ms"];
  for (const flag of valueFlags) {
    const inline = args.some((arg) => arg.startsWith(`${flag}=`));
    const separate = args.includes(flag);
    if (separate && !inline) {
      const value = args[args.indexOf(flag) + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
    }
    if (!inline && !separate) continue;
  }

  const known = new Set(["--dry-run", "--help", ...valueFlags]);
  const unknown = args.filter(
    (arg, index) =>
      !known.has(arg) &&
      !valueFlags.some((flag) => arg.startsWith(`${flag}=`)) &&
      !(index > 0 && valueFlags.includes(args[index - 1] ?? "")),
  );
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`);

  const hasOption = (name: string) =>
    args.some((arg) => arg === name || arg.startsWith(`${name}=`));
  const option = (name: string, fallback: number, parse: (value: string | undefined) => number) =>
    hasOption(name) ? parse(valueFor(args, name)) : fallback;

  return {
    dryRun: args.includes("--dry-run"),
    limit: option("--limit", DEFAULTS.limit, (value) =>
      positiveInteger(value, "--limit", 10000),
    ),
    batchSize: option("--batch-size", DEFAULTS.batchSize, (value) =>
      positiveInteger(value, "--batch-size", 1000),
    ),
    delayMs: option("--delay-ms", DEFAULTS.delayMs, (value) =>
      nonNegativeInteger(value, "--delay-ms", 60000),
    ),
  };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function runBackfill(options: BackfillOptions) {
  if (!getGooglePlacesApiKey()) {
    console.error(
      "Google Places is not configured. Set GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.",
    );
    return { inspected: 0, updated: 0, skipped: 0, failed: 0, exitCode: 1 };
  }

  const candidates = await listPlacesNeedingCoordinateBackfill({
    limit: options.limit,
  });
  console.log(
    `${options.dryRun ? "Dry run: " : ""}found ${candidates.length} candidate(s); ` +
      "only rows missing lat or lng are eligible.",
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let requests = 0;

  for (let start = 0; start < candidates.length; start += options.batchSize) {
    const batch = candidates.slice(start, start + options.batchSize);
    for (const candidate of batch) {
      const result = await getGooglePlaceDetails(candidate.google_place_id, {
        fieldMask: GOOGLE_PLACES_COORDINATE_FIELD_MASK,
      });
      requests += 1;

      if (!result.ok) {
        failed += 1;
        console.error(
          `failed ${candidate.id} (${candidate.google_place_id}): ${result.code}`,
        );
      } else if (!result.coordinates) {
        skipped += 1;
        console.warn(`no coordinates returned for ${candidate.id}`);
      } else if (options.dryRun) {
        updated += 1;
        console.log(
          `would update ${candidate.id}: ${result.coordinates.lat},${result.coordinates.lng}`,
        );
      } else if (
        await updatePlaceCoordinatesIfMissing(
          candidate.id,
          candidate.google_place_id,
          result.coordinates,
        )
      ) {
        updated += 1;
        console.log(
          `updated ${candidate.id}: ${result.coordinates.lat},${result.coordinates.lng}`,
        );
      } else {
        skipped += 1;
        console.warn(`skipped ${candidate.id}: row no longer needs an update`);
      }

      if (options.delayMs > 0 && requests < candidates.length) {
        await sleep(options.delayMs);
      }
    }
  }

  const summary = {
    inspected: candidates.length,
    requests,
    updated,
    skipped,
    failed,
    exitCode: failed ? 1 : 0,
  };
  console.log(JSON.stringify(summary));
  return summary;
}

const options = parseOptions(process.argv.slice(2));
if (options) {
  runBackfill(options).catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Coordinate backfill failed",
    );
    process.exitCode = 1;
  });
}
