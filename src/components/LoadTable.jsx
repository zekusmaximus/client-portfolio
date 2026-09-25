import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatRatio, formatMoney, formatEffort } from '../utils/load';

// One load table for the Partnership tab: a row per person with clients,
// revenue and effort, each against the role's average (P10). `which` is
// 'lead' or 'second', the half of the row to show.
const LoadTable = ({ rows, which, heading, year, onSelect }) => {
  const ratios = which === 'lead' ? 'leadRatio' : 'secondRatio';
  const num = 'text-right tabular-nums';
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{heading}</TableHead>
          <TableHead className="text-right">Clients</TableHead>
          <TableHead className="text-right">vs avg</TableHead>
          <TableHead className="text-right">Revenue {year}</TableHead>
          <TableHead className="text-right">vs avg</TableHead>
          <TableHead className="text-right">Effort</TableHead>
          <TableHead className="text-right">vs avg</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.person.id}>
            <TableCell>
              <button
                type="button"
                className="font-medium text-left underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                onClick={() => onSelect(row.person.id)}
              >
                {row.person.name}
              </button>
              {row.person.active === false && (
                <Badge variant="outline" className="ml-2 text-xs">inactive</Badge>
              )}
            </TableCell>
            <TableCell className={num}>{row[which].count}</TableCell>
            <TableCell className={`${num} text-muted-foreground`}>{formatRatio(row[ratios].count)}</TableCell>
            <TableCell className={num}>{formatMoney(row[which].revenue)}</TableCell>
            <TableCell className={`${num} text-muted-foreground`}>{formatRatio(row[ratios].revenue)}</TableCell>
            <TableCell className={num}>{formatEffort(row[which].effort)}</TableCell>
            <TableCell className={`${num} text-muted-foreground`}>{formatRatio(row[ratios].effort)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default LoadTable;
