import { Symbols } from 'recharts';

// The practice-area group legend the Dashboard's and Stage 1's charts share
// (docs/plans/tier-3.md, section 18, U45 (a)): each group shown, in legend
// order, with its colour and, for a scatter, its marker shape. The text keeps
// the page's own ink; only the swatch carries the colour (the dataviz
// skill's rule). `items` is legendGroups' (src/utils/practiceAreas.js).
const GroupLegend = ({ items = [], shapes = false, testId = 'group-legend' }) => {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Practice-area groups" data-testid={testId}>
      {items.map(({ group, color, shape }) => (
        <li key={group} className="flex items-center gap-1.5" data-group={group}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            {shapes
              ? <Symbols cx={7} cy={7} type={shape} size={70} fill={color} />
              : <rect x="1" y="1" width="12" height="12" rx="3" fill={color} />}
          </svg>
          <span>{group}</span>
        </li>
      ))}
    </ul>
  );
};

export default GroupLegend;
