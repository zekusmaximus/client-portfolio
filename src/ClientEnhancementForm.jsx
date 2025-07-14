import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { LOBBYISTS } from './constants';
import { 
  X, 
  Users, 
  Save, 
  AlertCircle,
  Building,
  Heart,
  Shield,
  Clock,
  TrendingUp,
  Target,
  FileText
} from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import { apiClient } from './api';

const ClientEnhancementForm = ({ onClose, clientId = null }) => {
  const { 
    clients, 
    selectedClient, 
    updateClient, 
    setSelectedClient,
    getClientById 
  } = usePortfolioStore();

  // Get the client to edit
  const client = clientId ? getClientById(clientId) : selectedClient;
  
  const [formData, setFormData] = useState({
    practiceArea: [],
    relationshipStrength: 5,
    conflictRisk: 'Medium',
    primaryLobbyist: '',
    clientOriginator: '',
    lobbyistTeam: [],
    interactionFrequency: 'As-Needed',
    relationshipIntensity: 5,
    crisisManagement: 'Low',
    renewalProbability: 0.7,
    strategicFitScore: 5,
    notes: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // Practice area options
  const practiceAreaOptions = [
    'Healthcare',
    'Municipal',
    'Corporate',
    'Energy',
    'Financial',
    'Education',
    'Transportation',
    'Environmental',
    'Technology',
    'Real Estate',
    'Non-Profit',
    'Other'
  ];

  // Initialize form data when client changes
  useEffect(() => {
    if (client) {
      setFormData({
        practiceArea: client.practiceArea || [],
        relationshipStrength: client.relationshipStrength || 5,
        conflictRisk: client.conflictRisk || 'Medium',
        primaryLobbyist: client.primaryLobbyist || '',
        clientOriginator: client.clientOriginator || '',
        lobbyistTeam: client.lobbyistTeam || [],
        interactionFrequency: client.interactionFrequency || 'As-Needed',
        relationshipIntensity: client.relationshipIntensity || 5,
        crisisManagement: client.crisisManagement || 'Low',
        renewalProbability: client.renewalProbability || 0.7,
        strategicFitScore: client.strategicFitScore || 5,
        notes: client.notes || ''
      });
    }
  }, [client]);

  const handlePracticeAreaChange = (area, checked) => {
    setFormData(prev => ({
      ...prev,
      practiceArea: checked 
        ? [...prev.practiceArea, area]
        : prev.practiceArea.filter(a => a !== area)
    }));
  };

  const handleSliderChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: Array.isArray(value) ? value[0] : value
    }));
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (formData.practiceArea.length === 0) {
      newErrors.practiceArea = 'Please select at least one practice area';
    }
    
    // Additional validations can be added here as needed
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!client || !validateForm()) return;
    
    setIsSaving(true);
    
    try {
      // Update client with enhanced data
      const updatedClient = {
        ...client,
        ...formData
      };
      
      // Send to backend for recalculation
      const result = await apiClient.post('/data/update-client', {
        clients,
        updatedClient,
      });
      
      if (result.success) {
        // Update the store with recalculated data
        usePortfolioStore.setState({ clients: result.clients });
        onClose();
      } else {
        throw new Error('Server returned error');
      }
      
    } catch (error) {
      console.error('Error updating client:', error);
      setErrors({ general: 'Failed to save client data. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!client) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-md bg-white dark:bg-gray-900">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              No client selected for enhancement.
            </p>
            <div className="mt-4 text-center">
              <Button onClick={onClose}>Close</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Enhance Client: {client.name}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Client Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg">
            <div>
              <Label className="text-sm font-medium">Current Revenue</Label>
              <p className="text-lg font-semibold">${(client.averageRevenue || 0).toLocaleString()}</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Contract Status</Label>
              <Badge variant={client.status === 'IF' ? 'default' : 'secondary'}>
                {client.status}
              </Badge>
            </div>
            <div>
              <Label className="text-sm font-medium">Strategic Value</Label>
              <p className="text-lg font-semibold">{(client.strategicValue || 0).toFixed(1)}</p>
            </div>
          </div>

          {/* Practice Areas */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Building className="h-4 w-4" />
              Practice Areas *
            </Label>
            {errors.practiceArea && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.practiceArea}
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {practiceAreaOptions.map((area) => (
                <div key={area} className="flex items-center space-x-2">
                  <Checkbox
                    id={area}
                    checked={formData.practiceArea.includes(area)}
                    onCheckedChange={(checked) => handlePracticeAreaChange(area, checked)}
                  />
                  <Label htmlFor={area} className="text-sm">{area}</Label>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {formData.practiceArea.map((area) => (
                <Badge key={area} variant="secondary">
                  {area}
                </Badge>
              ))}
            </div>
          </div>

          {/* Relationship Strength */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Heart className="h-4 w-4" />
              Relationship Strength: {formData.relationshipStrength}/10
            </Label>
            <Slider
              value={[formData.relationshipStrength]}
              onValueChange={(value) => handleSliderChange('relationshipStrength', value)}
              max={10}
              min={1}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Weak (1)</span>
              <span>Strong (10)</span>
            </div>
          </div>

          {/* Conflict Risk */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Conflict Risk
            </Label>
            <RadioGroup 
              value={formData.conflictRisk} 
              onValueChange={(value) => setFormData(prev => ({ ...prev, conflictRisk: value }))}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Low" id="low" />
                <Label htmlFor="low">Low - Minimal conflicts expected</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Medium" id="medium" />
                <Label htmlFor="medium">Medium - Some potential conflicts</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="High" id="high" />
                <Label htmlFor="high">High - Significant conflict potential</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Lobbyist & Origination Assignment */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Lobbyist & Origination Assignment
            </Label>

            {/* Primary Lobbyist */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Primary Lobbyist</Label>
              <Select
                value={formData.primaryLobbyist}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, primaryLobbyist: e.target.value }))
                }
                className="w-full border rounded-md p-2"
              >
                <option value="">Select...</option>
                {LOBBYISTS.map((lob) => (
                  <option key={lob} value={lob}>
                    {lob}
                  </option>
                ))}
              </Select>
            </div>

            {/* Client Originator */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Client Originator</Label>
              <Select
                value={formData.clientOriginator}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, clientOriginator: e.target.value }))
                }
                className="w-full border rounded-md p-2"
              >
                <option value="">Select...</option>
                {LOBBYISTS.map((lob) => (
                  <option key={lob} value={lob}>
                    {lob}
                  </option>
                ))}
              </Select>
            </div>

            {/* Lobbyist Team */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Lobbyist Team</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {LOBBYISTS.map((lob) => (
                  <div key={lob} className="flex items-center space-x-2">
                    <Checkbox
                      id={`team-${lob}`}
                      checked={formData.lobbyistTeam.includes(lob)}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({
                          ...prev,
                          lobbyistTeam: checked
                            ? [...prev.lobbyistTeam, lob]
                            : prev.lobbyistTeam.filter((l) => l !== lob),
                        }))
                      }
                    />
                    <Label htmlFor={`team-${lob}`} className="text-sm">
                      {lob}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Relationship & Engagement Metrics */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Relationship & Engagement Metrics
            </Label>

            {/* Interaction Frequency */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Interaction Frequency</Label>
              <RadioGroup
                value={formData.interactionFrequency}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, interactionFrequency: value }))
                }
              >
                {['As-Needed', 'Quarterly', 'Monthly', 'Weekly', 'Daily'].map((freq) => (
                  <div key={freq} className="flex items-center space-x-2">
                    <RadioGroupItem value={freq} id={`freq-${freq}`} />
                    <Label htmlFor={`freq-${freq}`}>{freq}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Relationship Intensity */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">
                Relationship Intensity: {formData.relationshipIntensity}/10
              </Label>
              <Slider
                value={[formData.relationshipIntensity]}
                onValueChange={(value) => handleSliderChange('relationshipIntensity', value)}
                max={10}
                min={1}
                step={1}
                className="w-full"
              />
            </div>

            {/* Crisis Management Needs */}
            <div className="space-y-1">
              <Label className="text-sm font-medium">Crisis Management Needs</Label>
              <RadioGroup
                value={formData.crisisManagement}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, crisisManagement: value }))
                }
              >
                {['Low', 'Medium', 'High'].map((lvl) => (
                  <div key={lvl} className="flex items-center space-x-2">
                    <RadioGroupItem value={lvl} id={`crisis-${lvl}`} />
                    <Label htmlFor={`crisis-${lvl}`}>{lvl}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>

          {/* Renewal Probability */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Renewal Probability: {Math.round(formData.renewalProbability * 100)}%
            </Label>
            <Slider
              value={[formData.renewalProbability]}
              onValueChange={(value) => handleSliderChange('renewalProbability', value)}
              max={1}
              min={0}
              step={0.05}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Unlikely (0%)</span>
              <span>Certain (100%)</span>
            </div>
          </div>

          {/* Strategic Fit Score */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Strategic Fit Score: {formData.strategicFitScore}/10
            </Label>
            <Slider
              value={[formData.strategicFitScore]}
              onValueChange={(value) => handleSliderChange('strategicFitScore', value)}
              max={10}
              min={1}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Poor Fit (1)</span>
              <span>Perfect Fit (10)</span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notes
            </Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional notes about this client relationship, strategic considerations, etc."
              rows={4}
            />
          </div>

          {/* Error Message */}
          {errors.general && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {errors.general}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClientEnhancementForm;

