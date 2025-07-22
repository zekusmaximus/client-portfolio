import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ConfirmationDialog from './components/ui/confirmation-dialog';
import {
  Users,
  Search,
  Edit,
  DollarSign,
  Target,
  Shield,
  Building,
  Trash2,
  User,
  Clock,
  Heart,
  Zap
} from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import { isClientEnhanced, getEnhancedClientCount, getEnhancementRate } from './utils/clientUtils';

const ClientListView = () => {
  const {
    clients,
    partners,
    fetchPartners,
    openClientModal,
    deleteClient
  } = usePortfolioStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('strategicValue');
  const [sortOrder, setSortOrder] = useState('desc');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [deleteDialogClient, setDeleteDialogClient] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch partners when component mounts
  useMemo(() => {
    fetchPartners();
  }, [fetchPartners]);

  // Filter and sort clients
  const filteredAndSortedClients = useMemo(() => {
    const { getClientRevenue } = usePortfolioStore.getState();
    
    return clients
        .filter(client => {
          // Text search filter
          const matchesSearch = client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (client.practiceArea && client.practiceArea.some(area =>
              area.toLowerCase().includes(searchTerm.toLowerCase())
            ));
          
          // Partner filter
          const matchesPartner = partnerFilter === 'all' || 
            client.primary_lobbyist === partnerFilter ||
            (!client.primary_lobbyist && partnerFilter === 'unassigned');
          
          return matchesSearch && matchesPartner;
        })
        .sort((a, b) => {
          let aValue, bValue;

          // Handle different sort criteria
          if (sortBy === 'name') {
            aValue = a.name || '';
            bValue = b.name || '';
          } else if (sortBy === 'strategicValue') {
            aValue = parseFloat(a.strategicValue) || 0;
            bValue = parseFloat(b.strategicValue) || 0;
          } else if (sortBy === 'averageRevenue') {
            aValue = getClientRevenue(a) || 0;
            bValue = getClientRevenue(b) || 0;
          } else {
            // Fallback for other fields
            aValue = a[sortBy] || 0;
            bValue = b[sortBy] || 0;
          }

          if (sortOrder === 'asc') {
            if (sortBy === 'name') return aValue.localeCompare(bValue);
            return aValue - bValue;
          } else {
            if (sortBy === 'name') return bValue.localeCompare(aValue);
            return bValue - aValue;
          }
        });
  }, [clients, searchTerm, sortBy, sortOrder, partnerFilter]);

  const handleEditClient = (client) => {
    openClientModal(client);
  };

  const handleDeleteClient = async () => {
    if (!deleteDialogClient) return;

    try {
      setIsDeleting(true);
      await deleteClient(deleteDialogClient.id);
      setDeleteDialogClient(null);
    } catch (error) {
      console.error('Failed to delete client:', error);
      alert('Failed to delete client. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'IF': return 'bg-green-500';
      case 'P': return 'bg-blue-500';
      case 'D': return 'bg-gray-500';
      case 'H': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const getRiskColor = (risk) => {
    switch (risk) {
      case 'Low': return 'text-green-600 bg-green-50 border-green-200';
      case 'Medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'High': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  if (!clients || clients.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Client Enhancement Center
            </div>
            <Button onClick={() => openClientModal(null)}>Add New Client</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No clients yet</p>
            <p className="mb-4">
              Start building your portfolio by adding clients individually or uploading a CSV file.
            </p>
            <Button onClick={() => openClientModal(null)} variant="outline">
              Add Your First Client
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Client Enhancement Center
            </div>
            <Button onClick={() => openClientModal(null)}>Add New Client</Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Enhance your client data with detailed information to improve strategic analysis and recommendations.
          </p>
          
          {/* Search and Sort Controls */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search clients or practice areas..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={partnerFilter} onValueChange={setPartnerFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by partner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Partners</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {partners?.map(partner => (
                  <SelectItem key={partner.id} value={partner.name}>
                    {partner.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="strategicValue">Strategic Value</option>
                <option value="averageRevenue">Revenue</option>
                <option value="name">Name</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Client Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedClients.map((client) => (
          <Card key={client.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{client.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge 
                      variant="secondary" 
                      className={`${getStatusColor(client.status)} text-white`}
                    >
                      {client.status}
                    </Badge>
                    <Badge 
                      variant="outline"
                      className={getRiskColor(client.conflictRisk)}
                    >
                      {client.conflictRisk} Conflict Risk
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditClient(client)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteDialogClient(client)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-4">
              {/* Top Row - Revenue and Strategic Value */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">2025 Revenue</p>
                    <p className="font-semibold text-sm">${usePortfolioStore.getState().getClientRevenue(client).toLocaleString()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-purple-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Strategic Value</p>
                    <p className="font-semibold text-sm">{(client.strategicValue || 0).toFixed(1)}</p>
                  </div>
                </div>
              </div>

              {/* Practice Areas */}
              {client.practiceArea && client.practiceArea.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-2">
                    <Building className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Practice Areas</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {client.practiceArea.slice(0, 3).map((area) => (
                      <Badge key={area} variant="outline" className="text-xs">
                        {area}
                      </Badge>
                    ))}
                    {client.practiceArea.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{client.practiceArea.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Primary Lobbyist */}
              {client.primary_lobbyist && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-blue-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Primary Lobbyist</p>
                    <p className="font-medium text-sm">{client.primary_lobbyist}</p>
                  </div>
                </div>
              )}

              {/* Interaction Frequency */}
              {client.interaction_frequency && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Interaction Frequency</p>
                    <p className="font-medium text-sm">{client.interaction_frequency}</p>
                  </div>
                </div>
              )}

              {/* Relationship Metrics */}
              {(client.relationshipStrength || client.relationship_intensity) && (
                <div>
                  <div className="flex items-center gap-1 mb-2">
                    <Heart className="h-3 w-3 text-red-500" />
                    <span className="text-xs text-muted-foreground">Relationship Metrics</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {client.relationshipStrength && (
                      <div>
                        <p className="text-xs text-muted-foreground">Strength</p>
                        <div className="flex items-center gap-1">
                          <div className="flex-1 bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-red-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${(client.relationshipStrength / 10) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{client.relationshipStrength}/10</span>
                        </div>
                      </div>
                    )}
                    {client.relationship_intensity && (
                      <div>
                        <p className="text-xs text-muted-foreground">Intensity</p>
                        <div className="flex items-center gap-1">
                          <Zap className="h-3 w-3 text-yellow-500" />
                          <span className="text-xs font-medium">{client.relationship_intensity}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Enhancement Status */}
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Enhancement Status
                  </span>
                  <Badge 
                    variant={
                      isClientEnhanced(client) 
                        ? "default" 
                        : "secondary"
                    }
                    className="text-xs"
                  >
                    {isClientEnhanced(client) 
                      ? "Enhanced" 
                      : "Basic"
                    }
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* No Results */}
      {filteredAndSortedClients.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              No clients found matching your search criteria.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{clients.length}</p>
              <p className="text-sm text-muted-foreground">Total Clients</p>
            </div>
            <div>
              <p className="text-2xl font-bold">
                {getEnhancedClientCount(clients)}
              </p>
              <p className="text-sm text-muted-foreground">Enhanced Clients</p>
            </div>
            <div>
              <p className="text-2xl font-bold">
                {getEnhancementRate(clients)}%
              </p>
              <p className="text-sm text-muted-foreground">Enhancement Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        open={!!deleteDialogClient}
        onOpenChange={(open) => !open && setDeleteDialogClient(null)}
        title="Delete Client"
        description={deleteDialogClient ? `Are you sure you want to delete "${deleteDialogClient.name}"? This action cannot be undone and will permanently remove all client data including revenue records.` : ''}
        confirmText="Delete Client"
        cancelText="Cancel"
        onConfirm={handleDeleteClient}
        loading={isDeleting}
      />
    </div>
  );
};

export default ClientListView;

