import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// import { Alert } from '@/components/ui/alert'; // Alert component not available, using Card instead
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileText, FileCheck, CheckCircle, AlertCircle, Download } from 'lucide-react';
import { apiClient, apiErrorBody, apiErrorMessage } from './api';
import usePortfolioStore from './portfolioStore';
import Papa from 'papaparse';

// The import sheet (docs/plans/people-and-second-chair.md, section 3). The
// server's rules are in utils/csvImport.cjs; this is the help text.
const PRACTICE_AREAS =
  'Healthcare, Municipal, Corporate, Energy, Financial, Education, Transportation, Environmental, Technology, Real Estate, Non-Profit, Other';

const SHEET_COLUMNS = [
  { name: 'CLIENT', required: 'yes', values: "the client's name; once per file" },
  {
    name: 'Contract Period',
    required: 'yes',
    values: '1/1/26-12/31/26, Expired 6/30/25 or expires 6/30/27; the status (In Force, Done, Proposal, Hold) is derived from it',
  },
  {
    name: 'YYYY Contracts',
    required: 'at least one',
    values: 'one column per year (2024 Contracts, 2025 Contracts, ...): 72000, $72,000 or $72,000.00; blank or 0 for none',
  },
  { name: 'Lead', required: 'yes', values: 'one active partner, as named on the People list (case does not matter)' },
  { name: 'Second Chair', required: 'no', values: 'any active person other than the lead; blank for none' },
  { name: 'Originator', required: 'no', values: 'anyone on the People list, active or not, or Firm' },
  {
    name: 'Credit To Firm',
    required: 'no',
    values: "Y when the originator's origination credit has passed to the firm; implied when Originator is Firm",
  },
  {
    name: 'Stickiness',
    required: 'no',
    values: '1 to 5: 5 Personal bond, 4 Strong, established, 3 Solid but transactional, 2 New / still shallow, 1 Cold',
  },
  { name: 'Cadence', required: 'no', values: 'Daily, Weekly, Monthly, Quarterly or As-Needed' },
  { name: 'Handful', required: 'no', values: 'Y when every interaction is heavy (effort × 1.5)' },
  { name: 'Conflict Risk', required: 'no', values: 'Low, Medium or High' },
  { name: 'Practice Area', required: 'no', values: `one or more of ${PRACTICE_AREAS}, separated by ;` },
  { name: 'Notes', required: 'no', values: 'free text' },
];

const TEMPLATE_URL = `${import.meta.env.BASE_URL}client-book-template.csv`;

// Browsers on Windows often report a CSV as application/vnd.ms-excel.
const isCsvFile = (file) => Boolean(file) && (file.type === 'text/csv' || /\.csv$/i.test(file.name));

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// "2025 ($235,000), 2026 ($290,000)": each year with the total the file writes
// for it (summary.revenueTotals), to compare with the sheet's column sums
const yearsWithTotals = ({ revenueYears = [], revenueTotals = {} }) =>
  revenueYears.length === 0
    ? 'none'
    : revenueYears
      .map((year) => (year in revenueTotals ? `${year} ($${Number(revenueTotals[year]).toLocaleString()})` : `${year}`))
      .join(', ');

// Check file's answer. No updated/new split: before the book is reset it is
// measured against the old book and would mislead.
const readyMessage = (summary) =>
  `The file is ready to import: ${count(summary.totalClients, 'client')}; ` +
  `years ${yearsWithTotals(summary)}; ` +
  `${summary.sheetColumns?.length > 0 ? `columns ${summary.sheetColumns.join(', ')}` : 'no people or judgment columns'}. ` +
  'Nothing was written.';

const CHECK_UNAVAILABLE =
  'Check file is not available: the API has not been deployed with it yet. Nothing was sent and nothing was written.';
const CHECK_IMPORTED =
  'The server imported this file instead of checking it: its API does not have Check file. The book now includes this file.';

const DataUploadManager = () => {
  const [file, setFile] = useState(null);
  // The request in flight: 'check' (Check file, nothing written) or 'upload'
  const [busy, setBusy] = useState(null);
  const isUploading = busy !== null;
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState(null);
  // The server refused the file: { message, errors: [{ row, client, message }] }
  const [refusal, setRefusal] = useState(null);
  
  const { fetchClients } = usePortfolioStore();

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setRefusal(null);
    if (isCsvFile(selectedFile)) {
      setFile(selectedFile);
      setError(null);
      setUploadResult(null);
    } else {
      setError('Please select a valid CSV file');
      setFile(null);
    }
  };

// dryRun: Check file. The server runs every check and every write of the
// import, then rolls them back.
const handleUpload = async (dryRun = false) => {
  if (!file) {
    setError('Please select a file first');
    return;
  }

  setBusy(dryRun ? 'check' : 'upload');
  setError(null);
  setRefusal(null);
  setUploadResult(null);

  // An API older than Check file ignores dryRun and imports the file, so ask
  // /api/health first and send nothing unless it lists check-file.
  if (dryRun) {
    const health = await apiClient.get('/api/health').catch(() => null);
    if (!Array.isArray(health?.features) || !health.features.includes('check-file')) {
      setError(CHECK_UNAVAILABLE);
      setBusy(null);
      return;
    }
  }

  Papa.parse(file, {
    header: true, // Automatically uses the first row as headers
    skipEmptyLines: true,
    // Remove the transform function to let backend handle the parsing
    complete: async (results) => {
      try {
        if (!results.data || results.data.length === 0) {
          throw new Error('CSV file appears to be empty or invalid');
        }

        // Send the clean, parsed data to the backend
        const response = await apiClient.post('/api/data/process-csv', { csvData: results.data, dryRun });

        if (response.success && dryRun && response.dryRun !== true) {
          // The API ignored dryRun and imported the file: never claim otherwise
          await fetchClients();
          setError(CHECK_IMPORTED);
        } else if (response.success && dryRun) {
          setUploadResult({
            success: true,
            dryRun: true,
            message: readyMessage(response.summary),
            validation: response.validation
          });
        } else if (response.success) {
          setUploadResult({
            success: true,
            clientCount: response.clients.length,
            totalRevenue: response.summary.totalRevenue,
            years: yearsWithTotals(response.summary),
            sheetColumns: response.summary.sheetColumns || [],
            validation: response.validation
          });
          await fetchClients(); // Refresh client data in the store
        } else {
          throw new Error('Failed to process CSV data on the backend');
        }
      } catch (err) {
        const body = apiErrorBody(err);
        if (body && Array.isArray(body.errors) && body.errors.length > 0) {
          // The file was refused whole; list every problem by row
          const message = dryRun
            ? `The file is not ready to import: it has ${count(body.errors.length, 'problem')}. Fix the rows below and check it again. Nothing was written.`
            : body.error || 'Nothing was imported.';
          setRefusal({ message, errors: body.errors });
        } else if (body && Array.isArray(body.details) && body.details.length > 0) {
          // The request check's refusal (a row without CLIENT, or a malformed one)
          setError(`${body.error || 'The file was refused'}: ${body.details.map((d) => d.message).join(' ')}`);
        } else {
          console.error('Upload error:', err);
          setError(apiErrorMessage(err, 'Failed to upload and process CSV file'));
        }
      } finally {
        setBusy(null);
      }
    },
    error: (err) => {
      setError(err.message);
      setBusy(null);
    }
  });
};

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Client Data (CSV)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csv-file">Choose CSV File</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={isUploading}
            />
          </div>

          {file && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => handleUpload(true)}
              disabled={!file || isUploading}
              className="sm:flex-1"
            >
              {busy === 'check' ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                  Checking...
                </>
              ) : (
                <>
                  <FileCheck className="h-4 w-4 mr-2" />
                  Check file
                </>
              )}
            </Button>
            <Button
              onClick={() => handleUpload(false)}
              disabled={!file || isUploading}
              className="sm:flex-1"
            >
              {busy === 'upload' ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload and Process CSV
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Check file runs every check the import runs and writes nothing.
          </p>

          {error && (
            <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20" data-testid="upload-error">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  <div>
                    <strong>Error:</strong> {error}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {refusal && (
            <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20" data-testid="import-refusal">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <strong>{refusal.message}</strong>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 px-2 w-16">Row</TableHead>
                      <TableHead className="h-8 px-2">Client</TableHead>
                      <TableHead className="h-8 px-2">Problem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {refusal.errors.map((problem, index) => (
                      <TableRow key={index}>
                        <TableCell className="px-2 py-1.5 align-top tabular-nums">{problem.row}</TableCell>
                        <TableCell className="px-2 py-1.5 align-top">{problem.client || (problem.row === 1 ? 'Header' : '')}</TableCell>
                        <TableCell className="px-2 py-1.5 align-top">{problem.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground">
                  Rows are numbered as in a spreadsheet: the header is row 1.
                </p>
              </CardContent>
            </Card>
          )}

          {uploadResult && uploadResult.success && (
            <Card
              className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
              data-testid={uploadResult.dryRun ? 'check-result' : 'import-result'}
            >
              <CardContent className="pt-4">
                <div className="flex items-start gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    {uploadResult.dryRun ? (
                      <strong>{uploadResult.message}</strong>
                    ) : (
                      <>
                        <strong>Success!</strong> Processed {uploadResult.clientCount} clients with total revenue of ${uploadResult.totalRevenue.toLocaleString()}
                        <div className="text-sm mt-1">
                          Imported years: {uploadResult.years}
                        </div>
                        <div className="text-sm mt-1">
                          {uploadResult.sheetColumns.length > 0
                            ? `Also imported: ${uploadResult.sheetColumns.join(', ')}`
                            : 'No people or judgment columns: those were left as they are.'}
                        </div>
                      </>
                    )}
                    {uploadResult.validation.issues.length > 0 && (
                      <div className="mt-2">
                        <strong>Issues found:</strong>
                        <ul className="list-disc list-inside text-sm mt-1">
                          {uploadResult.validation.issues.map((issue, index) => (
                            <li key={index}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {uploadResult.validation.warnings && uploadResult.validation.warnings.length > 0 && (
                      <div className="mt-2">
                        <strong>Warnings:</strong>
                        <ul className="list-disc list-inside text-sm mt-1">
                          {uploadResult.validation.warnings.map((warning, index) => (
                            <li key={index}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CSV Format Requirements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One header row, then one row per client. Save the sheet as CSV (UTF-8). Headers match regardless of case.
            </p>
            <a
              href={TEMPLATE_URL}
              download="client-book-template.csv"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary underline underline-offset-4"
            >
              <Download className="h-4 w-4" />
              Download template
            </a>
            <p className="text-sm text-muted-foreground">
              The template's two example rows show the format; replace them with your clients before importing, or
              they are added to the book.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 px-2">Column</TableHead>
                  <TableHead className="h-8 px-2">Required</TableHead>
                  <TableHead className="h-8 px-2">Values</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SHEET_COLUMNS.map((column) => (
                  <TableRow key={column.name}>
                    <TableCell className="px-2 py-1.5 align-top whitespace-nowrap">
                      <code className="bg-muted px-2 py-1 rounded text-xs">{column.name}</code>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 align-top whitespace-nowrap text-muted-foreground">{column.required}</TableCell>
                    <TableCell className="px-2 py-1.5 align-top text-muted-foreground">{column.values}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 p-3 bg-muted rounded-lg space-y-3 text-sm text-muted-foreground">
              <p>
                The file is authoritative for exactly the columns it has. A column it lacks leaves that field as it is
                on clients already in the book, so a sheet with only CLIENT, Contract Period and the years updates
                revenue and keeps everyone's people and judgments. A blank cell in a column the file has clears the
                field: no second chair, no originator, no stickiness, Handful off, Conflict Risk back to Medium, no
                practice areas, no notes. Second Chair, Originator and Credit To Firm need a Lead column in the same file.
              </p>
              <p>
                Revenue: a positive amount sets that year for the client, a blank or $0 cell clears it, and years the
                file does not mention are left as they are. Importing a 2026-only sheet updates 2026 and keeps every
                earlier year.
              </p>
              <p>
                Any problem refuses the whole file: a name that is not on the People list, a lead who is not an active
                partner, a second chair who is the lead, a value outside a column's list, or a client named twice.
                Nothing is imported, and every problem is listed by row.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DataUploadManager;