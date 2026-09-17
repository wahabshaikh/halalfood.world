import {
  d1HalalStatusRepository,
  getHalalStatus,
} from "../../../src/lib/halal-status";
import {
  formatHalalStatus,
  type HalalStatus,
} from "../../../src/lib/halal-status-view";

async function loadStatus(placeId: string): Promise<HalalStatus> {
  try {
    return await getHalalStatus(d1HalalStatusRepository(), placeId);
  } catch {
    return { status: "unavailable" };
  }
}

/** Server-rendered status shared by the place-page hero and evidence section copy. */
export default async function PlaceHalalStatus({
  placeId,
  compact = false,
}: {
  placeId: string;
  compact?: boolean;
}) {
  const view = formatHalalStatus(await loadStatus(placeId));
  return (
    <div
      className={`place-halal-status halal-status-${view.status}${compact ? " is-compact" : ""}`}
      aria-label={`Halal evidence status: ${view.label}`}
    >
      <span className="ui-badge halal-status-badge">{view.label}</span>
      <p className="halal-status-detail">{view.detail}</p>
      <p className="halal-status-explanation">{view.explanation}</p>
    </div>
  );
}
