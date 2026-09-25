import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ROLE_LABELS } from '../utils/people';
import {
  formatRatio,
  formatMoney,
  formatEffort,
  practiceAreasOf,
  practiceAreaBreakdown,
  revenueByYear,
} from '../utils/load';

const num = 'text-right tabular-nums';
const strategic = (client) => {
  const v = parseFloat(client.strategicValue);
  return Number.isFinite(v) ? v.toFixed(1) : '—';
};

const Figures = ({ load, ratios, year, against }) => (
  <div className="grid grid-cols-3 gap-3">
    {[
      ['Clients', load.count, ratios.count],
      [`Revenue ${year}`, formatMoney(load.revenue), ratios.revenue],
      ['Effort', formatEffort(load.effort), ratios.effort],
    ].map(([label, value, r]) => (
      <div key={label} className="rounded-md border p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{formatRatio(r)} {against}</div>
      </div>
    ))}
  </div>
);

const ClientTable = ({ clients, year, revenueOf, otherLabel, otherOf }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Client</TableHead>
        <TableHead className="text-right">Revenue {year}</TableHead>
        <TableHead className="text-right">Strategic value</TableHead>
        <TableHead className="text-right">Effort</TableHead>
        <TableHead>{otherLabel}</TableHead>
        <TableHead>Practice areas</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {clients.map((client) => (
        <TableRow key={client.id}>
          <TableCell className="font-medium">{client.name}</TableCell>
          <TableCell className={num}>{formatMoney(revenueOf(client))}</TableCell>
          <TableCell className={num}>{strategic(client)}</TableCell>
          <TableCell className={num}>{formatEffort(parseFloat(client.effort) || 0)}</TableCell>
          <TableCell>{otherOf(client) || '—'}</TableCell>
          <TableCell className="text-muted-foreground">{practiceAreasOf(client).join(', ') || '—'}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

// One person's lead book and second-chair seats, from the tab's model row.
// Everything shown is the book's own data: no projections.
const PersonLoadSheet = ({ row, year, years, revenueOf, revenueOfYear, onClose }) => {
  if (!row) return null;
  const { person, lead, second } = row;
  const byRevenue = (a, b) => revenueOf(b) - revenueOf(a);
  const history = lead.count > 0 && years.length > 0 ? revenueByYear(lead.clients, years, revenueOfYear) : [];
  const areas = practiceAreaBreakdown(lead.clients, revenueOf);
  const role = `${ROLE_LABELS[person.role] || person.role}${person.active === false ? ', inactive' : ''}`;
  const peers = person.role === 'emeritus' ? 'emeritus' : `${(ROLE_LABELS[person.role] || person.role).toLowerCase()}s`;

  return (
    <Sheet open={!!row} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="relative w-full max-w-3xl">
        <SheetHeader>
          <SheetTitle>{person.name}</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {role} · leads {lead.count} · second chair on {second.count}
          </p>
          <SheetClose onClick={onClose} />
        </SheetHeader>

        <div className="space-y-6 p-6">
          {(person.role === 'partner' || lead.count > 0) && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Lead book</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Figures load={lead} ratios={row.leadRatio} year={year} against="the partners' average" />
                {lead.count > 0 ? (
                  <ClientTable
                    clients={[...lead.clients].sort(byRevenue)}
                    year={year}
                    revenueOf={revenueOf}
                    otherLabel="Second chair"
                    otherOf={(c) => c.secondChair?.name}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Leads no clients.</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Second chair</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Figures load={second} ratios={row.secondRatio} year={year} against={`the ${peers}' average`} />
              {second.count > 0 ? (
                <ClientTable
                  clients={[...second.clients].sort(byRevenue)}
                  year={year}
                  revenueOf={revenueOf}
                  otherLabel="Lead"
                  otherOf={(c) => c.lead?.name}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Second chair on no clients.</p>
              )}
            </CardContent>
          </Card>

          {history.length > 1 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Revenue by year</CardTitle>
                <p className="text-xs text-muted-foreground">
                  The clients {person.name} leads now, in each year on file; not what {person.name} led then.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Year</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((h) => (
                      <TableRow key={h.year}>
                        <TableCell>{h.year}</TableCell>
                        <TableCell className={num}>{formatMoney(h.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {areas.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Lead book by practice area</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Practice area</TableHead>
                      <TableHead className="text-right">Clients</TableHead>
                      <TableHead className="text-right">Revenue {year}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {areas.map((a) => (
                      <TableRow key={a.area}>
                        <TableCell>{a.area}</TableCell>
                        <TableCell className={num}>{a.count}</TableCell>
                        <TableCell className={num}>{formatMoney(a.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PersonLoadSheet;
