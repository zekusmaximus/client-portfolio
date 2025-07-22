import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Calendar, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import usePortfolioStore from '../portfolioStore';

// Custom hook for localStorage with error handling
const useLocalStorage = (key, initialValue) => {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      if (typeof window === 'undefined') return initialValue;
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      setStoredValue(value);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue];
};

// Utility functions
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const isOverdue = (dueDate) => {
  return new Date(dueDate) < new Date();
};

const formatDate = (date) => {
  if (!date) return 'No due date';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const TransitionChecklist = ({ assignments, clients }) => {
  const { partners } = usePortfolioStore();
  const [tasks, setTasks] = useLocalStorage('transition-tasks', {});
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now());

  // Generate standardized tasks for each client transition
  const generateTasks = (clientId, fromPartner, toPartner, client) => {
    const clientName = client?.name || 'Unknown Client';
    const baseId = `${clientId}_${Date.now()}`;
    
    return [
      {
        id: `${baseId}_notify`,
        type: 'notification',
        clientId,
        clientName,
        description: `Notify ${clientName} of partner transition from ${fromPartner} to ${toPartner}`,
        dueDate: addDays(new Date(), 3).toISOString(),
        completed: false,
        priority: client?.strategic_value > 7 ? 'high' : 'normal',
        createdAt: new Date().toISOString()
      },
      {
        id: `${baseId}_handoff`,
        type: 'handoff',
        clientId,
        clientName,
        description: `Conduct handoff meeting between ${fromPartner} and ${toPartner}`,
        dueDate: addDays(new Date(), 7).toISOString(),
        completed: false,
        priority: 'high',
        createdAt: new Date().toISOString()
      },
      {
        id: `${baseId}_files`,
        type: 'documentation',
        clientId,
        clientName,
        description: `Transfer client files and documentation for ${clientName}`,
        dueDate: addDays(new Date(), 5).toISOString(),
        completed: false,
        priority: 'normal',
        createdAt: new Date().toISOString()
      },
      {
        id: `${baseId}_intro`,
        type: 'relationship',
        clientId,
        clientName,
        description: `Schedule introduction meeting between ${clientName} and ${toPartner}`,
        dueDate: addDays(new Date(), 10).toISOString(),
        completed: false,
        priority: client?.strategic_value > 7 ? 'high' : 'normal',
        createdAt: new Date().toISOString()
      },
      {
        id: `${baseId}_followup`,
        type: 'relationship', 
        clientId,
        clientName,
        description: `30-day follow-up call with ${clientName} to ensure smooth transition`,
        dueDate: addDays(new Date(), 40).toISOString(),
        completed: false,
        priority: 'normal',
        createdAt: new Date().toISOString()
      }
    ];
  };

  // Initialize and update tasks based on assignments
  useEffect(() => {
    if (!assignments || !clients || !partners) return;
    
    const assignmentEntries = Object.entries(assignments);
    if (assignmentEntries.length === 0) return;

    const existingTaskClients = new Set(
      Object.values(tasks).map(task => task.clientId).filter(Boolean)
    );

    const newTasks = {};
    let hasNewTasks = false;

    assignmentEntries.forEach(([clientId, newPartnerId]) => {
      // Skip if we already have tasks for this client
      if (existingTaskClients.has(clientId)) return;

      const client = clients.find(c => c?.id === clientId);
      const fromPartner = partners.find(p => p?.clients?.includes(clientId));
      const toPartner = partners.find(p => p?.id === newPartnerId);

      if (fromPartner && toPartner && client) {
        const clientTasks = generateTasks(
          clientId, 
          fromPartner.name, 
          toPartner.name, 
          client
        );
        
        clientTasks.forEach(task => {
          newTasks[task.id] = task;
          hasNewTasks = true;
        });
      }
    });

    if (hasNewTasks) {
      setTasks(prev => ({ ...prev, ...newTasks }));
      setLastUpdateTime(Date.now());
    }
  }, [assignments, clients, partners, setTasks]);

  // Toggle task completion
  const toggleTask = (taskId) => {
    setTasks(prev => ({
      ...prev,
      [taskId]: { 
        ...prev[taskId], 
        completed: !prev[taskId]?.completed,
        completedAt: !prev[taskId]?.completed ? new Date().toISOString() : null
      }
    }));
  };

  // Clear completed tasks
  const clearCompletedTasks = () => {
    const incompleteTasks = Object.fromEntries(
      Object.entries(tasks).filter(([_, task]) => !task.completed)
    );
    setTasks(incompleteTasks);
  };

  // Reset all tasks
  const resetAllTasks = () => {
    if (window.confirm('Are you sure you want to reset all tasks? This cannot be undone.')) {
      setTasks({});
    }
  };

  // Organize tasks by type and calculate metrics
  const taskData = useMemo(() => {
    const allTasks = Object.values(tasks);
    
    // Group by type
    const tasksByType = allTasks.reduce((acc, task) => {
      if (!task || !task.type) return acc;
      if (!acc[task.type]) acc[task.type] = [];
      acc[task.type].push(task);
      return acc;
    }, {});

    // Calculate metrics
    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter(t => t?.completed).length;
    const overdueTasks = allTasks.filter(t => !t?.completed && isOverdue(t?.dueDate)).length;
    const highPriorityTasks = allTasks.filter(t => t?.priority === 'high' && !t?.completed).length;
    
    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return {
      tasksByType,
      totalTasks,
      completedTasks,
      overdueTasks,
      highPriorityTasks,
      completionRate
    };
  }, [tasks]);

  // Get task type display info
  const getTypeInfo = (type) => {
    switch (type) {
      case 'notification':
        return { 
          label: 'Client Notifications', 
          icon: AlertTriangle, 
          color: 'text-blue-600',
          description: 'Inform clients about transition'
        };
      case 'handoff':
        return { 
          label: 'Partner Handoffs', 
          icon: RefreshCw, 
          color: 'text-green-600',
          description: 'Knowledge transfer meetings'
        };
      case 'documentation':
        return { 
          label: 'Documentation', 
          icon: Calendar, 
          color: 'text-orange-600',
          description: 'File and record transfers'
        };
      case 'relationship':
        return { 
          label: 'Relationship Building', 
          icon: CheckCircle, 
          color: 'text-purple-600',
          description: 'Client relationship activities'
        };
      default:
        return { 
          label: 'Other Tasks', 
          icon: Clock, 
          color: 'text-gray-600',
          description: 'Miscellaneous tasks'
        };
    }
  };

  // Render task item
  const TaskItem = ({ task }) => {
    const isTaskOverdue = !task.completed && isOverdue(task.dueDate);
    
    return (
      <div 
        className={`flex items-start space-x-3 p-3 rounded-lg border transition-colors ${
          task.completed 
            ? 'bg-gray-50 border-gray-200' 
            : isTaskOverdue 
              ? 'bg-red-50 border-red-200' 
              : 'bg-white border-gray-300'
        }`}
      >
        <Checkbox
          checked={task.completed}
          onCheckedChange={() => toggleTask(task.id)}
          className="mt-1"
        />
        
        <div className="flex-1 space-y-1">
          <div className="flex items-start justify-between">
            <p className={`text-sm ${task.completed ? 'line-through text-gray-500' : 'text-gray-900'}`}>
              {task.description}
            </p>
            <div className="flex items-center gap-2 ml-2">
              {task.priority === 'high' && !task.completed && (
                <Badge variant="destructive" className="text-xs">High Priority</Badge>
              )}
              {isTaskOverdue && (
                <Badge variant="destructive" className="text-xs">Overdue</Badge>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>Due: {formatDate(task.dueDate)}</span>
            </div>
            {task.clientName && (
              <div>Client: {task.clientName}</div>
            )}
            {task.completed && task.completedAt && (
              <div className="text-green-600">
                ✓ Completed {formatDate(task.completedAt)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (taskData.totalTasks === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transition Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500 space-y-2">
            <CheckCircle className="h-12 w-12 mx-auto text-gray-400" />
            <p>No transition tasks yet</p>
            <p className="text-sm">Tasks will appear automatically when you assign clients to partners</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Transition Checklist
            {taskData.overdueTasks > 0 && (
              <Badge variant="destructive" className="text-xs">
                {taskData.overdueTasks} Overdue
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={clearCompletedTasks}
              disabled={taskData.completedTasks === 0}
            >
              Clear Completed
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={resetAllTasks}
            >
              Reset All
            </Button>
          </div>
        </div>
        
        <div className="space-y-2">
          <Progress value={taskData.completionRate} className="h-2" />
          <div className="flex justify-between text-sm text-gray-600">
            <span>{Math.round(taskData.completionRate)}% Complete</span>
            <span>{taskData.completedTasks} of {taskData.totalTasks} tasks done</span>
          </div>
        </div>
        
        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-4 pt-2">
          <div className="text-center">
            <div className="text-lg font-bold text-blue-600">{taskData.totalTasks}</div>
            <div className="text-xs text-gray-600">Total Tasks</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-orange-600">{taskData.highPriorityTasks}</div>
            <div className="text-xs text-gray-600">High Priority</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-red-600">{taskData.overdueTasks}</div>
            <div className="text-xs text-gray-600">Overdue</div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <Tabs defaultValue="notification">
          <TabsList className="grid w-full grid-cols-4">
            {Object.keys(taskData.tasksByType).map(type => {
              const typeInfo = getTypeInfo(type);
              const typeTaskCount = taskData.tasksByType[type].length;
              const completedCount = taskData.tasksByType[type].filter(t => t.completed).length;
              
              return (
                <TabsTrigger key={type} value={type} className="text-xs">
                  <div className="flex flex-col items-center gap-1">
                    <typeInfo.icon className={`h-4 w-4 ${typeInfo.color}`} />
                    <span>{typeInfo.label}</span>
                    <Badge variant="secondary" className="text-xs">
                      {completedCount}/{typeTaskCount}
                    </Badge>
                  </div>
                </TabsTrigger>
              );
            })}
          </TabsList>
          
          {Object.entries(taskData.tasksByType).map(([type, typeTasks]) => {
            const typeInfo = getTypeInfo(type);
            
            return (
              <TabsContent key={type} value={type} className="space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <typeInfo.icon className={`h-5 w-5 ${typeInfo.color}`} />
                  <div>
                    <h3 className="font-medium">{typeInfo.label}</h3>
                    <p className="text-sm text-gray-600">{typeInfo.description}</p>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {typeTasks
                    .sort((a, b) => {
                      // Sort by: incomplete first, then by due date, then by priority
                      if (a.completed !== b.completed) return a.completed ? 1 : -1;
                      if (new Date(a.dueDate) !== new Date(b.dueDate)) {
                        return new Date(a.dueDate) - new Date(b.dueDate);
                      }
                      if (a.priority !== b.priority) {
                        return a.priority === 'high' ? -1 : 1;
                      }
                      return 0;
                    })
                    .map(task => (
                      <TaskItem key={task.id} task={task} />
                    ))}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default TransitionChecklist;