import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOBBYISTS } from './constants';
import { 
  validateClientForm, 
  sanitizeFormData, 
  getFieldError, 
  validateRevenueEntry,
  VALIDATION_RULES 
} from './utils/validation';
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
  Trash2,
  HelpCircle
} from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import { formatClientName } from './utils/textUtils';

// Helper functions for relationship metrics
const getRelationshipStrengthLabel = (value) => {
  if (value <= 2) return "Personal Relationship";
  if (value <= 4) return "Individual-Dependent";
  if (value <= 6) return "Mixed Loyalty";
  if (value <= 8) return "Institutional Ties";
  return "Firm-Anchored";
};

const getRelationshipStrengthRisk = (value) => {
  if (value <= 2) return { level: "HIGH", color: "text-red-600" };
  if (value <= 4) return { level: "MEDIUM-HIGH", color: "text-red-500" };
  if (value <= 6) return { level: "MEDIUM", color: "text-yellow-600" };
  if (value <= 8) return { level: "LOW-MEDIUM", color: "text-green-500" };
  return { level: "LOW", color: "text-green-600" };
};

const getRelationshipIntensityLabel = (value) => {
  if (value <= 2) return "Minimal Contact";
  if (value <= 4) return "Periodic Touch";
  if (value <= 6) return "Regular Engagement";
  if (value <= 8) return "High Touch";
  return "Mission Critical";
};

const getRelationshipIntensityComplexity = (value) => {
  if (value <= 2) return { level: "Simple transition", color: "text-green-600" };
  if (value <= 4) return { level: "Standard transition", color: "text-green-500" };
  if (value <= 6) return { level: "Moderate complexity", color: "text-yellow-600" };
  if (value <= 8) return { level: "Complex transition", color: "text-red-500" };
  return { level: "Critical planning required", color: "text-red-600" };
};

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
    const newPracticeArea = checked 
      ? [...formData.practiceArea, area]
      : formData.practiceArea.filter(a => a !== area);
    
    handleFieldChange('practiceArea', newPracticeArea);
  };

  const handleLobbyistTeamChange = (lobbyist, checked) => {
    const newTeam = checked 
      ? [...formData.lobbyist_team, lobbyist]
      : formData.lobbyist_team.filter(l => l !== lobbyist);
    
    setFormData(prev => ({
      ...prev,
      lobbyist_team: newTeam
    }));
  };

  const handleSliderChange = (field, value) => {
    const numericValue = Array.isArray(value) ? value[0] : value;
    handleFieldChange(field, numericValue);
  };

  const handleRevenueChange = (index, field, value) => {
    const updatedRevenues = formData.revenues.map((rev, i) => 
      i === index ? { ...rev, [field]: value } : rev
    );
    
    setFormData(prev => ({
      ...prev,
      revenues: updatedRevenues
    }));
    
    // Validate the specific revenue entry
    const revenueErrors = validateRevenueEntry(updatedRevenues[index], index);
    if (Object.keys(revenueErrors).length > 0) {
      setErrors(prev => ({
        ...prev,
        [`revenue_${index}`]: Object.values(revenueErrors).join(', ')
      }));
    } else {
      setErrors(prev => {
        const { [`revenue_${index}`]: removed, ...rest } = prev;
        return rest;
      });
    }
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
    const validationErrors = validateClientForm(formData);
    setErrors(validationErrors);
    
    // Log validation for debugging
    if (Object.keys(validationErrors).length > 0) {
      console.log('Validation errors:', validationErrors);
    }
    
    return Object.keys(validationErrors).length === 0;
  };

  // Real-time validation for individual fields
  const handleFieldChange = (fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));
    
    // Validate field in real-time
    setErrors(prev => getFieldError(fieldName, value, prev));
  };

  const handleSave = async () => {
    console.log('handleSave called, formData:', formData);
    
    if (!validateForm()) {
      console.log('Validation failed, stopping save');
      return;
    }
    
    setIsSaving(true);
    
    try {
      // Sanitize form data before sending
      const sanitizedData = sanitizeFormData(formData);
      
      // Clean up revenues - remove empty entries
      const cleanRevenues = sanitizedData.revenues.filter(rev => 
        rev.year && rev.revenue_amount
      ).map(rev => ({
        year: parseInt(rev.year),
        revenue_amount: parseFloat(rev.revenue_amount)
      }));

      const clientData = {
        ...sanitizedData,
        revenues: cleanRevenues
      };

      console.log('Sending sanitized client data:', clientData);
      console.log('Is edit mode:', isEditMode);

      if (isEditMode) {
        console.log('Updating client:', client.id);
        await updateClient(client.id, clientData);
      } else {
        console.log('Adding new client');
        await addClient(clientData);
      }
      
      console.log('Save successful, closing modal');
      closeClientModal();
      
    } catch (error) {
      console.error('Error saving client:', error);
      
      // Handle validation errors from backend
      if (error.message.includes('Validation failed') || error.message.includes('400')) {
        try {
          const errorData = JSON.parse(error.message.split(' – ')[1]);
          if (errorData.details) {
            const backendErrors = {};
            errorData.details.forEach(detail => {
              backendErrors[detail.field] = detail.message;
            });
            setErrors(backendErrors);
            return;
          }
        } catch (parseError) {
          // If we can't parse the error, fall back to general error
        }
      }
      
      setErrors({ general: `Failed to save client data: ${error.message}` });
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
            {isEditMode ? `Edit Client: ${formatClientName(client.name)}` : 'Create New Client'}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="space-y-6 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <TooltipProvider>
          {/* Client Basic Information */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Client Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                placeholder="Enter client name"
                className={errors.name ? 'border-red-500 focus:border-red-500' : ''}
              />
              {errors.name && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.name}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status *</Label>
              <Select 
                value={formData.status} 
                onValueChange={(value) => handleFieldChange('status', value)}
              >
                <SelectTrigger className={errors.status ? 'border-red-500 focus:border-red-500' : ''}>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Prospect">Prospect</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                  <SelectItem value="Former">Former</SelectItem>
                </SelectContent>
              </Select>
              {errors.status && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.status}
                </p>
              )}
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
              key={`conflict-risk-${formData.conflict_risk}`}
              value={formData.conflict_risk} 
              onValueChange={(value) => handleFieldChange('conflict_risk', value)}
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
            {errors.conflict_risk && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.conflict_risk}
              </p>
            )}
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
              <Select 
                value={formData.primary_lobbyist} 
                onValueChange={(value) => handleFieldChange('primary_lobbyist', value)}
              >
                <SelectTrigger className={errors.primary_lobbyist ? 'border-red-500 focus:border-red-500' : ''}>
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
              {errors.primary_lobbyist && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.primary_lobbyist}
                </p>
              )}
            </div>

            {/* Client Originator */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Client Originator</Label>
              <Select 
                value={formData.client_originator} 
                onValueChange={(value) => handleFieldChange('client_originator', value)}
              >
                <SelectTrigger className={errors.client_originator ? 'border-red-500 focus:border-red-500' : ''}>
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
              {errors.client_originator && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.client_originator}
                </p>
              )}
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
            <Label className="text-sm font-medium">Interaction Frequency *</Label>
            <RadioGroup
              key={`interaction-freq-${formData.interaction_frequency}`}
              value={formData.interaction_frequency}
              onValueChange={(value) => handleFieldChange('interaction_frequency', value)}
              className="flex flex-wrap gap-x-4 gap-y-2"
            >
              {['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed'].map((freq) => (
                <div key={freq} className="flex items-center space-x-2">
                  <RadioGroupItem value={freq} id={`freq-${freq}`} />
                  <Label htmlFor={`freq-${freq}`}>{freq}</Label>
                </div>
              ))}
            </RadioGroup>
            {errors.interaction_frequency && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.interaction_frequency}
              </p>
            )}
          </div>

          {/* Relationship Intensity */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm font-medium">
              Relationship Intensity: {formData.relationship_intensity}/10 *
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm p-3">
                  <div className="space-y-2">
                    <p className="font-medium">How operationally critical and frequently engaged is this relationship?</p>
                    <div className="space-y-1 text-sm">
                      <p><strong>1-2:</strong> Minimal Contact (Simple transition)</p>
                      <p><strong>3-4:</strong> Periodic Touch (Standard transition)</p>
                      <p><strong>5-6:</strong> Regular Engagement (Moderate complexity)</p>
                      <p><strong>7-8:</strong> High Touch (Complex transition)</p>
                      <p><strong>9-10:</strong> Mission Critical (Critical planning required)</p>
                    </div>
                    <div className="pt-2 border-t space-y-1 text-xs">
                      <p><strong>Low (2):</strong> Annual compliance filing client with minimal ongoing needs</p>
                      <p><strong>High (8):</strong> Real-time crisis management, daily strategic consultation</p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </Label>
            <div className="space-y-2">
              <Slider
                value={[formData.relationship_intensity]}
                onValueChange={(value) => handleSliderChange('relationship_intensity', value)}
                max={10}
                min={1}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Minimal (1-2)</span>
                <span>Regular (5-6)</span>
                <span>Mission Critical (9-10)</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{getRelationshipIntensityLabel(formData.relationship_intensity)}</span>
                <span className={`font-medium ${getRelationshipIntensityComplexity(formData.relationship_intensity).color}`}>
                  Transition: {getRelationshipIntensityComplexity(formData.relationship_intensity).level}
                </span>
              </div>
            </div>
            {errors.relationship_intensity && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.relationship_intensity}
              </p>
            )}
          </div>

          {/* Relationship Strength */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Heart className="h-4 w-4" />
              Relationship Strength: {formData.relationship_strength}/10 *
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm p-3">
                  <div className="space-y-2">
                    <p className="font-medium">How deeply rooted is this relationship with the firm vs. an individual?</p>
                    <div className="space-y-1 text-sm">
                      <p><strong>1-2:</strong> Personal Relationship (HIGH succession risk)</p>
                      <p><strong>3-4:</strong> Individual-Dependent (MEDIUM-HIGH risk)</p>
                      <p><strong>5-6:</strong> Mixed Loyalty (MEDIUM risk)</p>
                      <p><strong>7-8:</strong> Institutional Ties (LOW-MEDIUM risk)</p>
                      <p><strong>9-10:</strong> Firm-Anchored (LOW risk)</p>
                    </div>
                    <div className="pt-2 border-t space-y-1 text-xs">
                      <p><strong>Low (2):</strong> CEO only talks to the primary lobbyist</p>
                      <p><strong>High (8):</strong> Multiple firm contacts, views firm as strategic partner</p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </Label>
            <div className="space-y-2">
              <Slider
                value={[formData.relationship_strength]}
                onValueChange={(value) => handleSliderChange('relationship_strength', value)}
                max={10}
                min={1}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Personal (1-2)</span>
                <span>Mixed (5-6)</span>
                <span>Firm-Anchored (9-10)</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{getRelationshipStrengthLabel(formData.relationship_strength)}</span>
                <span className={`font-medium ${getRelationshipStrengthRisk(formData.relationship_strength).color}`}>
                  Succession Risk: {getRelationshipStrengthRisk(formData.relationship_strength).level}
                </span>
              </div>
            </div>
            {errors.relationship_strength && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.relationship_strength}
              </p>
            )}
          </div>



          {/* Notes */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notes
            </Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => handleFieldChange('notes', e.target.value)}
              placeholder="Additional notes about this client relationship, strategic considerations, etc."
              rows={4}
              className={errors.notes ? 'border-red-500 focus:border-red-500' : ''}
            />
            {errors.notes && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.notes}
              </p>
            )}
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
        </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClientEnhancementForm;