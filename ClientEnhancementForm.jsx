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
import usePortfolioStore from '../store/portfolioStore';

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
    timeCommitment: 40,
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
        timeCommitment: client.timeCommitment || 40,
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
    
    if (formData.timeCommitment <= 0) {
      newErrors.timeCommitment = 'Time commitment must be greater than 0';
    }
    
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
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
      const response = await fetch(`${apiBaseUrl}/api/data/update-client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          clients: clients,
          updatedClient 
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update client');
      }
      
      const result = await response.json();
      
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
        <Card className="w-full max-w-md">
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
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
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

          {/* Time Commitment */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Time Commitment (hours/month)
            </Label>
            {errors.timeCommitment && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.timeCommitment}
              </p>
            )}
            <Input
              type="number"
              value={formData.timeCommitment}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                timeCommitment: parseFloat(e.target.value) || 0 
              }))}
              min="0"
              step="1"
              placeholder="40"
            />
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

