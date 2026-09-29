import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilePlus, FolderOpen, Loader2, Save, Trash2 } from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';
import { apiErrorBody, apiErrorMessage, apiErrorStatus } from '../../api';
import { firmTime } from '../../utils/clientHistory';
import { LIMITS, scenarioDirty } from '../../utils/scenarioState';

// Saved Scenarios (docs/plans/tier-2.md, S12, WP8): the open scenario's name
// and whether it has unsaved changes, New, Open (the saved list, with
// Delete), Save and Save as. Shown only when /api/health lists
// saved-scenarios; without it Scenarios works in the browser only, as
// before. Every partner can open, save and delete every scenario (P2). A
// scenario holds what partners entered; opening one re-derives the rest from
// the book as it is now (src/utils/scenarioState.js, openState).

const STAGE_LABELS = {
  impact: 'Stage 1: Impact Analysis',
  mitigation: 'Stage 2: Client Review',
  implementation: 'Stage 3: Execution'
};

const UNSAVED_PROMPT = 'The open scenario has unsaved changes, which will be lost. Continue?';

const leavingText = (leaving = []) =>
  leaving.map((p) => p.name ?? 'someone no longer on the People list').join(', ') || 'nobody yet';

// A refused save's message: the details a 400 lists, or the server's error
const saveErrorText = (err) => {
  const body = apiErrorBody(err);
  if (apiErrorStatus(err) === 400 && Array.isArray(body?.details) && body.details.length > 0) {
    return `Not saved: ${body.details.map((d) => d.message).join(' ')}`;
  }
  return apiErrorMessage(err, 'The scenario could not be saved.');
};

const ScenarioBar = () => {
  const savedScenario = usePortfolioStore((s) => s.savedScenario);
  const notices = usePortfolioStore((s) => s.scenarioNotices);
  const list = usePortfolioStore((s) => s.scenarioList);
  const dirty = usePortfolioStore(scenarioDirty);
  const fetchScenarios = usePortfolioStore((s) => s.fetchScenarios);
  const openScenario = usePortfolioStore((s) => s.openScenario);
  const saveScenario = usePortfolioStore((s) => s.saveScenario);
  const deleteScenario = usePortfolioStore((s) => s.deleteScenario);
  const newScenario = usePortfolioStore((s) => s.newScenario);
  const dismissScenarioNotices = usePortfolioStore((s) => s.dismissScenarioNotices);

  const [showList, setShowList] = useState(false);
  // Naming a scenario to save as new: the draft name, or null
  const [nameDraft, setNameDraft] = useState(null);
  const [busy, setBusy] = useState(null); // 'save', 'open' or 'delete' while one runs
  // { tone: 'error' | 'info', text, conflict, missing } after an action
  const [message, setMessage] = useState(null);

  const confirmLeaving = () => !dirty || window.confirm(UNSAVED_PROMPT);

  const handleNew = () => {
    if (!confirmLeaving()) return;
    newScenario();
    setNameDraft(null);
    setMessage(null);
  };

  const toggleList = () => {
    if (!showList) fetchScenarios();
    setShowList(!showList);
  };

  const handleOpen = async (id) => {
    if (!confirmLeaving()) return;
    setBusy('open');
    setMessage(null);
    try {
      const scenario = await openScenario(id);
      setShowList(false);
      setNameDraft(null);
      setMessage({ tone: 'info', text: `Opened "${scenario.name}" on the book as it is now.` });
    } catch (err) {
      setMessage({ tone: 'error', text: apiErrorStatus(err) === 404 ? 'That scenario was deleted by another partner.' : apiErrorMessage(err, 'The scenario could not be opened.') });
      if (apiErrorStatus(err) === 404) fetchScenarios();
    } finally {
      setBusy(null);
    }
  };

  const runSave = async (options) => {
    setBusy('save');
    setMessage(null);
    try {
      const scenario = await saveScenario(options);
      setNameDraft(null);
      setMessage({ tone: 'info', text: `Saved "${scenario.name}".` });
    } catch (err) {
      const status = apiErrorStatus(err);
      if (status === 409) {
        setMessage({ tone: 'error', text: apiErrorMessage(err), conflict: true });
      } else if (status === 404) {
        setMessage({ tone: 'error', text: 'This scenario was deleted by another partner, so nothing was saved. Use Save as to keep what is on screen.', missing: true });
      } else {
        setMessage({ tone: 'error', text: saveErrorText(err) });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleSave = () => {
    if (savedScenario) runSave({});
    else setNameDraft('');
  };
  const handleSaveAs = () => setNameDraft(savedScenario ? `${savedScenario.name} (copy)`.slice(0, LIMITS.name) : '');
  const submitName = (event) => {
    event.preventDefault();
    const name = (nameDraft || '').trim();
    if (!name) {
      setMessage({ tone: 'error', text: 'Give the scenario a name.' });
      return;
    }
    runSave({ name, asNew: true });
  };

  const handleDelete = async (item) => {
    const open = item.id === savedScenario?.id;
    if (!window.confirm(`Delete the saved scenario "${item.name}"? Every partner loses it; the book is not changed.${open ? ' What is on screen stays, as a scenario not saved yet.' : ''}`)) return;
    setBusy('delete');
    setMessage(null);
    try {
      await deleteScenario(item.id);
      setMessage({ tone: 'info', text: `Deleted "${item.name}".` });
    } catch (err) {
      setMessage({ tone: 'error', text: apiErrorMessage(err, 'The scenario could not be deleted.') });
      fetchScenarios();
    } finally {
      setBusy(null);
    }
  };

  const savedLine = savedScenario
    ? `Saved by ${savedScenario.updated_by_username || 'a former account'} on ${firmTime(savedScenario.updated_at)}.`
    : 'Not saved yet.';

  return (
    <Card data-testid="scenario-bar">
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium" data-testid="scenario-name">{savedScenario ? savedScenario.name : 'New scenario'}</span>
              {dirty && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Unsaved changes</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {savedLine} Saved scenarios are shared: every partner can open, save and delete them.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleNew} disabled={!!busy}>
              <FilePlus className="h-4 w-4 mr-2" />New
            </Button>
            <Button variant="outline" size="sm" onClick={toggleList} disabled={!!busy} aria-expanded={showList}>
              <FolderOpen className="h-4 w-4 mr-2" />Open
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!!busy || !dirty}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save
            </Button>
            <Button variant="outline" size="sm" onClick={handleSaveAs} disabled={!!busy}>
              Save as
            </Button>
          </div>
        </div>

        {nameDraft !== null && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={submitName}>
            <div className="min-w-[240px] flex-1 space-y-1">
              <Label htmlFor="scenario-name-input">Scenario name</Label>
              <Input
                id="scenario-name-input"
                value={nameDraft}
                maxLength={LIMITS.name}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="For example: Kevin retires in 2027"
              />
            </div>
            <Button type="submit" size="sm" disabled={!!busy}>Save as new scenario</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setNameDraft(null)}>Cancel</Button>
          </form>
        )}

        {message && (
          <Alert variant={message.tone === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>
              <p>{message.text}</p>
              {(message.conflict || message.missing) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.conflict && (
                    <Button size="sm" variant="outline" onClick={() => handleOpen(savedScenario.id)}>
                      Open the saved version
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={handleSaveAs}>
                    Save as a new scenario
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {notices.length > 0 && (
          <Alert>
            <AlertDescription>
              <p className="font-medium">Opened on the book as it is now:</p>
              <ul className="mt-1 list-disc pl-5 space-y-1">
                {notices.map((notice) => <li key={notice}>{notice}</li>)}
              </ul>
              <button type="button" className="mt-2 text-xs text-blue-700 underline" onClick={dismissScenarioNotices}>
                Dismiss
              </button>
            </AlertDescription>
          </Alert>
        )}

        {showList && (
          <div className="rounded-lg border">
            {list.loading && !list.loaded ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />Loading the saved scenarios…
              </div>
            ) : list.error ? (
              <p className="p-4 text-sm text-red-700">{list.error}</p>
            ) : list.items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No saved scenarios yet. Build one below and use Save.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scenario</TableHead>
                    <TableHead>Leaving</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Last saved</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.items.map((item) => (
                    <TableRow key={item.id} data-scenario-row={item.name}>
                      <TableCell className="font-medium">
                        {item.name}
                        {item.id === savedScenario?.id && <span className="ml-2 text-xs text-muted-foreground">(open)</span>}
                      </TableCell>
                      <TableCell className="text-sm">{leavingText(item.leaving)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{STAGE_LABELS[item.current_stage] || item.current_stage}</TableCell>
                      <TableCell className="text-sm">
                        {item.updated_by_username || 'a former account'}, {firmTime(item.updated_at)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="outline" onClick={() => handleOpen(item.id)} disabled={!!busy}>
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-1 text-red-700"
                          aria-label={`Delete ${item.name}`}
                          onClick={() => handleDelete(item)}
                          disabled={!!busy}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ScenarioBar;
