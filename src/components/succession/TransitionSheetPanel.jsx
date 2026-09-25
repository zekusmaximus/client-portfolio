import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Download } from 'lucide-react';
import { formatClientName } from '../../utils/textUtils';
import { buildTransitionSheet, exportTransitionSheet, seatsLeftAfterSheet } from '../../utils/transitionPlans';

// The accepted plan as an import sheet, and what applying it does
const TransitionSheetPanel = ({ departure, plans }) => {
  const sheet = useMemo(() => buildTransitionSheet(departure.decisions, plans), [departure, plans]);
  const leftOver = useMemo(() => seatsLeftAfterSheet(departure, sheet.rows), [departure, sheet]);
  const leaving = departure.departing.filter((p) => !leftOver.some((e) => e.person.id === p.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          Apply the accepted plan
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Export the approved clients as an import sheet (CLIENT, Lead, Second Chair), then on Data Upload run
          Check file and Upload. The sheet changes each client&apos;s lead and second chair and nothing else. Nothing on
          this page writes to the book.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => exportTransitionSheet(sheet.csv)} disabled={sheet.rows.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export import sheet ({sheet.rows.length} {sheet.rows.length === 1 ? 'client' : 'clients'})
          </Button>
          {sheet.rows.length === 0 && <span className="text-muted-foreground">Approve at least one client first.</span>}
        </div>
        {sheet.skipped.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Approved but left out of the sheet:{' '}
              {sheet.skipped.map((s) => `${formatClientName(s.client.name)} (${s.reason})`).join('; ')}
            </AlertDescription>
          </Alert>
        )}
        {sheet.rows.length > 0 && leaving.length > 0 && (
          <p>
            Once the sheet is uploaded, {leaving.map((p) => p.name).join(', ')} {leaving.length === 1 ? 'holds' : 'hold'} no
            seat and can be deactivated in the People dialog.
          </p>
        )}
        {leftOver.map(({ person, clients }) => (
          <p key={person.id} className="text-amber-800">
            {person.name} would still hold a seat on {clients.length} {clients.length === 1 ? 'client' : 'clients'} not in the
            sheet ({clients.map((c) => formatClientName(c.name)).join(', ')}), so cannot be deactivated yet.
          </p>
        ))}
      </CardContent>
    </Card>
  );
};

export default TransitionSheetPanel;
