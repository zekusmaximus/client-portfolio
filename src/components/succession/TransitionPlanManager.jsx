import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Calendar,
  Clock,
  Users,
  CheckCircle,
  AlertTriangle,
  MessageSquare,
  Phone,
  Mail,
  FileText,
  Target,
  Activity,
  Plus,
  ArrowLeft,
  BarChart3
} from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';
import { formatClientName } from '../../utils/textUtils';
import { getSuccessionRiskVariant } from '../../utils/successionUtils';
import { executionSummary } from '../../utils/transitionPlans';
import TransitionSheetPanel from './TransitionSheetPanel';

// Stage 3 (docs/plans/people-and-second-chair.md, Phase 5): the approved
// plans under way. Everything shown is what the plans hold or what a partner
// recorded here: the new lead and second chair, the plan's timeline (none
// when the plan has none), the plan's action items, statuses and
// communications. No retention rate, no average duration, no sample alerts.
// The transitions live in the store (P11), so switching tabs keeps them.

const TRANSITION_STATUS = {
  'in-progress': { label: 'In progress', color: 'bg-blue-500' },
  'at-risk': { label: 'At risk', color: 'bg-orange-500' },
  delayed: { label: 'Delayed', color: 'bg-red-500' },
  completed: { label: 'Completed', color: 'bg-green-600' }
};

const TASK_STATUS = {
  pending: { label: 'Pending', color: 'bg-gray-500', icon: Clock },
  inProgress: { label: 'In Progress', color: 'bg-blue-500', icon: Activity },
  completed: { label: 'Completed', color: 'bg-green-500', icon: CheckCircle },
  blocked: { label: 'Blocked', color: 'bg-orange-500', icon: AlertTriangle }
};

const COMMUNICATION_TYPES = {
  email: { label: 'Email', icon: Mail, color: 'text-blue-600' },
  call: { label: 'Phone Call', icon: Phone, color: 'text-green-600' },
  meeting: { label: 'Meeting', icon: Users, color: 'text-purple-600' },
  document: { label: 'Document', icon: FileText, color: 'text-gray-600' }
};

const today = () => new Date().toISOString().split('T')[0];
const dayMs = 24 * 60 * 60 * 1000;
const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—');

// Each transition's seats and dates; a bar only where the plan has a timeline
const TransitionTimeline = ({ transitions, onStatusChange }) => {
  const dated = transitions.filter((t) => t.endDate);
  const start = dated.length ? Math.min(...dated.map((t) => Date.parse(t.startDate))) : 0;
  const end = dated.length ? Math.max(...dated.map((t) => Date.parse(t.endDate))) : 0;
  const span = Math.max(end - start, dayMs);
  const bar = (t) => ({
    left: `${((Date.parse(t.startDate) - start) / span) * 100}%`,
    width: `${Math.max(((Date.parse(t.endDate) - Date.parse(t.startDate)) / span) * 100, 2)}%`
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />Transitions</CardTitle>
        <p className="text-sm text-muted-foreground">
          Each approved client&apos;s new lead and second chair. Dates start when the plan entered this stage; an end
          date appears only when the plan has a timeline.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Second chair</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead className="w-[25%]">Schedule</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transitions.map((t) => (
              <TableRow key={t.clientId}>
                <TableCell>
                  <div className="font-medium">{formatClientName(t.clientName)}</div>
                  {t.successionRisk !== null && t.successionRisk !== undefined && (
                    <Badge variant={getSuccessionRiskVariant(t.successionRisk)} className="text-xs">Risk: {t.successionRisk}/10</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{t.lead}</div>
                  {t.leadBefore && <div className="text-xs text-muted-foreground">was {t.leadBefore}</div>}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{t.secondChair || 'none'}</div>
                  {t.secondChairBefore && <div className="text-xs text-muted-foreground">was {t.secondChairBefore}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{shortDate(t.startDate)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {t.timelineDays ? `${t.timelineDays} days, to ${shortDate(t.endDate)}` : 'not set'}
                </TableCell>
                <TableCell>
                  {t.endDate ? (
                    <div className="relative h-4 rounded bg-gray-100">
                      <div className={`absolute top-0 h-4 rounded ${TRANSITION_STATUS[t.status]?.color || 'bg-blue-500'}`} style={bar(t)} />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">no timeline in the plan</span>
                  )}
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={`Status of ${t.clientName}`}
                    className="w-36"
                    value={t.status}
                    onChange={(e) => onStatusChange(t.clientId, e.target.value)}
                  >
                    {Object.entries(TRANSITION_STATUS).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
                  </NativeSelect>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {transitions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No approved plans. Approve clients in Stage 2.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const emptyTask = { title: '', description: '', assignee: '', dueDate: '', priority: 'medium', clientId: '' };

// The plans' action items, owned by the new lead, and any task a partner adds;
// a due date only once someone sets one
const TaskPanel = ({ tasks, assignees, transitions, onCreateTask, onUpdateTask }) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTask, setNewTask] = useState(emptyTask);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const now = today();
  const clientName = (id) => transitions.find((t) => t.clientId === id)?.clientName;

  const filtered = tasks.filter((task) =>
    (filterStatus === 'all' || task.status === filterStatus) &&
    (filterAssignee === 'all' || task.assignee === filterAssignee));

  const handleCreate = () => {
    if (!newTask.title) return;
    onCreateTask({ ...newTask, id: `task-${Date.now()}`, status: 'pending', createdAt: new Date().toISOString() });
    setNewTask(emptyTask);
    setShowCreateForm(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" />Tasks</CardTitle>
          <Button onClick={() => setShowCreateForm(!showCreateForm)}><Plus className="h-4 w-4 mr-2" />New Task</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <NativeSelect aria-label="Filter by status" className="w-40" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(TASK_STATUS).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Filter by assignee" className="w-40" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
            <option value="all">Everyone</option>
            {assignees.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </NativeSelect>
        </div>

        {showCreateForm && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="task-title">Task</Label>
                  <Input id="task-title" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="task-client">Client</Label>
                  <NativeSelect id="task-client" value={newTask.clientId} onChange={(e) => setNewTask({ ...newTask, clientId: e.target.value })}>
                    <option value="">No client</option>
                    {transitions.map((t) => <option key={t.clientId} value={t.clientId}>{t.clientName}</option>)}
                  </NativeSelect>
                </div>
                <div>
                  <Label htmlFor="task-assignee">Assignee</Label>
                  <NativeSelect id="task-assignee" value={newTask.assignee} onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })}>
                    <option value="">Nobody yet</option>
                    {assignees.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </NativeSelect>
                </div>
                <div>
                  <Label htmlFor="task-due-date">Due date (optional)</Label>
                  <Input id="task-due-date" type="date" value={newTask.dueDate} onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="task-description">Notes</Label>
                <Textarea id="task-description" rows={2} value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={!newTask.title}>Create Task</Button>
                <Button variant="outline" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-2 max-h-[28rem] overflow-y-auto">
          {filtered.map((task) => {
            const overdue = task.status !== 'completed' && task.dueDate && task.dueDate < now;
            return (
              <div key={task.id} className={`rounded-lg border p-3 ${overdue ? 'border-red-400' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox
                    aria-label={`Done: ${task.title}`}
                    checked={task.status === 'completed'}
                    onCheckedChange={(checked) => onUpdateTask(task.id, { status: checked ? 'completed' : 'pending' })}
                  />
                  <span className={`font-medium ${task.status === 'completed' ? 'line-through text-gray-500' : ''}`}>{task.title}</span>
                  <Badge className={`text-xs text-white ${TASK_STATUS[task.status]?.color || 'bg-gray-500'}`}>
                    {TASK_STATUS[task.status]?.label || task.status}
                  </Badge>
                  {overdue && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                  {task.clientId && <span>{formatClientName(clientName(task.clientId) || '')}</span>}
                  <NativeSelect
                    aria-label={`Assignee of ${task.title}`}
                    className="h-8 w-36 py-1 text-xs"
                    value={task.assignee || ''}
                    onChange={(e) => onUpdateTask(task.id, { assignee: e.target.value })}
                  >
                    <option value="">Nobody yet</option>
                    {task.assignee && !assignees.some((p) => p.name === task.assignee) && <option value={task.assignee}>{task.assignee}</option>}
                    {assignees.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </NativeSelect>
                  <Input
                    aria-label={`Due date of ${task.title}`}
                    type="date"
                    className="h-8 w-40 py-1 text-xs"
                    value={task.dueDate || ''}
                    onChange={(e) => onUpdateTask(task.id, { dueDate: e.target.value })}
                  />
                </div>
                {task.description && <p className="mt-1 text-sm text-gray-600">{task.description}</p>}
              </div>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Target className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>{tasks.length === 0 ? 'No tasks: the approved plans have no action items yet.' : 'No tasks match your filters.'}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const emptyCommunication = () => ({ type: 'email', subject: '', content: '', date: today(), outcome: 'positive', clientId: '' });

const CommunicationLog = ({ communications, transitions, onAddCommunication }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState(emptyCommunication);
  const clientName = (id) => transitions.find((t) => t.clientId === id)?.clientName;

  const handleAdd = () => {
    if (!draft.subject || !draft.content) return;
    onAddCommunication({ ...draft, id: `comm-${Date.now()}`, timestamp: new Date().toISOString() });
    setDraft(emptyCommunication());
    setShowAddForm(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />Communication Log</CardTitle>
          <Button onClick={() => setShowAddForm(!showAddForm)}><Plus className="h-4 w-4 mr-2" />Log Communication</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAddForm && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="comm-client">Client</Label>
                  <NativeSelect id="comm-client" value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
                    <option value="">No client</option>
                    {transitions.map((t) => <option key={t.clientId} value={t.clientId}>{t.clientName}</option>)}
                  </NativeSelect>
                </div>
                <div>
                  <Label htmlFor="comm-type">Type</Label>
                  <NativeSelect id="comm-type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                    {Object.entries(COMMUNICATION_TYPES).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
                  </NativeSelect>
                </div>
                <div>
                  <Label htmlFor="comm-date">Date</Label>
                  <Input id="comm-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="comm-subject">Subject</Label>
                <Input id="comm-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="comm-content">Notes</Label>
                <Textarea id="comm-content" rows={3} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="comm-outcome">Outcome</Label>
                <NativeSelect id="comm-outcome" value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                  <option value="no-response">No Response</option>
                </NativeSelect>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAdd} disabled={!draft.subject || !draft.content}>Add Communication</Button>
                <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3 max-h-80 overflow-y-auto">
          {communications.map((comm) => {
            const CommIcon = COMMUNICATION_TYPES[comm.type]?.icon || MessageSquare;
            return (
              <div key={comm.id} className="border rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 mb-2">
                    <CommIcon className={`h-4 w-4 ${COMMUNICATION_TYPES[comm.type]?.color || 'text-gray-600'}`} />
                    <div>
                      <div className="font-medium text-sm">{comm.subject}</div>
                      <div className="text-xs text-gray-500">
                        {shortDate(comm.date)} · {COMMUNICATION_TYPES[comm.type]?.label}
                        {comm.clientId && ` · ${formatClientName(clientName(comm.clientId) || '')}`}
                      </div>
                    </div>
                  </div>
                  <Badge variant={comm.outcome === 'positive' ? 'default' : comm.outcome === 'negative' ? 'destructive' : 'secondary'}>
                    {comm.outcome}
                  </Badge>
                </div>
                <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{comm.content}</p>
              </div>
            );
          })}
        </div>
        {communications.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No communications logged yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Counts of what is recorded, nothing projected
const ProgressSummary = ({ summary }) => {
  const tiles = [
    ['Transitions', summary.totalTransitions],
    ['Completed', summary.completedTransitions],
    ['In progress', summary.inProgressTransitions],
    ['At risk', summary.atRiskTransitions],
    ['Delayed', summary.delayedTransitions],
    ['Tasks done', `${summary.completedTasks} of ${summary.totalTasks}`],
    ['Overdue tasks', summary.overdueTasks]
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Progress</CardTitle>
        <p className="text-sm text-muted-foreground">
          Counts of the statuses, tasks and due dates recorded on this page. A task is overdue only once someone gives it
          a due date.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

const TransitionPlanManager = ({ departure, people, onBackToStage2 }) => {
  const transitions = usePortfolioStore((s) => s.activeTransitions);
  const tasks = usePortfolioStore((s) => s.transitionTasks);
  const communications = usePortfolioStore((s) => s.communicationLog);
  const plans = usePortfolioStore((s) => s.transitionPlans);
  const updateTransition = usePortfolioStore((s) => s.updateTransition);
  const addTransitionTask = usePortfolioStore((s) => s.addTransitionTask);
  const updateTransitionTask = usePortfolioStore((s) => s.updateTransitionTask);
  const addCommunication = usePortfolioStore((s) => s.addCommunication);
  const [activeTab, setActiveTab] = useState('timeline');

  // Tasks go to the people who are staying
  const assignees = useMemo(() => {
    const leaving = new Set(departure.departing.map((p) => String(p.id)));
    return people.filter((p) => p.active && !leaving.has(String(p.id))).sort((a, b) => a.name.localeCompare(b.name));
  }, [people, departure]);
  const summary = executionSummary(transitions, tasks, today());

  return (
    <div className="space-y-6">
      <Card className="border-purple-200 bg-purple-50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-purple-800">Stage 3: Transition Plan Execution</h3>
              <p className="text-sm text-purple-600">
                {summary.totalTransitions} approved {summary.totalTransitions === 1 ? 'transition' : 'transitions'}: the new seats,
                the plans&apos; tasks and your notes
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-700">{summary.completedTransitions}</div>
                <div className="text-xs text-purple-600">Completed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-700">{summary.inProgressTransitions}</div>
                <div className="text-xs text-blue-600">In Progress</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-700">{summary.atRiskTransitions}</div>
                <div className="text-xs text-orange-600">At Risk</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="timeline">Transitions</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="dashboard">Progress</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <TransitionTimeline transitions={transitions} onStatusChange={(id, status) => updateTransition(id, { status })} />
        </TabsContent>
        <TabsContent value="tasks" className="space-y-4">
          <TaskPanel
            tasks={tasks}
            assignees={assignees}
            transitions={transitions}
            onCreateTask={addTransitionTask}
            onUpdateTask={updateTransitionTask}
          />
        </TabsContent>
        <TabsContent value="communications" className="space-y-4">
          <CommunicationLog communications={communications} transitions={transitions} onAddCommunication={addCommunication} />
        </TabsContent>
        <TabsContent value="dashboard" className="space-y-4">
          <ProgressSummary summary={summary} />
        </TabsContent>
      </Tabs>

      <TransitionSheetPanel departure={departure} plans={plans} />

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBackToStage2}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Client Review
        </Button>
      </div>
    </div>
  );
};

export default TransitionPlanManager;
