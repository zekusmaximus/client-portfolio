import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { AlertTriangle, Download } from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import LoadTable from './components/LoadTable';
import PersonLoadSheet from './components/PersonLoadSheet';
import AssociateSplit from './components/AssociateSplit';
import { partnershipModel, bookYears, formatMoney, SECOND_CHAIR_EFFORT_SHARE } from './utils/load';
import { revenueForYear } from './utils/revenue';
import { exportPartnershipReport, exportLoadCsv } from './utils/partnershipExports';

// Who's carrying what (docs/plans/people-and-second-chair.md, Phase 4): the
// partners' lead books and everyone's second-chair load, from the People list
// and each client's lead and second chair, each against the average of the
// active people in the same role (P10). Departures are modelled on Scenarios.
// The associate split (Phase 6) proposes second chairs for the clients that
// have none and writes each one a partner accepts.
const SHARE_PERCENT = Math.round(SECOND_CHAIR_EFFORT_SHARE * 100);

const PartnershipAnalytics = () => {
  const clients = usePortfolioStore((s) => s.clients);
  const people = usePortfolioStore((s) => s.people);
  const reportingYear = usePortfolioStore((s) => s.getReportingYear());
  const setCurrentView = usePortfolioStore((s) => s.setCurrentView);

  const [selectedId, setSelectedId] = useState(null);
  const [exportError, setExportError] = useState(null);

  const revenueOf = useMemo(() => (client) => revenueForYear(client, reportingYear), [reportingYear]);
  const model = useMemo(() => partnershipModel(people, clients, revenueOf), [people, clients, revenueOf]);
  const years = useMemo(() => bookYears(clients), [clients]);
  const selectedRow = model.rows.find((r) => r.person.id === selectedId) || null;

  const runExport = (label, fn) => {
    setExportError(null);
    try {
      fn();
    } catch (error) {
      console.error(`${label} failed:`, error);
      setExportError(`${label} failed: ${error.message}`);
    }
  };

  if (!clients.length) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No clients yet. Import the book on Data Upload, and each partner's lead book and everyone's
          second-chair load appear here.
        </CardContent>
      </Card>
    );
  }

  const tiles = [
    ['Clients', model.totals.clients],
    [`Revenue ${reportingYear}`, formatMoney(model.totals.revenue)],
    ['Without a second chair', model.noSecondChair.length],
    ...(model.unled.length > 0 ? [['Without a lead', model.unled.length]] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Who&apos;s carrying what</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Revenue is {reportingYear}&apos;s. Each figure is compared with the average of the active people in the
            same role; &quot;—&quot; means there is no one to compare with. To model a departure, use Scenarios.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => runExport('The report', () => exportPartnershipReport(model, reportingYear, revenueOf))}>
              Report (print or save as PDF)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runExport('The CSV', () => exportLoadCsv(model, reportingYear))}>
              Everyone&apos;s load (CSV)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {exportError && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{exportError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="text-2xl font-bold tabular-nums">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {model.unled.length > 0 && (
        <Alert data-testid="unled-clients">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {model.unled.length === 1 ? 'One client has' : `${model.unled.length} clients have`} no lead, so{' '}
            {model.unled.length === 1 ? 'it counts' : 'they count'} in no one&apos;s book:{' '}
            {model.unled.slice(0, 10).map((c) => c.name).join(', ')}
            {model.unled.length > 10 ? ', …' : ''}. Set a lead in{' '}
            <button type="button" className="underline" onClick={() => setCurrentView('client-details')}>
              Client Details
            </button>
            .
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lead books</CardTitle>
          <p className="text-sm text-muted-foreground">
            The clients each partner leads, heaviest revenue first, against the partners&apos; average.
          </p>
        </CardHeader>
        <CardContent>
          <LoadTable rows={model.leadBooks} which="lead" heading="Partner" year={reportingYear} onSelect={setSelectedId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Second-chair load</CardTitle>
          <p className="text-sm text-muted-foreground">
            The clients each person second-chairs, against the average of the others in the same role. A
            client&apos;s lead carries its full effort and its second chair {SHARE_PERCENT}% of it; clients and
            revenue count in full for both.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {model.secondChairs.map((group) => (
            <div key={group.role}>
              <h3 className="text-sm font-semibold mb-2">{group.label}</h3>
              <LoadTable rows={group.rows} which="second" heading="Name" year={reportingYear} onSelect={setSelectedId} />
            </div>
          ))}
        </CardContent>
      </Card>

      <AssociateSplit people={people} clients={clients} revenueOf={revenueOf} year={reportingYear} />

      <PersonLoadSheet
        row={selectedRow}
        year={reportingYear}
        years={years}
        revenueOf={revenueOf}
        revenueOfYear={revenueForYear}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
};

export default PartnershipAnalytics;
