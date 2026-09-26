import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { NativeSelect } from '@/components/ui/native-select';
import {
  leadCandidates,
  secondChairCandidates,
  originatorCandidates,
  personLabel,
  toPersonId,
  legacyPeopleFields
} from './utils/people';
import { 
  validateClientForm, 
  sanitizeFormData, 
  getFieldError, 
  validateRevenueEntry
} from './utils/validation';
import {
  X,
  Users,
  Save,
  AlertCircle,
  AlertTriangle,
  Building,
  Heart,
  Shield,
  FileText,
  DollarSign,
  Plus,
  Trash2
} from 'lucide-react';
import usePortfolioStore from './portfolioStore';
import { formatClientName } from './utils/textUtils';
import { clientFormData } from './utils/clientForm';
import { enhanceClientWithSuccessionMetrics, getSuccessionRiskVariant, getRelationshipTypeColor } from './utils/successionUtils';

const ClientEnhancementForm = ({ onClose }) => {
  const { 
    selectedClient, 
    isModalOpen,
    addClient,
    updateClient,
    closeClientModal,
    people,
    peopleError
  } = usePortfolioStore();

  // Determine if this is create or edit mode
  const isEditMode = selectedClient !== null;
  const client = selectedClient;
  
  const [formData, setFormData] = useState({
    name: '',
    practiceArea: [],
    conflict_risk: 'Medium',
    // People as select values: a person id as a string, '' for none
    lead_id: '',
    second_chair_id: '',
    originator_id: '',
    originator_is_firm: false,
    interaction_frequency: 'As-Needed',
    // null is "Not rated": nobody has judged the relationship yet
    stickiness: null,
    high_maintenance: false,
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
      setFormData(clientFormData(client));
    } else {
      // Reset form for new client with an empty revenue row for current year
      setFormData({
        name: '',
        practiceArea: [],
        conflict_risk: 'Medium',
        lead_id: '',
        second_chair_id: '',
        originator_id: '',
        originator_is_firm: false,
        interaction_frequency: 'As-Needed',
        stickiness: null,
        high_maintenance: false,
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

  // A person picker changed. Choosing the current second chair as lead clears
  // the second chair, since one person cannot hold both seats.
  const handlePersonChange = (field, value) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'lead_id' && value && value === prev.second_chair_id) next.second_chair_id = '';
      return next;
    });
    setErrors(prev => {
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
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
        const { [`revenue_${index}`]: _removed, ...rest } = prev;
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
    // Every client has a lead partner (P3); the server checks the rest
    if (!formData.lead_id) validationErrors.lead_id = 'Choose a lead partner.';
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
        lead_id: toPersonId(formData.lead_id),
        second_chair_id: toPersonId(formData.second_chair_id),
        originator_id: toPersonId(formData.originator_id),
        originator_is_firm: formData.originator_is_firm === true,
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

          {/* People: lead, second chair, originator (docs/plans/people-and-second-chair.md, P3, P4) */}
          <div className="space-y-4">
            <Label className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              People
            </Label>

            {peopleError && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {peopleError}
              </p>
            )}

            {isEditMode && !client.lead_id && client.primary_lobbyist && (
              <p className="text-sm text-muted-foreground">
                Recorded before the People list: lead {client.primary_lobbyist}
                {Array.isArray(client.lobbyist_team) && client.lobbyist_team.length > 0 && `, team ${client.lobbyist_team.join(', ')}`}
                {client.client_originator && `, originator ${client.client_originator}`}. Choose from the list below.
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="lead_id" className="text-sm font-medium">Lead partner *</Label>
                <NativeSelect
                  id="lead_id"
                  value={formData.lead_id}
                  onChange={(e) => handlePersonChange('lead_id', e.target.value)}
                  className={errors.lead_id ? 'border-red-500 focus:border-red-500' : ''}
                >
                  <option value="">Choose the lead partner...</option>
                  {leadCandidates(people).map((person) => (
                    <option key={person.id} value={String(person.id)}>{person.name}</option>
                  ))}
                </NativeSelect>
                {errors.lead_id && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.lead_id}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="second_chair_id" className="text-sm font-medium">Second chair</Label>
                <NativeSelect
                  id="second_chair_id"
                  value={formData.second_chair_id}
                  onChange={(e) => handlePersonChange('second_chair_id', e.target.value)}
                  className={errors.second_chair_id ? 'border-red-500 focus:border-red-500' : ''}
                >
                  <option value="">None</option>
                  {secondChairCandidates(people, toPersonId(formData.lead_id)).map((person) => (
                    <option key={person.id} value={String(person.id)}>{personLabel(person)}</option>
                  ))}
                </NativeSelect>
                {errors.second_chair_id && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.second_chair_id}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="originator_id" className="text-sm font-medium">Originator</Label>
              <NativeSelect
                id="originator_id"
                value={formData.originator_id}
                onChange={(e) => handlePersonChange('originator_id', e.target.value)}
                className={errors.originator_id ? 'border-red-500 focus:border-red-500' : ''}
              >
                <option value="">None recorded</option>
                {originatorCandidates(people, toPersonId(formData.originator_id)).map((person) => (
                  <option key={person.id} value={String(person.id)}>{personLabel(person)}</option>
                ))}
              </NativeSelect>
              {errors.originator_id && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.originator_id}
                </p>
              )}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="originator_is_firm"
                  checked={formData.originator_is_firm === true}
                  onCheckedChange={(checked) => handlePersonChange('originator_is_firm', checked === true)}
                />
                <Label htmlFor="originator_is_firm" className="text-sm">
                  Origination credit goes to the firm (the originator's credit has ended, or the firm brought the client in)
                </Label>
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

          {/* High-maintenance ("handful") flag — bumps effort above cadence */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="high_maintenance"
              checked={formData.high_maintenance === true}
              onCheckedChange={(checked) => handleFieldChange('high_maintenance', checked === true)}
            />
            <Label htmlFor="high_maintenance" className="text-sm">
              High-maintenance — each interaction is heavy (counts as extra effort)
            </Label>
          </div>

          {/* Stickiness — how locked-in the relationship is (flight risk) */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Heart className="h-4 w-4" />
              Relationship Stickiness
            </Label>
            <RadioGroup
              key={`stickiness-${formData.stickiness}`}
              value={formData.stickiness === null ? 'none' : String(formData.stickiness)}
              onValueChange={(value) => handleFieldChange('stickiness', value === 'none' ? null : parseInt(value, 10))}
            >
              {[
                [5, "Personal bond — won't leave"],
                [4, 'Strong, established'],
                [3, 'Solid but transactional'],
                [2, 'New / still shallow'],
                [1, 'Cold — never met in person'],
                ['none', 'Not rated — nobody has judged it yet'],
              ].map(([val, label]) => (
                <div key={val} className="flex items-center space-x-2">
                  <RadioGroupItem value={String(val)} id={`stickiness-${val}`} />
                  <Label htmlFor={`stickiness-${val}`}>{label}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Succession Planning Preview */}
          <Card className="succession-preview bg-gray-50 dark:bg-gray-800">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                Succession Planning Impact
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const enhancedClient = enhanceClientWithSuccessionMetrics({
                  ...formData,
                  ...legacyPeopleFields(formData, people)
                });
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Relationship Type</Label>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${getRelationshipTypeColor(enhancedClient.relationshipType).replace('text-', 'bg-')}`} />
                        <Badge 
                          variant="outline"
                          className={`${getRelationshipTypeColor(enhancedClient.relationshipType)}`}
                        >
                          {enhancedClient.relationshipType?.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Transition Complexity</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(enhancedClient.transitionComplexity / 10) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{enhancedClient.transitionComplexity}/10</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Succession Risk</Label>
                      <div className="flex items-center gap-2">
                        <Badge variant={getSuccessionRiskVariant(enhancedClient.successionRisk)}>
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {enhancedClient.successionRisk}/10
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })()}
              
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>Live Preview:</strong> These succession metrics update automatically as you modify relationship data above. 
                  This helps you understand how changes affect succession planning and client transition complexity.
                </p>
              </div>
            </CardContent>
          </Card>

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