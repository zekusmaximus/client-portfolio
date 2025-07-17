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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOBBYISTS } from './constants';
import {
  X,
  Users,
  Save,
  AlertCircle,
  Building,
  Heart,
  Shield,
  FileText,
  DollarSign,
  Plus,
  Trash2
} from 'lucide-react';
import usePortfolioStore from './portfolioStore';

const ClientEnhancementForm = ({ onClose }) => {
  const { 
    selectedClient, 
    isModalOpen,
    addClient,
    updateClient,
    closeClientModal 
  } = usePortfolioStore();

  // Determine if this is create or edit mode
  const isEditMode = selectedClient !== null;
  const client = selectedClient;
  
  const [formData, setFormData] = useState({
    name: '',
    status: 'Prospect',
    practiceArea: [],
    relationship_strength: 5,
    conflict_risk: 'Medium',
    primary_lobbyist: '',
    client_originator: '',
    lobbyist_team: [],
    interaction_frequency: 'As-Needed',
    relationship_intensity: 5,
    renewal_probability: 0.7,
    notes: '',
    revenues: []
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
      const clientRevenues = client.revenues || [];
      // If no revenue data exists, add an empty row with the next logical year
      const revenuesWithDefault = clientRevenues.length === 0 
        ? [{ year: new Date().getFullYear(), revenue_amount: '' }]
        : clientRevenues;

      setFormData({
        name: client.name || '',
        status: client.status || 'Prospect',
        practiceArea: client.practiceArea || [],
        relationship_strength: client.relationship_strength || 5,
        conflict_risk: client.conflict_risk || 'Medium',
        primary_lobbyist: client.primary_lobbyist || '',
        client_originator: client.client_originator || '',
        lobbyist_team: client.lobbyist_team || [],
        interaction_frequency: client.interaction_frequency || 'As-Needed',
        relationship_intensity: client.relationship_intensity || 5,
        renewal_probability: client.renewal_probability || 0.7,
        notes: client.notes || '',
        revenues: revenuesWithDefault
      });
    } else {
      // Reset form for new client with an empty revenue row for current year
      setFormData({
        name: '',
        status: 'Prospect',
        practiceArea: [],
        relationship_strength: 5,
        conflict_risk: 'Medium',
        primary_lobbyist: '',
        client_originator: '',
        lobbyist_team: [],
        interaction_frequency: 'As-Needed',
        relationship_intensity: 5,
        renewal_probability: 0.7,
        notes: '',
        revenues: [{ year: new Date().getFullYear(), revenue_amount: '' }]
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

  const handleLobbyistTeamChange = (lobbyist, checked) => {
    setFormData(prev => ({
      ...prev,
      lobbyist_team: checked 
        ? [...prev.lobbyist_team, lobbyist]
        : prev.lobbyist_team.filter(l => l !== lobbyist)
    }));
  };

  const handleSliderChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: Array.isArray(value) ? value[0] : value
    }));
  };

  const handleRevenueChange = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      revenues: prev.revenues.map((rev, i) => 
        i === index ? { ...rev, [field]: value } : rev
      )
    }));
  };

  const addRevenueEntry = () => {
    setFormData(prev => ({
      ...prev,
      revenues: [...prev.revenues, { year: '', revenue_amount: '' }]
    }));
  };

  const removeRevenueEntry = (index) => {
    setFormData(prev => ({
      ...prev,
      revenues: prev.revenues.filter((_, i) => i !== index)
    }));
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.name.trim()) {
      newErrors.name = 'Client name is required';
    }
    
    if (formData.practiceArea.length === 0) {
      newErrors.practiceArea = 'Please select at least one practice area';
    }

    // Validate revenue entries
    formData.revenues.forEach((rev, index) => {
      if (rev.year && !rev.revenue_amount) {
        newErrors[`revenue_${index}`] = 'Revenue amount is required when year is specified';
      }
      if (rev.revenue_amount && !rev.year) {
        newErrors[`revenue_${index}`] = 'Year is required when revenue amount is specified';
      }
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    
    setIsSaving(true);
    
    try {
      // Clean up revenues - remove empty entries
      const cleanRevenues = formData.revenues.filter(rev => 
        rev.year && rev.revenue_amount
      ).map(rev => ({
        year: parseInt(rev.year),
        revenue_amount: parseFloat(rev.revenue_amount)
      }));

      const clientData = {
        ...formData,
        revenues: cleanRevenues
      };

      if (isEditMode) {
        await updateClient(client.id, clientData);
      } else {
        await addClient(clientData);
      }
      
      closeClientModal();
      
    } catch (error) {
      console.error('Error saving client:', error);
      setErrors({ general: 'Failed to save client data. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    closeClientModal();
    if (onClose) onClose();
  };

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-700">
        <CardHeader className="flex flex-row items-center justify-between bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {isEditMode ? `Edit Client: ${client.name}` : 'Create New Client'}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="space-y-6 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
          {/* Client Basic Information */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Client Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter client name"
              />
              {errors.name && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.name}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Prospect">Prospect</SelectItem>
                  <SelectItem value="IF">In Force</SelectItem>
                  <SelectItem value="P">Proposal</SelectItem>
                  <SelectItem value="D">Done</SelectItem>
                  <SelectItem value="H">Hold</SelectItem>
                </SelectContent>
              </Select>
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

          {/* Financials Section */}
          <div className="space-y-4">
            <Label className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Financials
            </Label>
            <div className="border rounded-lg p-4 space-y-3">
              {formData.revenues.map((revenue, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-1">
                    <Input
                      type="number"
                      placeholder="Year (e.g., 2024)"
                      value={revenue.year}
                      onChange={(e) => handleRevenueChange(index, 'year', e.target.value)}
                    />
                  </div>
                  <div className="flex-2">
                    <Input
                      type="number"
                      placeholder="Revenue Amount"
                      value={revenue.revenue_amount}
                      onChange={(e) => handleRevenueChange(index, 'revenue_amount', e.target.value)}
                    />
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => removeRevenueEntry(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  {errors[`revenue_${index}`] && (
                    <p className="text-sm text-red-500 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors[`revenue_${index}`]}
                    </p>
                  )}
                </div>
              ))}
              <Button 
                variant="outline" 
                onClick={addRevenueEntry}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Year
              </Button>
            </div>
          </div>



          {/* Conflict Risk */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Conflict Risk
            </Label>
            <RadioGroup 
              value={formData.conflict_risk} 
              onValueChange={(value) => setFormData(prev => ({ ...prev, conflict_risk: value }))}
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

          {/* Lobbyist Assignment */}
          <div className="space-y-4">
            <Label className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team Assignment
            </Label>

            {/* Primary Lobbyist */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Primary Lobbyist</Label>
              <Select value={formData.primary_lobbyist} onValueChange={(value) => setFormData(prev => ({ ...prev, primary_lobbyist: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select primary lobbyist..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {LOBBYISTS.map((lobbyist) => (
                    <SelectItem key={lobbyist} value={lobbyist}>
                      {lobbyist}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Client Originator */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Client Originator</Label>
              <Select value={formData.client_originator} onValueChange={(value) => setFormData(prev => ({ ...prev, client_originator: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client originator..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {LOBBYISTS.map((lobbyist) => (
                    <SelectItem key={lobbyist} value={lobbyist}>
                      {lobbyist}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Lobbyist Team */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Lobbyist Team</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {LOBBYISTS.map((lobbyist) => (
                  <div key={lobbyist} className="flex items-center space-x-2">
                    <Checkbox
                      id={`team-${lobbyist}`}
                      checked={formData.lobbyist_team.includes(lobbyist)}
                      onCheckedChange={(checked) => handleLobbyistTeamChange(lobbyist, checked)}
                    />
                    <Label htmlFor={`team-${lobbyist}`} className="text-sm">
                      {lobbyist}
                    </Label>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.lobbyist_team.map((lobbyist) => (
                  <Badge key={lobbyist} variant="secondary">
                    {lobbyist}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Interaction Frequency */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Interaction Frequency</Label>
            <RadioGroup
              value={formData.interaction_frequency}
              onValueChange={(value) => setFormData(prev => ({ ...prev, interaction_frequency: value }))}
              className="flex flex-wrap gap-x-4 gap-y-2"
            >
              {['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed'].map((freq) => (
                <div key={freq} className="flex items-center space-x-2">
                  <RadioGroupItem value={freq} id={`freq-${freq}`} />
                  <Label htmlFor={`freq-${freq}`}>{freq}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Relationship Intensity */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              Relationship Intensity: {formData.relationship_intensity}/10
            </Label>
            <Slider
              value={[formData.relationship_intensity]}
              onValueChange={(value) => handleSliderChange('relationship_intensity', value)}
              max={10}
              min={1}
              step={1}
              className="w-full"
            />
          </div>

          {/* Relationship Strength */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Heart className="h-4 w-4" />
              Relationship Strength: {formData.relationship_strength}/10
            </Label>
            <Slider
              value={[formData.relationship_strength]}
              onValueChange={(value) => handleSliderChange('relationship_strength', value)}
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
            <Button variant="outline" onClick={handleClose} disabled={isSaving}>
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
                  {isEditMode ? 'Update Client' : 'Create Client'}
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