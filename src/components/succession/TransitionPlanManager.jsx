import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
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
  TrendingUp,
  Activity,
  Plus,
  Filter,
  Search,
  Settings,
  Send,
  Edit3,
  ArrowLeft,
  BarChart3,
  Timer,
  Zap,
  Award
} from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';
import { formatClientName } from '../../utils/textUtils';
import { getSuccessionRiskVariant } from '../../utils/successionUtils';

// Task status definitions
const TASK_STATUS = {
  pending: { label: 'Pending', color: 'bg-gray-500', icon: Clock },
  inProgress: { label: 'In Progress', color: 'bg-blue-500', icon: Activity },
  completed: { label: 'Completed', color: 'bg-green-500', icon: CheckCircle },
  overdue: { label: 'Overdue', color: 'bg-red-500', icon: AlertTriangle },
  blocked: { label: 'Blocked', color: 'bg-orange-500', icon: AlertTriangle }
};

// Communication types
const COMMUNICATION_TYPES = {
  email: { label: 'Email', icon: Mail, color: 'text-blue-600' },
  call: { label: 'Phone Call', icon: Phone, color: 'text-green-600' },
  meeting: { label: 'Meeting', icon: Users, color: 'text-purple-600' },
  document: { label: 'Document', icon: FileText, color: 'text-gray-600' }
};

// Transition Gantt Chart Component
const TransitionGantt = ({ transitions, onTaskUpdate, onClientSelect }) => {
  const [viewMode, setViewMode] = useState('month'); // week, month, quarter
  const [selectedClient, setSelectedClient] = useState(null);

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    if (!transitions.length) return { start: new Date(), end: new Date() };
    
    const now = new Date();
    const dates = transitions.flatMap(t => [
      new Date(t.startDate),
      new Date(t.endDate || new Date(Date.now() + t.timelineDays * 24 * 60 * 60 * 1000))
    ]);
    
    return {
      start: new Date(Math.min(now.getTime(), ...dates.map(d => d.getTime()))),
      end: new Date(Math.max(...dates.map(d => d.getTime())))
    };
  }, [transitions]);

  // Generate timeline periods
  const timelinePeriods = useMemo(() => {
    const periods = [];
    const current = new Date(timelineBounds.start);
    const end = timelineBounds.end;
    
    while (current <= end) {
      periods.push(new Date(current));
      if (viewMode === 'week') {
        current.setDate(current.getDate() + 7);
      } else if (viewMode === 'month') {
        current.setMonth(current.getMonth() + 1);
      } else {
        current.setMonth(current.getMonth() + 3);
      }
    }
    
    return periods;
  }, [timelineBounds, viewMode]);

  // Calculate position and width for timeline bars
  const getTimelineBarStyle = useCallback((transition) => {
    const totalDays = (timelineBounds.end - timelineBounds.start) / (24 * 60 * 60 * 1000);
    const startDate = new Date(transition.startDate);
    const endDate = new Date(transition.endDate || new Date(Date.now() + transition.timelineDays * 24 * 60 * 60 * 1000));
    
    const startOffset = (startDate - timelineBounds.start) / (24 * 60 * 60 * 1000);
    const duration = (endDate - startDate) / (24 * 60 * 60 * 1000);
    
    const left = (startOffset / totalDays) * 100;
    const width = (duration / totalDays) * 100;
    
    // Status-based color
    let backgroundColor = '#10b981'; // green
    if (transition.status === 'at-risk') backgroundColor = '#f59e0b'; // orange
    if (transition.status === 'delayed') backgroundColor = '#ef4444'; // red
    if (transition.status === 'completed') backgroundColor = '#059669'; // dark green
    
    return {
      left: `${Math.max(0, left)}%`,
      width: `${Math.min(100 - Math.max(0, left), width)}%`,
      backgroundColor
    };
  }, [timelineBounds]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Transition Timeline
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={viewMode} onValueChange={setViewMode}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Weekly</SelectItem>
                <SelectItem value="month">Monthly</SelectItem>
                <SelectItem value="quarter">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Timeline Header */}
        <div className="mb-4">
          <div className="flex border-b pb-2">
            <div className="w-64 font-medium">Client</div>
            <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${timelinePeriods.length}, 1fr)` }}>
              {timelinePeriods.map((period, index) => (
                <div key={index} className="text-center text-sm font-medium text-gray-600 px-1">
                  {period.toLocaleDateString('en-US', { 
                    month: 'short', 
                    ...(viewMode === 'week' && { day: 'numeric' })
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline Rows */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {transitions.map((transition, index) => (
            <div 
              key={transition.clientId} 
              className={`flex items-center py-2 px-1 rounded hover:bg-gray-50 cursor-pointer ${
                selectedClient === transition.clientId ? 'bg-blue-50 border border-blue-200' : ''
              }`}
              onClick={() => {
                setSelectedClient(transition.clientId);
                onClientSelect?.(transition);
              }}
            >
              <div className="w-64 pr-4">
                <div className="font-medium text-sm">
                  {formatClientName(transition.clientName)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={getSuccessionRiskVariant(transition.successionRisk)} className="text-xs">
                    Risk: {transition.successionRisk}/10
                  </Badge>
                  <Badge 
                    className={`text-xs text-white ${
                      transition.status === 'on-track' ? 'bg-green-500' :
                      transition.status === 'at-risk' ? 'bg-orange-500' :
                      transition.status === 'delayed' ? 'bg-red-500' :
                      'bg-blue-500'
                    }`}
                  >
                    {transition.status}
                  </Badge>
                </div>
              </div>
              
              <div className="flex-1 relative h-8">
                <div 
                  className="absolute top-1 h-6 rounded-sm opacity-80 hover:opacity-100 transition-opacity flex items-center px-2"
                  style={getTimelineBarStyle(transition)}
                >
                  <span className="text-xs text-white font-medium truncate">
                    {transition.successorPartner}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {transitions.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No active transitions to display</p>
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span>On Track</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-500 rounded"></div>
            <span>At Risk</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span>Delayed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500 rounded"></div>
            <span>In Progress</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Task Assignment Panel Component
const TaskAssignmentPanel = ({ tasks, assignees, onCreateTask, onUpdateTask, onAssignTask }) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    assignee: '',
    dueDate: '',
    priority: 'medium',
    clientId: '',
    category: 'communication'
  });
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const statusMatch = filterStatus === 'all' || task.status === filterStatus;
      const assigneeMatch = filterAssignee === 'all' || task.assignee === filterAssignee;
      return statusMatch && assigneeMatch;
    });
  }, [tasks, filterStatus, filterAssignee]);

  const handleCreateTask = () => {
    if (newTask.title && newTask.assignee && newTask.dueDate) {
      onCreateTask({
        ...newTask,
        id: Date.now().toString(),
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      setNewTask({
        title: '',
        description: '',
        assignee: '',
        dueDate: '',
        priority: 'medium',
        clientId: '',
        category: 'communication'
      });
      setShowCreateForm(false);
    }
  };

  const getTaskPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'border-red-500 bg-red-50';
      case 'medium': return 'border-yellow-500 bg-yellow-50';
      case 'low': return 'border-green-500 bg-green-50';
      default: return 'border-gray-300 bg-gray-50';
    }
  };

  const isOverdue = (dueDate) => {
    return new Date(dueDate) < new Date();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Task Management
          </CardTitle>
          <Button onClick={() => setShowCreateForm(!showCreateForm)}>
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-4">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="inProgress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={filterAssignee} onValueChange={setFilterAssignee}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {assignees.map(assignee => (
                <SelectItem key={assignee.id} value={assignee.name}>
                  {assignee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Create Task Form */}
        {showCreateForm && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="task-title">Task Title</Label>
                  <Input
                    id="task-title"
                    value={newTask.title}
                    onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                    placeholder="Enter task title"
                  />
                </div>
                <div>
                  <Label htmlFor="task-assignee">Assignee</Label>
                  <Select value={newTask.assignee} onValueChange={(value) => setNewTask({...newTask, assignee: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select assignee" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignees.map(assignee => (
                        <SelectItem key={assignee.id} value={assignee.name}>
                          {assignee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="task-due-date">Due Date</Label>
                  <Input
                    id="task-due-date"
                    type="date"
                    value={newTask.dueDate}
                    onChange={(e) => setNewTask({...newTask, dueDate: e.target.value})}
                  />
                </div>
                <div>
                  <Label htmlFor="task-priority">Priority</Label>
                  <Select value={newTask.priority} onValueChange={(value) => setNewTask({...newTask, priority: value})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="task-description">Description</Label>
                <Textarea
                  id="task-description"
                  value={newTask.description}
                  onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                  placeholder="Task description..."
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreateTask}>Create Task</Button>
                <Button variant="outline" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Task List */}
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {filteredTasks.map(task => {
            const StatusIcon = TASK_STATUS[task.status]?.icon || Clock;
            const isTaskOverdue = task.status !== 'completed' && isOverdue(task.dueDate);
            
            return (
              <Card key={task.id} className={`${getTaskPriorityColor(task.priority)} ${isTaskOverdue ? 'border-red-500' : ''}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Checkbox
                          checked={task.status === 'completed'}
                          onCheckedChange={(checked) => 
                            onUpdateTask(task.id, { status: checked ? 'completed' : 'pending' })
                          }
                        />
                        <h4 className={`font-medium ${task.status === 'completed' ? 'line-through text-gray-500' : ''}`}>
                          {task.title}
                        </h4>
                        <Badge 
                          className={`text-xs text-white ${TASK_STATUS[task.status]?.color || 'bg-gray-500'}`}
                        >
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {TASK_STATUS[task.status]?.label || 'Unknown'}
                        </Badge>
                        {isTaskOverdue && (
                          <Badge variant="destructive" className="text-xs">
                            Overdue
                          </Badge>
                        )}
                      </div>
                      
                      {task.description && (
                        <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {task.assignee}
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(task.dueDate).toLocaleDateString()}
                        </div>
                        {task.clientId && (
                          <div className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            Client Task
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => {}}>
                        <Edit3 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredTasks.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Target className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No tasks match your filters</p>
          </div>
        )}

        {/* Task Summary */}
        <div className="grid grid-cols-4 gap-4 pt-4 border-t">
          {Object.entries(TASK_STATUS).map(([status, config]) => {
            const count = tasks.filter(task => task.status === status).length;
            const Icon = config.icon;
            
            return (
              <div key={status} className="text-center">
                <div className="flex items-center justify-center mb-1">
                  <Icon className="h-4 w-4 mr-1" />
                  <span className="font-semibold">{count}</span>
                </div>
                <div className="text-xs text-gray-600">{config.label}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

// Progress Dashboard Component
const ProgressDashboard = ({ metrics, alerts, onDismissAlert }) => {
  const kpis = [
    {
      label: 'Overall Success Rate',
      value: `${metrics.successRate || 0}%`,
      trend: metrics.successRateTrend || 0,
      icon: Award,
      color: 'text-green-600'
    },
    {
      label: 'Client Retention',
      value: `${metrics.retentionRate || 0}%`,
      trend: metrics.retentionTrend || 0,
      icon: Users,
      color: 'text-blue-600'
    },
    {
      label: 'Avg Transition Time',
      value: `${metrics.avgTransitionDays || 0} days`,
      trend: metrics.transitionTimeTrend || 0,
      icon: Timer,
      color: 'text-purple-600'
    },
    {
      label: 'At-Risk Transitions',
      value: `${metrics.atRiskCount || 0}`,
      trend: metrics.riskTrend || 0,
      icon: AlertTriangle,
      color: 'text-red-600'
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Success Metrics Dashboard
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpis.map((kpi, index) => {
            const Icon = kpi.icon;
            const isPositiveTrend = kpi.trend > 0;
            
            return (
              <Card key={index}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <Icon className={`h-5 w-5 ${kpi.color}`} />
                    {kpi.trend !== 0 && (
                      <div className={`flex items-center text-xs ${isPositiveTrend ? 'text-green-600' : 'text-red-600'}`}>
                        <TrendingUp className={`h-3 w-3 mr-1 ${!isPositiveTrend ? 'rotate-180' : ''}`} />
                        {Math.abs(kpi.trend)}%
                      </div>
                    )}
                  </div>
                  <div className="text-2xl font-bold mb-1">{kpi.value}</div>
                  <div className="text-xs text-gray-600">{kpi.label}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Progress Chart Placeholder */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-medium">Transition Progress Overview</h4>
              <Select defaultValue="30days">
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7days">Last 7 days</SelectItem>
                  <SelectItem value="30days">Last 30 days</SelectItem>
                  <SelectItem value="90days">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Simple progress bars for each status */}
            <div className="space-y-3">
              {[
                { label: 'Completed', value: metrics.completedTransitions || 0, max: metrics.totalTransitions || 1, color: 'bg-green-500' },
                { label: 'In Progress', value: metrics.inProgressTransitions || 0, max: metrics.totalTransitions || 1, color: 'bg-blue-500' },
                { label: 'At Risk', value: metrics.atRiskTransitions || 0, max: metrics.totalTransitions || 1, color: 'bg-orange-500' },
                { label: 'Delayed', value: metrics.delayedTransitions || 0, max: metrics.totalTransitions || 1, color: 'bg-red-500' }
              ].map((item, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{item.label}</span>
                    <span>{item.value}/{item.max}</span>
                  </div>
                  <Progress 
                    value={(item.value / item.max) * 100} 
                    className="h-2"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Alerts Section */}
        {alerts && alerts.length > 0 && (
          <Card className="border-orange-200 bg-orange-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-orange-800">
                <AlertTriangle className="h-5 w-5" />
                Active Alerts ({alerts.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alerts.map((alert, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-white rounded border">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className={`h-4 w-4 ${
                        alert.severity === 'high' ? 'text-red-500' :
                        alert.severity === 'medium' ? 'text-orange-500' : 'text-yellow-500'
                      }`} />
                      <div>
                        <div className="font-medium text-sm">{alert.title}</div>
                        <div className="text-xs text-gray-600">{alert.description}</div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => onDismissAlert(alert.id)}
                    >
                      Dismiss
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
};

// Communication Log Component
const CommunicationLog = ({ communications, onAddCommunication, clientId }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newComm, setNewComm] = useState({
    type: 'email',
    subject: '',
    content: '',
    date: new Date().toISOString().split('T')[0],
    outcome: 'positive'
  });

  const handleAddCommunication = () => {
    if (newComm.subject && newComm.content) {
      onAddCommunication({
        ...newComm,
        id: Date.now().toString(),
        clientId,
        timestamp: new Date().toISOString()
      });
      setNewComm({
        type: 'email',
        subject: '',
        content: '',
        date: new Date().toISOString().split('T')[0],
        outcome: 'positive'
      });
      setShowAddForm(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Communication Log
          </CardTitle>
          <Button onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="h-4 w-4 mr-2" />
            Log Communication
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Communication Form */}
        {showAddForm && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Communication Type</Label>
                  <Select value={newComm.type} onValueChange={(value) => setNewComm({...newComm, type: value})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(COMMUNICATION_TYPES).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <config.icon className="h-4 w-4" />
                            {config.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={newComm.date}
                    onChange={(e) => setNewComm({...newComm, date: e.target.value})}
                  />
                </div>
              </div>
              <div>
                <Label>Subject/Topic</Label>
                <Input
                  value={newComm.subject}
                  onChange={(e) => setNewComm({...newComm, subject: e.target.value})}
                  placeholder="Communication subject"
                />
              </div>
              <div>
                <Label>Content/Notes</Label>
                <Textarea
                  value={newComm.content}
                  onChange={(e) => setNewComm({...newComm, content: e.target.value})}
                  placeholder="Communication details and client response..."
                  rows={4}
                />
              </div>
              <div>
                <Label>Outcome</Label>
                <Select value={newComm.outcome} onValueChange={(value) => setNewComm({...newComm, outcome: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">Positive</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="negative">Negative</SelectItem>
                    <SelectItem value="no-response">No Response</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddCommunication}>Add Communication</Button>
                <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Communication History */}
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {communications.map(comm => {
            const CommIcon = COMMUNICATION_TYPES[comm.type]?.icon || MessageSquare;
            
            return (
              <div key={comm.id} className="border rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 mb-2">
                    <CommIcon className={`h-4 w-4 ${COMMUNICATION_TYPES[comm.type]?.color || 'text-gray-600'}`} />
                    <div>
                      <div className="font-medium text-sm">{comm.subject}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(comm.date).toLocaleDateString()} - {COMMUNICATION_TYPES[comm.type]?.label}
                      </div>
                    </div>
                  </div>
                  <Badge variant={
                    comm.outcome === 'positive' ? 'default' :
                    comm.outcome === 'negative' ? 'destructive' : 'secondary'
                  }>
                    {comm.outcome}
                  </Badge>
                </div>
                <p className="text-sm text-gray-700 mt-2">{comm.content}</p>
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

// Main Transition Plan Manager Component
const TransitionPlanManager = ({ stage2Data, onBackToStage2 }) => {
  const { partners } = usePortfolioStore();
  const [activeTab, setActiveTab] = useState('timeline');
  const [selectedTransition, setSelectedTransition] = useState(null);
  
  // Mock data - in real implementation this would come from the store
  const [transitions, setTransitions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [communications, setCommunications] = useState([]);
  const [alerts, setAlerts] = useState([
    {
      id: 1,
      title: 'High-risk client communication overdue',
      description: 'ClientCorp transition - no communication in 5 days',
      severity: 'high'
    },
    {
      id: 2,
      title: 'Task deadline approaching',
      description: '3 tasks due within next 2 days',
      severity: 'medium'
    }
  ]);

  // Initialize transitions from stage2Data
  useEffect(() => {
    if (stage2Data?.transitionPlans && Object.keys(stage2Data.transitionPlans).length > 0) {
      const approvedPlans = Object.entries(stage2Data.transitionPlans)
        .filter(([_, plan]) => plan.status === 'approved')
        .map(([clientId, plan]) => {
          const client = stage2Data.affectedClients?.find(c => c.id === clientId);
          return {
            clientId,
            clientName: client?.name || 'Unknown Client',
            successionRisk: client?.successionRisk || 5,
            successorPartner: plan.successorPartner || 'TBD',
            timelineDays: plan.timelineDays || 30,
            startDate: new Date().toISOString().split('T')[0],
            endDate: new Date(Date.now() + (plan.timelineDays || 30) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: 'in-progress',
            progress: 0,
            tasks: plan.tasks || []
          };
        });
      
      setTransitions(approvedPlans);
      
      // Generate initial tasks
      const initialTasks = approvedPlans.flatMap(transition => 
        transition.tasks.map((taskTitle, index) => ({
          id: `${transition.clientId}-${index}`,
          title: taskTitle,
          description: `Task for ${transition.clientName}`,
          assignee: transition.successorPartner,
          dueDate: new Date(Date.now() + (index + 1) * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          priority: index === 0 ? 'high' : 'medium',
          status: 'pending',
          clientId: transition.clientId,
          category: 'communication'
        }))
      );
      
      setTasks(initialTasks);
    }
  }, [stage2Data]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalTransitions = transitions.length;
    const completedTransitions = transitions.filter(t => t.status === 'completed').length;
    const inProgressTransitions = transitions.filter(t => t.status === 'in-progress').length;
    const atRiskTransitions = transitions.filter(t => t.status === 'at-risk').length;
    const delayedTransitions = transitions.filter(t => t.status === 'delayed').length;
    
    return {
      totalTransitions,
      completedTransitions,
      inProgressTransitions,
      atRiskTransitions,
      delayedTransitions,
      successRate: totalTransitions > 0 ? Math.round((completedTransitions / totalTransitions) * 100) : 0,
      retentionRate: 95, // Mock data
      avgTransitionDays: 45, // Mock data
      atRiskCount: atRiskTransitions,
      successRateTrend: 5,
      retentionTrend: 2,
      transitionTimeTrend: -3,
      riskTrend: -1
    };
  }, [transitions]);

  const handleCreateTask = (task) => {
    setTasks(prev => [...prev, task]);
  };

  const handleUpdateTask = (taskId, updates) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId ? { ...task, ...updates } : task
    ));
  };

  const handleAddCommunication = (communication) => {
    setCommunications(prev => [...prev, communication]);
  };

  const handleDismissAlert = (alertId) => {
    setAlerts(prev => prev.filter(alert => alert.id !== alertId));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-purple-200 bg-purple-50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-purple-800">Stage 3: Transition Plan Execution</h3>
              <p className="text-sm text-purple-600">
                Manage {transitions.length} active transitions with timeline tracking and task management
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-700">{transitions.filter(t => t.status === 'completed').length}</div>
                <div className="text-xs text-purple-600">Completed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-700">{transitions.filter(t => t.status === 'in-progress').length}</div>
                <div className="text-xs text-blue-600">In Progress</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-700">{transitions.filter(t => t.status === 'at-risk').length}</div>
                <div className="text-xs text-orange-600">At Risk</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="timeline">Timeline & Gantt</TabsTrigger>
          <TabsTrigger value="tasks">Task Management</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="dashboard">Success Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <TransitionGantt
            transitions={transitions}
            onTaskUpdate={handleUpdateTask}
            onClientSelect={setSelectedTransition}
          />
          
          {selectedTransition && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {formatClientName(selectedTransition.clientName)} - Transition Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Successor Partner</Label>
                    <div className="font-medium">{selectedTransition.successorPartner}</div>
                  </div>
                  <div>
                    <Label>Timeline</Label>
                    <div className="font-medium">{selectedTransition.timelineDays} days</div>
                  </div>
                  <div>
                    <Label>Progress</Label>
                    <Progress value={selectedTransition.progress || 0} className="mt-1" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <TaskAssignmentPanel
            tasks={tasks}
            assignees={partners}
            onCreateTask={handleCreateTask}
            onUpdateTask={handleUpdateTask}
            onAssignTask={(taskId, assignee) => handleUpdateTask(taskId, { assignee })}
          />
        </TabsContent>

        <TabsContent value="communications" className="space-y-4">
          <CommunicationLog
            communications={communications}
            onAddCommunication={handleAddCommunication}
            clientId={selectedTransition?.clientId}
          />
        </TabsContent>

        <TabsContent value="dashboard" className="space-y-4">
          <ProgressDashboard
            metrics={metrics}
            alerts={alerts}
            onDismissAlert={handleDismissAlert}
          />
        </TabsContent>
      </Tabs>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBackToStage2}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Client Review
        </Button>
        
        <div className="text-sm text-gray-600">
          End-to-end succession planning workflow complete
        </div>
      </div>
    </div>
  );
};

export default TransitionPlanManager;