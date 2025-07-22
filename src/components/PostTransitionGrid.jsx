import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import usePortfolioStore from '../portfolioStore';
import { formatClientName, formatPartnerName } from '../utils/textUtils';

const PostTransitionGrid = ({ partners, model, clients, customAssignments = {} }) => {
  const { getClientRevenue } = usePortfolioStore();

  // Explicit calculation logic for new partner states
  const calculateNewState = useMemo(() => {
    const remainingPartners = partners.filter(p => !p.isDeparting);
    const departingPartners = partners.filter(p => p.isDeparting);
    
    if (!departingPartners.length || !remainingPartners.length) return [];

    const departingClients = departingPartners.flatMap(p => p.clients || []);
    const departingClientsData = departingClients.map(clientId => 
      clients.find(c => c.id === clientId)
    ).filter(Boolean);

    return remainingPartners.map(partner => {
      let assignedClients = [...(partner.clients || [])];
      
      switch (model) {
        case 'balanced':
          // Distribute evenly by count
          const clientsPerPartner = Math.ceil(departingClientsData.length / remainingPartners.length);
          const startIndex = remainingPartners.indexOf(partner) * clientsPerPartner;
          const endIndex = Math.min(startIndex + clientsPerPartner, departingClientsData.length);
          const balancedClients = departingClientsData.slice(startIndex, endIndex);
          assignedClients.push(...balancedClients.map(c => c.id));
          break;

        case 'expertise':
          // Match practice areas
          departingClientsData.forEach(client => {
            const clientAreas = Array.isArray(client.practice_area) ? 
              client.practice_area : [client.practice_area].filter(Boolean);
            
            const matchingAreas = clientAreas.filter(area => 
              partner.practiceAreas?.includes(area)
            );
            
            if (matchingAreas.length > 0) {
              // Find partner with best expertise match
              const partnerMatchScore = matchingAreas.length / clientAreas.length;
              const otherPartners = remainingPartners.filter(p => p.id !== partner.id);
              
              const isBestMatch = otherPartners.every(otherPartner => {
                const otherMatchingAreas = clientAreas.filter(area => 
                  otherPartner.practiceAreas?.includes(area)
                );
                const otherMatchScore = otherMatchingAreas.length / clientAreas.length;
                return partnerMatchScore >= otherMatchScore;
              });
              
              if (isBestMatch && !assignedClients.includes(client.id)) {
                assignedClients.push(client.id);
              }
            }
          });
          break;

        case 'relationship':
          // Check existing relationships in lobbyist_team
          departingClientsData.forEach(client => {
            const lobbyistTeam = Array.isArray(client.lobbyist_team) ? 
              client.lobbyist_team : [];
            
            if (lobbyistTeam.includes(partner.name) && !assignedClients.includes(client.id)) {
              assignedClients.push(client.id);
            }
          });
          break;

        case 'custom':
          // Use customAssignments from store
          Object.entries(customAssignments).forEach(([clientId, partnerId]) => {
            if (partnerId === partner.id && !assignedClients.includes(clientId)) {
              assignedClients.push(clientId);
            }
          });
          break;

        default:
          break;
      }

      // Calculate new metrics with safety checks
      const newRevenue = assignedClients.reduce((total, clientId) => {
        const client = clients.find(c => c.id === clientId);
        return total + (client ? getClientRevenue(client) : 0);
      }, 0);

      const currentRevenue = partner.totalRevenue || 0;
      const revenueChange = currentRevenue > 0 ? 
        ((newRevenue - currentRevenue) / currentRevenue) * 100 : 0;
      
      // Capacity calculation - 30 clients = 100% capacity
      const capacityUsed = Math.min(100, (assignedClients.length / 30) * 100);
      
      // Find new clients (not in original partner.clients)
      const originalClients = partner.clients || [];
      const newClients = assignedClients.filter(id => !originalClients.includes(id));

      return {
        ...partner,
        assignedClients,
        newClients,
        newRevenue,
        revenueChange,
        capacityUsed,
        isOverloaded: capacityUsed > 85,
        capacityLevel: capacityUsed > 95 ? 'critical' : 
                       capacityUsed > 85 ? 'warning' : 
                       capacityUsed > 70 ? 'caution' : 'normal'
      };
    });
  }, [partners, model, clients, customAssignments, getClientRevenue]);

  const formatRevenue = (revenue) => {
    if (revenue >= 1000000) return `$${(revenue / 1000000).toFixed(1)}M`;
    if (revenue >= 1000) return `$${(revenue / 1000).toFixed(0)}K`;
    return `$${Math.round(revenue)}`;
  };

  const getCapacityBgClass = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-50 border-red-200';
      case 'warning': return 'bg-orange-50 border-orange-200';
      case 'caution': return 'bg-yellow-50 border-yellow-200';
      default: return '';
    }
  };

  if (calculateNewState.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No post-transition data available. Mark partners as departing to see projections.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Post-Transition Projection</h2>
        <Badge variant="outline" className="text-sm">
          {model.charAt(0).toUpperCase() + model.slice(1)} Model
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {calculateNewState.map((projectedPartner) => (
          <Card 
            key={projectedPartner.id} 
            className={`${getCapacityBgClass(projectedPartner.capacityLevel)}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{formatPartnerName(projectedPartner.name)}</CardTitle>
                {projectedPartner.isOverloaded && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Overloaded
                  </Badge>
                )}
              </div>
            </CardHeader>
            
            <CardContent className="space-y-3">
              {/* Revenue Comparison */}
              <div className="space-y-1">
                <div className="text-sm text-gray-600">Revenue</div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    {formatRevenue(projectedPartner.totalRevenue)} → {formatRevenue(projectedPartner.newRevenue)}
                  </span>
                  <div className="flex items-center gap-1">
                    {projectedPartner.revenueChange > 0 ? (
                      <ArrowUp className="h-3 w-3 text-green-600" />
                    ) : projectedPartner.revenueChange < 0 ? (
                      <ArrowDown className="h-3 w-3 text-red-600" />
                    ) : null}
                    <span className={`text-xs ${
                      projectedPartner.revenueChange > 0 ? 'text-green-600' : 
                      projectedPartner.revenueChange < 0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {projectedPartner.revenueChange > 0 ? '+' : ''}{projectedPartner.revenueChange.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Client Count Comparison */}
              <div className="space-y-1">
                <div className="text-sm text-gray-600">Clients</div>
                <div className="text-sm">
                  {projectedPartner.clientCount} clients → {projectedPartner.assignedClients.length} clients
                  {projectedPartner.newClients.length > 0 && (
                    <span className="text-green-600"> (+{projectedPartner.newClients.length})</span>
                  )}
                </div>
              </div>

              {/* New Clients */}
              {projectedPartner.newClients.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm text-gray-600">New Clients</div>
                  <div className="flex flex-wrap gap-1">
                    {projectedPartner.newClients.slice(0, 3).map(clientId => {
                      const client = clients.find(c => c.id === clientId);
                      return client ? (
                        <Badge 
                          key={clientId} 
                          className="bg-green-100 text-green-800 text-xs"
                        >
                          {formatClientName(client.name)}
                        </Badge>
                      ) : null;
                    })}
                    {projectedPartner.newClients.length > 3 && (
                      <Badge className="bg-green-100 text-green-800 text-xs">
                        +{projectedPartner.newClients.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Capacity Usage */}
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Capacity</span>
                  <span className={`font-medium ${
                    projectedPartner.capacityUsed > 85 ? 'text-red-600' : 
                    projectedPartner.capacityUsed > 70 ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {Math.round(projectedPartner.capacityUsed)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      projectedPartner.capacityUsed > 85 ? 'bg-red-500' : 
                      projectedPartner.capacityUsed > 70 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, projectedPartner.capacityUsed)}%` }}
                  />
                </div>
              </div>

              {/* Warnings */}
              {projectedPartner.capacityUsed > 100 && (
                <div className="text-xs text-red-600 font-medium">
                  ⚠️ Exceeds maximum capacity by {Math.round(projectedPartner.capacityUsed - 100)}%
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Transition Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-blue-600">
                {calculateNewState.filter(p => p.capacityUsed > 85).length}
              </div>
              <div className="text-sm text-gray-600">Overloaded Partners</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">
                {calculateNewState.reduce((sum, p) => sum + p.newClients.length, 0)}
              </div>
              <div className="text-sm text-gray-600">Clients Reassigned</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-600">
                {formatRevenue(calculateNewState.reduce((sum, p) => sum + p.newRevenue, 0))}
              </div>
              <div className="text-sm text-gray-600">Total Projected Revenue</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-orange-600">
                {Math.round(calculateNewState.reduce((sum, p) => sum + p.capacityUsed, 0) / calculateNewState.length)}%
              </div>
              <div className="text-sm text-gray-600">Avg Capacity Usage</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PostTransitionGrid;