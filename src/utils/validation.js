import DOMPurify from 'isomorphic-dompurify';

// Sanitization helper
export const sanitizeInput = (value) => {
  if (typeof value !== 'string') return value;
  return DOMPurify.sanitize(value.trim(), { ALLOWED_TAGS: [] });
};

// Sanitize array of strings
export const sanitizeArray = (array) => {
  if (!Array.isArray(array)) return [];
  return array.map(item => typeof item === 'string' ? sanitizeInput(item) : item);
};

// Validation rules and error messages
export const VALIDATION_RULES = {
  name: {
    required: true,
    minLength: 1,
    maxLength: 255,
    pattern: /^[a-zA-Z0-9\s\-\.,&'()\/]+$/,
    errorMessages: {
      required: 'Client name is required',
      minLength: 'Client name must be at least 1 character',
      maxLength: 'Client name must not exceed 255 characters',
      pattern: 'Client name contains invalid characters'
    }
  },
  
  status: {
    required: true,
    allowedValues: ['Active', 'Prospect', 'Inactive', 'Former'],
    errorMessages: {
      required: 'Status is required',
      allowedValues: 'Status must be one of: Active, Prospect, Inactive, Former'
    }
  },
  
  practiceArea: {
    required: true,
    minItems: 1,
    allowedValues: [
      'Healthcare', 'Municipal', 'Corporate', 'Energy', 
      'Financial', 'Education', 'Transportation', 'Environmental', 
      'Technology', 'Real Estate', 'Non-Profit', 'Other'
    ],
    errorMessages: {
      required: 'At least one practice area must be selected',
      minItems: 'At least one practice area must be selected',
      allowedValues: 'Please select valid practice areas only'
    }
  },
  
  relationship_strength: {
    required: true,
    type: 'integer',
    min: 1,
    max: 10,
    errorMessages: {
      required: 'Relationship strength is required',
      type: 'Relationship strength must be a number',
      min: 'Relationship strength must be at least 1',
      max: 'Relationship strength must not exceed 10'
    }
  },
  
  conflict_risk: {
    required: true,
    allowedValues: ['Low', 'Medium', 'High'],
    errorMessages: {
      required: 'Conflict risk is required',
      allowedValues: 'Conflict risk must be one of: Low, Medium, High'
    }
  },
  
  primary_lobbyist: {
    required: false,
    maxLength: 255,
    pattern: /^[a-zA-Z\s\-'\.]*$/,
    errorMessages: {
      maxLength: 'Primary lobbyist name must not exceed 255 characters',
      pattern: 'Primary lobbyist name contains invalid characters'
    }
  },
  
  client_originator: {
    required: false,
    maxLength: 255,
    pattern: /^[a-zA-Z\s\-'\.]*$/,
    errorMessages: {
      maxLength: 'Client originator name must not exceed 255 characters',
      pattern: 'Client originator name contains invalid characters'
    }
  },
  
  interaction_frequency: {
    required: true,
    allowedValues: ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed'],
    errorMessages: {
      required: 'Interaction frequency is required',
      allowedValues: 'Interaction frequency must be one of: Daily, Weekly, Monthly, Quarterly, As-Needed'
    }
  },
  
  relationship_intensity: {
    required: true,
    type: 'integer',
    min: 1,
    max: 10,
    errorMessages: {
      required: 'Relationship intensity is required',
      type: 'Relationship intensity must be a number',
      min: 'Relationship intensity must be at least 1',
      max: 'Relationship intensity must not exceed 10'
    }
  },
  
  renewal_probability: {
    required: true,
    type: 'float',
    min: 0,
    max: 1,
    errorMessages: {
      required: 'Renewal probability is required',
      type: 'Renewal probability must be a number',
      min: 'Renewal probability must be at least 0',
      max: 'Renewal probability must not exceed 1'
    }
  },
  
  notes: {
    required: false,
    maxLength: 2000,
    errorMessages: {
      maxLength: 'Notes must not exceed 2000 characters'
    }
  }
};

// Validate individual field
export const validateField = (fieldName, value, rules = VALIDATION_RULES[fieldName]) => {
  if (!rules) return null;
  
  const errors = [];
  
  // Required validation
  if (rules.required && (!value || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0))) {
    return rules.errorMessages.required;
  }
  
  // Skip other validations if field is empty and not required
  if (!rules.required && (!value || (typeof value === 'string' && !value.trim()))) {
    return null;
  }
  
  // Type validation
  if (rules.type === 'integer' && (!Number.isInteger(Number(value)) || isNaN(Number(value)))) {
    return rules.errorMessages.type;
  }
  
  if (rules.type === 'float' && (isNaN(Number(value)) || Number(value) === null)) {
    return rules.errorMessages.type;
  }
  
  // Length validation for strings
  if (typeof value === 'string') {
    if (rules.minLength && value.trim().length < rules.minLength) {
      return rules.errorMessages.minLength;
    }
    
    if (rules.maxLength && value.trim().length > rules.maxLength) {
      return rules.errorMessages.maxLength;
    }
    
    // Pattern validation
    if (rules.pattern && !rules.pattern.test(value.trim())) {
      return rules.errorMessages.pattern;
    }
  }
  
  // Numeric range validation
  if (rules.min !== undefined && Number(value) < rules.min) {
    return rules.errorMessages.min;
  }
  
  if (rules.max !== undefined && Number(value) > rules.max) {
    return rules.errorMessages.max;
  }
  
  // Array validation
  if (Array.isArray(value)) {
    if (rules.minItems && value.length < rules.minItems) {
      return rules.errorMessages.minItems;
    }
    
    if (rules.allowedValues) {
      const invalidItems = value.filter(item => !rules.allowedValues.includes(item));
      if (invalidItems.length > 0) {
        return rules.errorMessages.allowedValues;
      }
    }
  }
  
  // Allowed values validation
  if (rules.allowedValues && !Array.isArray(value) && !rules.allowedValues.includes(value)) {
    return rules.errorMessages.allowedValues;
  }
  
  return null;
};

// Validate revenue entry
export const validateRevenueEntry = (revenue, index) => {
  const errors = {};
  const currentYear = new Date().getFullYear();
  
  // Year validation
  if (revenue.year) {
    const year = parseInt(revenue.year);
    if (isNaN(year) || year < 1900 || year > currentYear + 10) {
      errors.year = `Year must be between 1900 and ${currentYear + 10}`;
    }
  } else if (revenue.revenue_amount) {
    errors.year = 'Year is required when revenue amount is specified';
  }
  
  // Revenue amount validation
  if (revenue.revenue_amount) {
    const amount = parseFloat(revenue.revenue_amount);
    if (isNaN(amount) || amount < 0) {
      errors.revenue_amount = 'Revenue amount must be a positive number';
    } else if (amount > 1000000000) {
      errors.revenue_amount = 'Revenue amount exceeds maximum limit (1 billion)';
    }
  } else if (revenue.year) {
    errors.revenue_amount = 'Revenue amount is required when year is specified';
  }
  
  return errors;
};

// Comprehensive form validation
export const validateClientForm = (formData) => {
  const errors = {};
  
  // Validate all standard fields
  Object.keys(VALIDATION_RULES).forEach(fieldName => {
    const error = validateField(fieldName, formData[fieldName]);
    if (error) {
      errors[fieldName] = error;
    }
  });
  
  // Validate lobbyist team array
  if (formData.lobbyist_team && Array.isArray(formData.lobbyist_team)) {
    const sanitizedTeam = sanitizeArray(formData.lobbyist_team);
    if (sanitizedTeam.length !== formData.lobbyist_team.length) {
      errors.lobbyist_team = 'Lobbyist team contains invalid entries';
    }
  }
  
  // Validate revenues
  if (formData.revenues && Array.isArray(formData.revenues)) {
    formData.revenues.forEach((revenue, index) => {
      const revenueErrors = validateRevenueEntry(revenue, index);
      if (Object.keys(revenueErrors).length > 0) {
        errors[`revenue_${index}`] = Object.values(revenueErrors).join(', ');
      }
    });
  }
  
  return errors;
};

// Sanitize form data
export const sanitizeFormData = (formData) => {
  const sanitized = { ...formData };
  
  // Sanitize string fields
  Object.keys(VALIDATION_RULES).forEach(fieldName => {
    if (typeof sanitized[fieldName] === 'string') {
      sanitized[fieldName] = sanitizeInput(sanitized[fieldName]);
    }
  });
  
  // Sanitize arrays
  if (sanitized.practiceArea) {
    sanitized.practiceArea = sanitizeArray(sanitized.practiceArea);
  }
  
  if (sanitized.lobbyist_team) {
    sanitized.lobbyist_team = sanitizeArray(sanitized.lobbyist_team);
  }
  
  return sanitized;
};

// Real-time validation helper for form fields
export const getFieldError = (fieldName, value, currentErrors = {}) => {
  const error = validateField(fieldName, value);
  if (error) {
    return { ...currentErrors, [fieldName]: error };
  } else {
    const { [fieldName]: removed, ...rest } = currentErrors;
    return rest;
  }
};
