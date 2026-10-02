import { NativeSelect } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { isRetired, orderAreas, pickerGroups, withArea, withoutArea } from '../utils/practiceAreas';

// The practice-area picker (docs/plans/tier-3.md, section 18, U47 (a)): a
// dropdown, "Add a practice area…", offering the 21 areas not yet chosen
// under their seven group headings (Other last, under none), and the chosen
// areas as chips in list order, each with an ×. A retired name a client still
// holds (U43 (b): there is no retag) shows as a chip marked "retired", with
// the same ×, and is never offered. The client form, Scenarios' "A new
// client" and the hire scenario's focus all use it; the logic is
// src/utils/practiceAreas.js.
const PracticeAreaPicker = ({ id, value = [], onChange, label = 'Practice areas', testId = 'practice-area-picker' }) => {
  const chosen = orderAreas(value);
  const groups = pickerGroups(value);
  const add = (area) => {
    if (area) onChange(withArea(value, area));
  };

  return (
    <div className="space-y-2" data-testid={testId}>
      <NativeSelect
        id={id}
        aria-label={`Add to ${label.toLowerCase()}`}
        value=""
        onChange={(e) => add(e.target.value)}
        disabled={groups.length === 0}
      >
        <option value="">{groups.length > 0 ? 'Add a practice area…' : 'Every practice area is chosen'}</option>
        {groups.map((group) => (group.name ? (
          <optgroup key={group.name} label={group.name}>
            {group.areas.map((area) => <option key={area} value={area}>{area}</option>)}
          </optgroup>
        ) : group.areas.map((area) => <option key={area} value={area}>{area}</option>)))}
      </NativeSelect>
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={`Chosen ${label.toLowerCase()}`}>
          {chosen.map((area) => {
            const retired = isRetired(area);
            return (
              <li key={area}>
                <Badge
                  variant={retired ? 'outline' : 'secondary'}
                  className="gap-1 pr-1 font-medium"
                  data-testid="area-chip"
                  data-area={area}
                  title={retired ? `${area} is no longer on the list; remove it and add the area that fits.` : undefined}
                >
                  {area}
                  {retired && <span className="font-normal text-muted-foreground">retired</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${area}`}
                    onClick={() => onChange(withoutArea(value, area))}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No practice area yet.</p>
      )}
    </div>
  );
};

export default PracticeAreaPicker;
