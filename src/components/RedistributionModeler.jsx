import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Brain, AlertTriangle } from 'lucide-react';
import usePortfolioStore from '../portfolioStore';

const RedistributionModeler = ({ model, onModelChange, onRequestAI, aiLoading }) => {
  const {
    partners,
    partnershipTransition,
    calculateRedistribution,
    setCustomAssignment,
    updatePartnershipTransition,
    getClientRevenue
  } = usePortfolioStore();

  const [selectedClient, setSelectedClient] = useState(null);

  // Calculate redistribution preview
  const redistributionPreview = useMemo(() => {
    return calculateRedistribution(model);
  }, [model, partners, partnershipTransition, calculateRedistribution]);

  const departingPartners = partners.filter(p => p.isDeparting);
  const remainingPartners = partners.filter(p => !p.isDeparting);

  const departingClients = useMemo(() => {
    if (!departingPartners?.length) return [];
    
    return departingPartners.flatMap(partner => 
      (partner.clients || []).map(clientId => {
        const client = usePortfolioStore.getState().getClientById(clientId);
        return client ? { ...client, originalPartner: partner.name } : null;
      }).filter(Boolean)
    );
  }, [departingPartners]);

  const formatRevenue = (revenue) => {
    if (revenue >= 1000000) return `$${(revenue / 1000000).toFixed(1)}M`;
    if (revenue >= 1000) return `$${(revenue / 1000).toFixed(0)}K`;
    return `$${revenue.toFixed(0)}`;
  };

  const handleModelChange = (newModel) => {
    onModelChange(newModel);
    updatePartnershipTransition({ redistributionModel: newModel });
  };

  const handleClientSelect = (client) => {
    if (model === 'custom') {
      setSelectedClient(client);
    }
  };

  const handlePartnerAssign = (partnerId) => {
    if (selectedClient && model === 'custom') {
      setCustomAssignment(selectedClient.id, partnerId);
      setSelectedClient(null);
    }
  };

  const getCapacityWarning = (partner) => {
    const newCapacity = partner.currentCapacity + (partner.assignedClients.length / 15 * 100);
    return newCapacity > 100;
  };

  if (departingPartners.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Client Redistribution Strategy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No partners marked as departing. Click on partner cards to mark them as departing and model redistribution.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client Redistribution Strategy</CardTitle>
        <div className="text-sm text-gray-600">
          {departingPartners.length} departing partner(s) • {departingClients.length} clients to redistribute
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Model Selection */}
        <div className="space-y-3">
          <Label className="text-base font-medium">Redistribution Model</Label>
          <RadioGroup value={model} onValueChange={handleModelChange}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="balanced" id="balanced" />
              <Label htmlFor="balanced">Balanced Revenue - Distribute clients to equalize revenue across partners</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="expertise" id="expertise" />
              <Label htmlFor="expertise">Practice Area Expertise - Match clients with partners by practice area</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="relationship" id="relationship" />
              <Label htmlFor="relationship">Existing Relationships - Assign to partners already in client teams</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="custom" id="custom" />
              <Label htmlFor="custom">Custom Assignment - Manual client-by-client assignment</Label>
            </div>
          </RadioGroup>
        </div>

        {/* Preview Section */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Redistribution Preview</h3>
          
          {redistributionPreview.length === 0 ? (
            <div className="text-gray-500 text-center py-4">
              {model === 'custom' ? 'Make custom assignments below to see preview' : 'No redistribution calculated'}
            </div>
          ) : (
            <div className="grid gap-3">
              {redistributionPreview.map((assignment) => (
                <div key={assignment.partnerId} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-medium">{assignment.partnerName}</h4>
                      <div className="text-sm text-gray-600">
                        +{assignment.assignedClients.length} clients • {formatRevenue(assignment.targetRevenue)} revenue
                      </div>
                    </div>
                    {getCapacityWarning(assignment) && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Over Capacity
                      </Badge>
                    )}
                  </div>
                  
                  {assignment.assignedClients.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {assignment.assignedClients.slice(0, 5).map((client, index) => (
                        <Badge key={client.id || index} variant="outline" className="text-xs">
                          {client.name}
                        </Badge>
                      ))}
                      {assignment.assignedClients.length > 5 && (
                        <Badge variant="outline" className="text-xs">
                          +{assignment.assignedClients.length - 5} more
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Custom Assignment UI */}
        {model === 'custom' && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Custom Assignments</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Departing Clients */}
              <div>
                <h4 className="font-medium mb-3">Departing Clients</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {departingClients.map((client) => {
                    const isAssigned = partnershipTransition.customAssignments[client.id];
                    const assignedPartner = isAssigned ? 
                      remainingPartners.find(p => p.id === isAssigned) : null;
                    
                    return (
                      <div
                        key={client.id}
                        className={`p-3 border rounded cursor-pointer transition-colors ${
                          selectedClient?.id === client.id 
                            ? 'border-blue-500 bg-blue-50' 
                            : isAssigned 
                              ? 'border-green-500 bg-green-50'
                              : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => handleClientSelect(client)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-sm">{client.name}</div>
                            <div className="text-xs text-gray-600">
                              {formatRevenue(getClientRevenue(client))} • {client.originalPartner}
                            </div>
                          </div>
                          {isAssigned && (
                            <Badge variant="secondary" className="text-xs">
                              → {assignedPartner?.name}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Assign To Partners */}
              <div>
                <h4 className="font-medium mb-3">Assign To</h4>
                {selectedClient ? (
                  <div className="space-y-2">
                    <div className="p-2 bg-blue-50 border border-blue-200 rounded text-sm">
                      Selected: <strong>{selectedClient.name}</strong>
                    </div>
                    {remainingPartners.map((partner) => {
                      const currentAssignments = Object.values(partnershipTransition.customAssignments || {})
                        .filter(assignedId => assignedId === partner.id).length;
                      
                      return (
                        <div
                          key={partner.id}
                          className="p-3 border rounded cursor-pointer hover:bg-gray-50 transition-colors"
                          onClick={() => handlePartnerAssign(partner.id)}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-medium">{partner.name}</span>
                            <Badge variant="outline" className="text-xs">
                              +{currentAssignments} assigned
                            </Badge>
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            Current: {partner.clientCount} clients • {Math.round(partner.capacityUsed)}% capacity
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500 border border-dashed rounded">
                    Select a client from the left to assign
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* AI Optimization Button */}
        <div className="pt-4 border-t">
          <Button 
            className="w-full" 
            variant="outline"
            onClick={onRequestAI}
            disabled={aiLoading || departingPartners.length === 0 || remainingPartners.length === 0}
          >
            <Brain className="h-4 w-4 mr-2" />
            {aiLoading ? 'Optimizing...' : 'AI Optimize Redistribution'}
          </Button>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Use AI to optimize redistribution based on client needs, partner expertise, and capacity constraints
          </p>
        </div>

        {/* Warnings */}
        {redistributionPreview.some(p => getCapacityWarning(p)) && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Some partners will exceed recommended capacity. Consider additional redistribution or hiring.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default RedistributionModeler;