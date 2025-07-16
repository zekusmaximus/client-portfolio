import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import ConfirmationDialog from './components/ui/confirmation-dialog';
import {
  Users,
  Search,
  Edit,
  DollarSign,
  Target,
  Shield,
  Building,
  Trash2
} from 'lucide-react';
import usePortfolioStore from './portfolioStore';

const ClientListView = () => {
  const {
    clients,
    openClientModal,
    deleteClient
  } = usePortfolioStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('strategicValue');
  const [sortOrder, setSortOrder] = useState('desc');
  const [deleteDialogClient, setDeleteDialogClient] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter and sort clients
  const filteredAndSortedClients = useMemo(() => {
    return clients
        .filter(client =>
          client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (client.practiceArea && client.practiceArea.some(area =>
            area.toLowerCase().includes(searchTerm.toLowerCase())
          ))
        )
        .sort((a, b) => {
          const aValue = a[sortBy] || 0;
          const bValue = b[sortBy] || 0;

          if (sortOrder === 'asc') {
            if (sortBy === 'name') return aValue.localeCompare(bValue);
            return aValue - bValue;
          } else {
            if (sortBy === 'name') return bValue.localeCompare(aValue);
            return bValue - aValue;
          }
        });
  }, [clients, searchTerm, sortBy, sortOrder]);

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
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">
            No client data available. Please upload your portfolio data first.
          </p>
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
                      {client.conflictRisk} Risk
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
            
            <CardContent className="space-y-3">
              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  <div>
                    <p className="text-muted-foreground">2025 Revenue</p>
                    <p className="font-semibold">${usePortfolioStore.getState().getClientRevenue(client).toLocaleString()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-purple-500" />
                  <div>
                    <p className="text-muted-foreground">Strategic Value</p>
                    <p className="font-semibold">{(client.strategicValue || 0).toFixed(1)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-orange-500" />
                  <div>
                    <p className="text-muted-foreground">Renewal</p>
                    <p className="font-semibold">{Math.round((client.renewalProbability || 0) * 100)}%</p>
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

              {/* Enhancement Status */}
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Enhancement Status
                  </span>
                  <Badge 
                    variant={
                      client.practiceArea && client.practiceArea.length > 0 
                        ? "default" 
                        : "secondary"
                    }
                    className="text-xs"
                  >
                    {client.practiceArea && client.practiceArea.length > 0 
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
                {clients.filter(c => c.practiceArea && c.practiceArea.length > 0).length}
              </p>
              <p className="text-sm text-muted-foreground">Enhanced Clients</p>
            </div>
            <div>
              <p className="text-2xl font-bold">
                {Math.round((clients.filter(c => c.practiceArea && c.practiceArea.length > 0).length / clients.length) * 100)}%
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

