import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  Users,
  CheckCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  Edit3,
  MessageSquare,
  Calendar,
  Filter,
  Search,
  Settings,
  Bot,
  Loader2,
  ChevronDown,
  ChevronRight,
  Target,
  FileText,
  Send
} from 'lucide-react';
import usePortfolioStore from '../../portfolioStore';
import { formatClientName } from '../../utils/textUtils';
import { 
  getSuccessionRiskVariant, 
  getRelationshipTypeColor, 
  groupClientsBySuccessionRisk 
} from '../../utils/successionUtils';

// Priority levels for transition planning
const PRIORITY_LEVELS = {
  critical: { label: 'Critical', color: 'bg-red-500', priority: 1 },
  high: { label: 'High', color: 'bg-orange-500', priority: 2 },
  medium: { label: 'Medium', color: 'bg-yellow-500', priority: 3 },
  low: { label: 'Low', color: 'bg-green-500', priority: 4 }
};

// Transition status options
const TRANSITION_STATUS = {
  pending: { label: 'Pending Review', color: 'bg-gray-500' },
  planned: { label: 'Plan Generated', color: 'bg-blue-500' },
  approved: { label: 'Approved', color: 'bg-green-500' },
  rejected: { label: 'Needs Revision', color: 'bg-red-500' },
  inProgress: { label: 'In Progress', color: 'bg-purple-500' },
  completed: { label: 'Completed', color: 'bg-green-600' }
};

// Bulk Action Bar Component
const BulkActionBar = ({ selectedClients, onGeneratePlans, onAssignSuccessor, onSetTimeline, onApproveAll, onClearSelection, isGeneratingPlans }) => {
  const [successorPartner, setSuccessorPartner] = useState('');
  const [bulkTimeline, setBulkTimeline] = useState(30);
  const { partners } = usePortfolioStore();

  if (selectedClients.length === 0) return null;

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="font-medium text-blue-900">
              {selectedClients.length} clients selected
            </div>
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              Clear Selection
            </Button>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Generate Plans Button */}
            <Button 
              onClick={() => onGeneratePlans(selectedClients)}
              disabled={isGeneratingPlans}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isGeneratingPlans ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4 mr-2" />
                  Generate AI Plans
                </>
              )}
            </Button>

            {/* Assign Successor */}
            <div className="flex items-center gap-2">
              <Label htmlFor="bulk-successor" className="text-sm">Successor:</Label>
              <Select value={successorPartner} onValueChange={setSuccessorPartner}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Select partner" />
                </SelectTrigger>
                <SelectContent>
                  {partners.map(partner => (
                    <SelectItem key={partner.id} value={partner.name}>
                      {partner.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onAssignSuccessor(selectedClients, successorPartner)}
                disabled={!successorPartner}
              >
                Assign
              </Button>
            </div>

            {/* Set Timeline */}
            <div className="flex items-center gap-2">
              <Label htmlFor="bulk-timeline" className="text-sm">Timeline:</Label>
              <Input
                id="bulk-timeline"
                type="number"
                value={bulkTimeline}
                onChange={(e) => setBulkTimeline(Number(e.target.value))}
                className="w-20"
                min="1"
                max="365"
              />
              <span className="text-sm text-gray-600">days</span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onSetTimeline(selectedClients, bulkTimeline)}
              >
                Apply
              </Button>
            </div>

            {/* Approve All */}
            <Button 
              onClick={() => onApproveAll(selectedClients)}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Approve All
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Transition Plan Card Component
const TransitionPlanCard = ({ client, plan, onUpdatePlan, onApprovePlan, onRejectPlan, isExpanded, onToggleExpanded }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState(plan);

  const handleSavePlan = () => {
    onUpdatePlan(client.id, editedPlan);
    setIsEditing(false);
  };

  const getStatusBadge = (status) => {
    const statusConfig = TRANSITION_STATUS[status] || TRANSITION_STATUS.pending;
    return (
      <Badge className={`${statusConfig.color} text-white`}>
        {statusConfig.label}
      </Badge>
    );
  };

  const getPriorityBadge = (priority) => {
    const priorityConfig = PRIORITY_LEVELS[priority] || PRIORITY_LEVELS.medium;
    return (
      <Badge className={`${priorityConfig.color} text-white`}>
        {priorityConfig.label} Priority
      </Badge>
    );
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggleExpanded(client.id)}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
            <div>
              <CardTitle className="text-lg">{formatClientName(client.name)}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                {getStatusBadge(plan?.status || 'pending')}
                {getPriorityBadge(plan?.priority || 'medium')}
                <Badge variant={getSuccessionRiskVariant(client.successionRisk)}>
                  Risk: {client.successionRisk}/10
                </Badge>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            {plan && plan.status !== 'approved' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onApprovePlan(client.id)}
                  className="text-green-600 border-green-600 hover:bg-green-50"
                >
                  <CheckCircle className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRejectPlan(client.id)}
                  className="text-red-600 border-red-600 hover:bg-red-50"
                >
                  <AlertTriangle className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {/* Client Summary */}
          <div className="grid grid-cols-3 gap-4 p-3 bg-gray-50 rounded-lg">
            <div>
              <Label className="text-sm font-medium">Annual Revenue</Label>
              <div className="font-semibold">
                ${usePortfolioStore.getState().getClientRevenue(client).toLocaleString()}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Relationship Type</Label>
              <Badge 
                variant="outline"
                className={getRelationshipTypeColor(client.relationshipType)}
              >
                {client.relationshipType?.toUpperCase()}
              </Badge>
            </div>
            <div>
              <Label className="text-sm font-medium">Current Partner</Label>
              <div className="font-medium">{client.primary_lobbyist || 'Unassigned'}</div>
            </div>
          </div>

          {/* Transition Plan Content */}
          {plan ? (
            <div className="space-y-4">
              {isEditing ? (
                // Edit Mode
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="successor">Successor Partner</Label>
                    <Select 
                      value={editedPlan.successorPartner} 
                      onValueChange={(value) => setEditedPlan({...editedPlan, successorPartner: value})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select successor partner" />
                      </SelectTrigger>
                      <SelectContent>
                        {usePortfolioStore.getState().partners.map(partner => (
                          <SelectItem key={partner.id} value={partner.name}>
                            {partner.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="timeline">Transition Timeline (days)</Label>
                    <Input
                      type="number"
                      value={editedPlan.timelineDays}
                      onChange={(e) => setEditedPlan({...editedPlan, timelineDays: Number(e.target.value)})}
                      min="1"
                      max="365"
                    />
                  </div>

                  <div>
                    <Label htmlFor="strategy">Transition Strategy</Label>
                    <Textarea
                      value={editedPlan.strategy}
                      onChange={(e) => setEditedPlan({...editedPlan, strategy: e.target.value})}
                      rows={3}
                      placeholder="Describe the transition approach..."
                    />
                  </div>

                  <div>
                    <Label htmlFor="risks">Key Risks & Mitigation</Label>
                    <Textarea
                      value={editedPlan.risks}
                      onChange={(e) => setEditedPlan({...editedPlan, risks: e.target.value})}
                      rows={3}
                      placeholder="Identify risks and mitigation strategies..."
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={handleSavePlan}>
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                    </Button>
                    <Button variant="outline" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                // View Mode
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium">Successor Partner</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Users className="h-4 w-4 text-blue-500" />
                        <span className="font-medium">{plan.successorPartner || 'TBD'}</span>
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Timeline</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Calendar className="h-4 w-4 text-green-500" />
                        <span className="font-medium">{plan.timelineDays} days</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Transition Strategy</Label>
                    <div className="mt-1 p-3 bg-gray-50 rounded-lg text-sm">
                      {plan.strategy || 'No strategy defined yet.'}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Key Risks & Mitigation</Label>
                    <div className="mt-1 p-3 bg-gray-50 rounded-lg text-sm">
                      {plan.risks || 'No risks identified yet.'}
                    </div>
                  </div>

                  {plan.tasks && plan.tasks.length > 0 && (
                    <div>
                      <Label className="text-sm font-medium">Action Items</Label>
                      <div className="mt-1 space-y-2">
                        {plan.tasks.map((task, index) => (
                          <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                            <Checkbox />
                            <span className="text-sm">{task}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {plan.communicationTemplate && (
                    <div>
                      <Label className="text-sm font-medium">Client Communication Template</Label>
                      <div className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-blue-800">Email Draft</span>
                          <Button size="sm" variant="outline">
                            <Send className="h-4 w-4 mr-1" />
                            Use Template
                          </Button>
                        </div>
                        <div className="text-sm text-gray-700 whitespace-pre-wrap">
                          {plan.communicationTemplate}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            // No Plan Generated Yet
            <div className="text-center py-8 text-gray-500">
              <Bot className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No transition plan generated yet.</p>
              <p className="text-sm">Select this client and use "Generate AI Plans" to create a plan.</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};

// Client Triage Grid Component
const ClientTriageGrid = ({ clients, filters, selectedClients, onSelectClient, onSelectAll, transitionPlans, onUpdatePlan, onApprovePlan, onRejectPlan }) => {
  const [expandedClients, setExpandedClients] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredClients = useMemo(() => {
    return clients.filter(client => {
      const matchesSearch = formatClientName(client.name).toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRisk = riskFilter === 'all' || 
        (riskFilter === 'low' && client.successionRisk <= 3) ||
        (riskFilter === 'medium' && client.successionRisk > 3 && client.successionRisk <= 6) ||
        (riskFilter === 'high' && client.successionRisk > 6);
      
      const plan = transitionPlans[client.id];
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'no-plan' && !plan) ||
        (plan && plan.status === statusFilter);

      return matchesSearch && matchesRisk && matchesStatus;
    });
  }, [clients, searchTerm, riskFilter, statusFilter, transitionPlans]);

  const toggleExpanded = (clientId) => {
    const newExpanded = new Set(expandedClients);
    if (newExpanded.has(clientId)) {
      newExpanded.delete(clientId);
    } else {
      newExpanded.add(clientId);
    }
    setExpandedClients(newExpanded);
  };

  const allFilteredSelected = filteredClients.length > 0 && filteredClients.every(client => selectedClients.includes(client.id));

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search clients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Risk Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk Levels</SelectItem>
                <SelectItem value="high">High Risk (7-10)</SelectItem>
                <SelectItem value="medium">Medium Risk (4-6)</SelectItem>
                <SelectItem value="low">Low Risk (1-3)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Plan Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="no-plan">No Plan</SelectItem>
                <SelectItem value="pending">Pending Review</SelectItem>
                <SelectItem value="planned">Plan Generated</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Needs Revision</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Select All Header */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={allFilteredSelected}
                onCheckedChange={(checked) => {
                  if (checked) {
                    onSelectAll(filteredClients.map(c => c.id));
                  } else {
                    onSelectAll([]);
                  }
                }}
              />
              <span className="font-medium">
                {filteredClients.length} clients 
                {selectedClients.length > 0 && ` (${selectedClients.length} selected)`}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpandedClients(new Set(filteredClients.map(c => c.id)))}
              >
                Expand All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpandedClients(new Set())}
              >
                Collapse All
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Client Cards */}
      <div className="space-y-2">
        {filteredClients.map(client => (
          <div key={client.id} className="relative">
            <div className="absolute left-4 top-6 z-10">
              <Checkbox
                checked={selectedClients.includes(client.id)}
                onCheckedChange={(checked) => onSelectClient(client.id, checked)}
              />
            </div>
            <div className="ml-8">
              <TransitionPlanCard
                client={client}
                plan={transitionPlans[client.id]}
                onUpdatePlan={onUpdatePlan}
                onApprovePlan={onApprovePlan}
                onRejectPlan={onRejectPlan}
                isExpanded={expandedClients.has(client.id)}
                onToggleExpanded={toggleExpanded}
              />
            </div>
          </div>
        ))}
      </div>

      {filteredClients.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <h3 className="font-medium text-gray-700 mb-2">No clients match your filters</h3>
            <p className="text-gray-500">Try adjusting your search or filter criteria.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

// Main Client Review Interface Component
const ClientReviewInterface = ({ stage1Data, onProceedToStage3, onBackToStage1 }) => {
  const [selectedClients, setSelectedClients] = useState([]);
  const [transitionPlans, setTransitionPlans] = useState({});
  const [isGeneratingPlans, setIsGeneratingPlans] = useState(false);
  const [activeTab, setActiveTab] = useState('triage');

  // Extract clients from stage1Data
  const affectedClients = stage1Data?.affectedClients || [];

  // Group clients by risk level
  const riskGroups = groupClientsBySuccessionRisk(affectedClients);

  const handleSelectClient = (clientId, checked) => {
    setSelectedClients(prev => 
      checked 
        ? [...prev, clientId]
        : prev.filter(id => id !== clientId)
    );
  };

  const handleSelectAll = (clientIds) => {
    setSelectedClients(clientIds);
  };

  const handleClearSelection = () => {
    setSelectedClients([]);
  };

  const handleGeneratePlans = async (clients) => {
    setIsGeneratingPlans(true);
    try {
      // Call API to generate transition plans
      const response = await fetch('/api/scenarios/bulk-transition-plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          clients: clients.map(id => affectedClients.find(c => c.id === id)),
          stage1Data
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.plans) {
          const newPlans = { ...transitionPlans };
          data.plans.forEach(plan => {
            newPlans[plan.clientId] = { ...plan, status: 'planned' };
          });
          setTransitionPlans(newPlans);
        }
      }
    } catch (error) {
      console.error('Error generating plans:', error);
    } finally {
      setIsGeneratingPlans(false);
    }
  };

  const handleAssignSuccessor = (clientIds, successorPartner) => {
    const updatedPlans = { ...transitionPlans };
    clientIds.forEach(clientId => {
      if (updatedPlans[clientId]) {
        updatedPlans[clientId].successorPartner = successorPartner;
      } else {
        updatedPlans[clientId] = {
          clientId,
          successorPartner,
          status: 'pending',
          priority: 'medium',
          timelineDays: 30
        };
      }
    });
    setTransitionPlans(updatedPlans);
  };

  const handleSetTimeline = (clientIds, timelineDays) => {
    const updatedPlans = { ...transitionPlans };
    clientIds.forEach(clientId => {
      if (updatedPlans[clientId]) {
        updatedPlans[clientId].timelineDays = timelineDays;
      } else {
        updatedPlans[clientId] = {
          clientId,
          status: 'pending',
          priority: 'medium',
          timelineDays
        };
      }
    });
    setTransitionPlans(updatedPlans);
  };

  const handleApproveAll = (clientIds) => {
    const updatedPlans = { ...transitionPlans };
    clientIds.forEach(clientId => {
      if (updatedPlans[clientId]) {
        updatedPlans[clientId].status = 'approved';
      }
    });
    setTransitionPlans(updatedPlans);
  };

  const handleUpdatePlan = (clientId, updatedPlan) => {
    setTransitionPlans(prev => ({
      ...prev,
      [clientId]: updatedPlan
    }));
  };

  const handleApprovePlan = (clientId) => {
    setTransitionPlans(prev => ({
      ...prev,
      [clientId]: { ...prev[clientId], status: 'approved' }
    }));
  };

  const handleRejectPlan = (clientId) => {
    setTransitionPlans(prev => ({
      ...prev,
      [clientId]: { ...prev[clientId], status: 'rejected' }
    }));
  };

  const approvedPlansCount = Object.values(transitionPlans).filter(plan => plan.status === 'approved').length;
  const canProceed = approvedPlansCount > 0;

  return (
    <div className="space-y-6">
      {/* Progress Summary */}
      <Card className="border-green-200 bg-green-50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-green-800">Stage 2: Client Review & Triage</h3>
              <p className="text-sm text-green-600">
                Review and approve transition plans for {affectedClients.length} affected clients
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-700">{approvedPlansCount}</div>
                <div className="text-xs text-green-600">Plans Approved</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-700">{Object.keys(transitionPlans).length}</div>
                <div className="text-xs text-blue-600">Plans Generated</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedClients={selectedClients}
        onGeneratePlans={handleGeneratePlans}
        onAssignSuccessor={handleAssignSuccessor}
        onSetTimeline={handleSetTimeline}
        onApproveAll={handleApproveAll}
        onClearSelection={handleClearSelection}
        isGeneratingPlans={isGeneratingPlans}
      />

      {/* Main Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="triage">Client Triage ({affectedClients.length})</TabsTrigger>
          <TabsTrigger value="summary">Risk Summary</TabsTrigger>
          <TabsTrigger value="progress">Progress Tracking</TabsTrigger>
        </TabsList>

        <TabsContent value="triage" className="space-y-4">
          <ClientTriageGrid
            clients={affectedClients}
            selectedClients={selectedClients}
            onSelectClient={handleSelectClient}
            onSelectAll={handleSelectAll}
            transitionPlans={transitionPlans}
            onUpdatePlan={handleUpdatePlan}
            onApprovePlan={handleApprovePlan}
            onRejectPlan={handleRejectPlan}
          />
        </TabsContent>

        <TabsContent value="summary" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(riskGroups).map(([riskLevel, clients]) => (
              <Card key={riskLevel}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${
                      riskLevel === 'high' ? 'bg-red-500' :
                      riskLevel === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                    }`} />
                    {riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)} Risk
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold mb-2">{clients.length}</div>
                  <div className="text-sm text-gray-600">
                    {Object.values(transitionPlans).filter(plan => 
                      clients.some(c => c.id === plan.clientId) && plan.status === 'approved'
                    ).length} approved
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="progress" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Transition Plan Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(TRANSITION_STATUS).map(([status, config]) => {
                  const count = Object.values(transitionPlans).filter(plan => plan.status === status).length;
                  return (
                    <div key={status} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Badge className={`${config.color} text-white`}>
                          {config.label}
                        </Badge>
                      </div>
                      <div className="font-semibold">{count} clients</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBackToStage1}>
          <ArrowRight className="h-4 w-4 mr-2 rotate-180" />
          Back to Impact Analysis
        </Button>
        
        <Button 
          onClick={() => onProceedToStage3(transitionPlans)}
          disabled={!canProceed}
          className="bg-blue-600 hover:bg-blue-700"
        >
          Proceed to Implementation
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
};

export default ClientReviewInterface;