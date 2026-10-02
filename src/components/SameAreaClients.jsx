import { sameAreaClients } from '../utils/practiceAreas';
import { formatClientName } from '../utils/textUtils';

// Other clients in the same areas (docs/plans/tier-3.md, section 18, U42
// (a)): under the practice-area picker in the client form and in Scenarios'
// "A new client", for each area picked, the other clients holding it, each
// with its lead. A starting point for the partner's own conflict check, not a
// check: nothing is flagged, ranked or counted, and the Conflict Risk pick
// stays the partner's.
const SameAreaClients = ({ clients, areas, excludeId = null }) => {
  const { areas: shared, notCompared } = sameAreaClients(clients, areas, excludeId);
  if (shared.length === 0 && notCompared.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2" data-testid="same-area-clients">
      <p className="text-sm font-medium">Other clients in the same areas</p>
      <p className="text-xs text-muted-foreground">
        Sharing an area is not a conflict. Use this as a starting point for your own check.
      </p>
      {shared.map(({ area, clients: others }) => (
        <div key={area} data-testid="same-area" data-area={area}>
          <p className="text-sm font-medium">{area}</p>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other client.</p>
          ) : (
            <ul className="text-sm space-y-0.5">
              {others.map((c) => (
                <li key={String(c.id)}>
                  {formatClientName(c.name)}
                  <span className="text-muted-foreground"> (lead: {c.lead ?? 'no lead'})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {notCompared.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="same-area-retired">
          Not compared, as no longer on the list: {notCompared.join(', ')}.
        </p>
      )}
    </div>
  );
};

export default SameAreaClients;
