import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';
import usePortfolioStore from '../portfolioStore';

const ClientFlowVisualization = ({ partners, assignments = {}, clients }) => {
  const { getClientRevenue } = usePortfolioStore();

  // Group assignments by source and destination with security validation
  const flows = useMemo(() => {
    const departingPartners = partners.filter(p => p.isDeparting);
    const remainingPartners = partners.filter(p => !p.isDeparting);
    
    if (!departingPartners.length || !remainingPartners.length || !Object.keys(assignments).length) {
      return { departingPartners: [], flows: [], remainingPartners: [] };
    }

    // Create flow mapping with input validation
    const flowMap = new Map();
    
    Object.entries(assignments).forEach(([clientId, partnerId]) => {
      // Security: Validate IDs are strings and not empty
      if (typeof clientId !== 'string' || typeof partnerId !== 'string' || 
          !clientId.trim() || !partnerId.trim()) {
        return;
      }

      const client = clients.find(c => c?.id === clientId);
      const targetPartner = remainingPartners.find(p => p?.id === partnerId);
      const sourcePartner = departingPartners.find(p => 
        p?.clients?.includes(clientId)
      );

      // Only process valid assignments
      if (client && targetPartner && sourcePartner) {
        const flowKey = `${sourcePartner.id}-${targetPartner.id}`;
        
        if (!flowMap.has(flowKey)) {
          flowMap.set(flowKey, {
            sourcePartner,
            targetPartner,
            clients: [],
            totalRevenue: 0
          });
        }
        
        const flow = flowMap.get(flowKey);
        flow.clients.push(client);
        flow.totalRevenue += getClientRevenue(client);
      }
    });

    return {
      departingPartners,
      flows: Array.from(flowMap.values()),
      remainingPartners: remainingPartners.filter(p => 
        Array.from(flowMap.values()).some(flow => flow.targetPartner.id === p.id)
      )
    };
  }, [partners, assignments, clients, getClientRevenue]);

  const formatRevenue = (revenue) => {
    if (!revenue || isNaN(revenue)) return '$0';
    if (revenue >= 1000000) return `$${(revenue / 1000000).toFixed(1)}M`;
    if (revenue >= 1000) return `$${(revenue / 1000).toFixed(0)}K`;
    return `$${Math.round(revenue)}`;
  };

  // Get clients not yet assigned
  const unassignedClients = useMemo(() => {
    const departingClients = flows.departingPartners.flatMap(p => 
      (p.clients || []).map(clientId => clients.find(c => c.id === clientId)).filter(Boolean)
    );
    
    const assignedClientIds = new Set(Object.keys(assignments));
    return departingClients.filter(client => !assignedClientIds.has(client.id));
  }, [flows.departingPartners, clients, assignments]);

  if (flows.departingPartners.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Client Flow Visualization</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No departing partners or client assignments to visualize.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client Flow Visualization</CardTitle>
        <div className="text-sm text-gray-600">
          Showing client transitions from departing to remaining partners
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-8 p-6 bg-gray-50 rounded-lg">
          {/* Departing Partners Column */}
          <div>
            <h3 className="font-bold mb-4 text-center">Departing Partners</h3>
            <div className="space-y-4">
              {flows.departingPartners.map(partner => {
                const partnerClients = (partner.clients || [])
                  .map(clientId => clients.find(c => c.id === clientId))
                  .filter(Boolean);
                
                const assignedFromPartner = partnerClients.filter(client => 
                  assignments[client.id]
                );
                const unassignedFromPartner = partnerClients.filter(client => 
                  !assignments[client.id]
                );

                return (
                  <div key={partner.id} className="bg-white p-4 rounded-lg border">
                    <div className="font-medium text-lg mb-2">{partner.name}</div>
                    <div className="text-sm text-gray-600 mb-3">
                      {partnerClients.length} total clients
                    </div>
                    
                    {/* Assigned clients */}
                    {assignedFromPartner.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-medium text-green-600 mb-1">
                          Reassigned ({assignedFromPartner.length})
                        </div>
                        <div className="space-y-1">
                          {assignedFromPartner.slice(0, 3).map(client => (
                            <div 
                              key={client.id}
                              className="text-xs p-2 bg-green-50 border border-green-200 rounded"
                            >
                              <div className="font-medium">{client.name}</div>
                              <div className="text-gray-600">
                                {formatRevenue(getClientRevenue(client))}
                              </div>
                            </div>
                          ))}
                          {assignedFromPartner.length > 3 && (
                            <div className="text-xs text-center text-gray-500">
                              +{assignedFromPartner.length - 3} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Unassigned clients */}
                    {unassignedFromPartner.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-red-600 mb-1">
                          Unassigned ({unassignedFromPartner.length})
                        </div>
                        <div className="space-y-1">
                          {unassignedFromPartner.slice(0, 2).map(client => (
                            <div 
                              key={client.id}
                              className="text-xs p-2 bg-red-50 border border-red-200 rounded"
                            >
                              <div className="font-medium">{client.name}</div>
                              <div className="text-gray-600">
                                {formatRevenue(getClientRevenue(client))}
                              </div>
                            </div>
                          ))}
                          {unassignedFromPartner.length > 2 && (
                            <div className="text-xs text-center text-gray-500">
                              +{unassignedFromPartner.length - 2} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Arrow Column with Flow Lines */}
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="text-center">
              <ArrowRight className="h-12 w-12 text-gray-400 mx-auto mb-2" />
              <div className="text-sm text-gray-600">
                {flows.flows.length} flow{flows.flows.length !== 1 ? 's' : ''}
              </div>
            </div>
            
            {/* Flow summary */}
            <div className="text-center space-y-2">
              {flows.flows.slice(0, 3).map((flow, index) => (
                <div key={index} className="text-xs bg-blue-50 p-2 rounded">
                  <div className="font-medium">
                    {flow.sourcePartner.name} → {flow.targetPartner.name}
                  </div>
                  <div className="text-gray-600">
                    {flow.clients.length} clients • {formatRevenue(flow.totalRevenue)}
                  </div>
                </div>
              ))}
              {flows.flows.length > 3 && (
                <div className="text-xs text-gray-500">
                  +{flows.flows.length - 3} more flows
                </div>
              )}
            </div>
          </div>

          {/* Receiving Partners Column */}
          <div>
            <h3 className="font-bold mb-4 text-center">Receiving Partners</h3>
            <div className="space-y-4">
              {flows.remainingPartners.map(partner => {
                const receivingFlows = flows.flows.filter(f => 
                  f.targetPartner.id === partner.id
                );
                const totalNewClients = receivingFlows.reduce((sum, flow) => 
                  sum + flow.clients.length, 0
                );
                const totalNewRevenue = receivingFlows.reduce((sum, flow) => 
                  sum + flow.totalRevenue, 0
                );

                return (
                  <div key={partner.id} className="bg-white p-4 rounded-lg border">
                    <div className="font-medium text-lg mb-2">{partner.name}</div>
                    <div className="text-sm text-gray-600 mb-3">
                      Current: {partner.clientCount} clients
                    </div>
                    
                    <div className="mb-3">
                      <div className="text-xs font-medium text-blue-600 mb-1">
                        Receiving (+{totalNewClients})
                      </div>
                      <div className="text-xs text-gray-600 mb-2">
                        Additional Revenue: {formatRevenue(totalNewRevenue)}
                      </div>
                      
                      <div className="space-y-1">
                        {receivingFlows.map((flow, flowIndex) => (
                          <div key={flowIndex} className="text-xs">
                            <div className="font-medium text-blue-700">
                              From {flow.sourcePartner.name}:
                            </div>
                            <div className="ml-2 space-y-1">
                              {flow.clients.slice(0, 2).map(client => (
                                <div 
                                  key={client.id}
                                  className="p-1 bg-blue-50 border border-blue-200 rounded"
                                >
                                  <span className="font-medium">{client.name}</span>
                                  <span className="text-gray-600 ml-1">
                                    ({formatRevenue(getClientRevenue(client))})
                                  </span>
                                </div>
                              ))}
                              {flow.clients.length > 2 && (
                                <div className="text-gray-500 ml-1">
                                  +{flow.clients.length - 2} more
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Capacity warning */}
                    {(() => {
                      const projectedLoad = partner.clientCount + totalNewClients;
                      const capacityPercent = (projectedLoad / 30) * 100;
                      
                      if (capacityPercent > 85) {
                        return (
                          <Badge variant="destructive" className="text-xs">
                            Projected: {Math.round(capacityPercent)}% capacity
                          </Badge>
                        );
                      }
                      return null;
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        
        {/* Warning for unassigned clients */}
        {unassignedClients.length > 0 && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="font-medium text-yellow-800 mb-2">
              ⚠️ {unassignedClients.length} clients not yet assigned
            </div>
            <div className="text-sm text-yellow-700">
              These clients need manual assignment or will be lost in transition.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ClientFlowVisualization;