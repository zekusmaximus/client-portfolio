// A text field as the form sends it: trimmed, and otherwise as the partner
// typed it (docs/plans/tier-2.md, S8, WP5). Until WP5 this ran the text
// through DOMPurify, which dropped anything shaped like a tag (`<b>`) and
// serialized any text holding a `<`, so `R&D < 5%` went out as
// `R&amp;D &lt; 5%` and the server's sanitizer escaped it again. React renders
// every field as text, and the page has no raw-HTML sink.
export const sanitizeInput = (value) => {
  if (typeof value !== 'string') return value;
  return value.trim();
};

// Trim an array of strings
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
    pattern: /^[a-zA-Z0-9\s\-.,&'()/]+$/,
    errorMessages: {
      required: 'Client name is required',
      minLength: 'Client name must be at least 1 character',
      maxLength: 'Client name must not exceed 255 characters',
      pattern: 'Client name contains invalid characters'
    }
  },
  
  // None is allowed, as the server, the import and the book allow it
  // (utils/clientRules.cjs; docs/plans/tier-3.md, U7 (b), WP4): the form used
  // to require one, so a client the import created with no practice area
  // could not be saved from the form, for its Stickiness or anything else,
  // until someone picked an area nobody had chosen
  practiceArea: {
    required: false,
    allowedValues: [
      'Healthcare', 'Municipal', 'Corporate', 'Energy',
      'Financial', 'Education', 'Transportation', 'Environmental',
      'Technology', 'Real Estate', 'Non-Profit', 'Other'
    ],
    errorMessages: {
      allowedValues: 'Please select valid practice areas only'
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
    pattern: /^[a-zA-Z\s\-'.]*$/,
    errorMessages: {
      maxLength: 'Primary lobbyist name must not exceed 255 characters',
      pattern: 'Primary lobbyist name contains invalid characters'
    }
  },
  
  client_originator: {
    required: false,
    maxLength: 255,
    pattern: /^[a-zA-Z\s\-'.]*$/,
    errorMessages: {
      maxLength: 'Client originator name must not exceed 255 characters',
      pattern: 'Client originator name contains invalid characters'
    }
  },
  
  // Blank is "Not set", as the server allows (utils/clientRules.cjs): the
  // form used to require a cadence and fill As-Needed where none was set
  interaction_frequency: {
    required: false,
    allowedValues: ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed'],
    errorMessages: {
      allowedValues: 'Interaction frequency must be one of: Daily, Weekly, Monthly, Quarterly, As-Needed, or Not set'
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

// A revenue row's amount is given when it has a value, 0 included: the API
// sends a stored $0 row's amount as the number 0, which read as missing until
// Tier 3 WP4 (candidate (x)), so such a client could not be saved again. ''
// and a missing amount are none.
const hasAmount = (amount) => amount !== undefined && amount !== null && String(amount).trim() !== '';

// Validate revenue entry. A year with no amount is not an error (Tier 3 WP4,
// candidate (j)): the save sends only the rows with a year and an amount
// (revenuesToSend, src/utils/clientForm.js), so a new client, or a stored one
// with no revenue, saves without any, and the empty row stays in the form for
// the partner to fill.
export const validateRevenueEntry = (revenue, _index) => {
  const errors = {};
  const currentYear = new Date().getFullYear();
  const amountGiven = hasAmount(revenue.revenue_amount);

  // Year validation
  if (revenue.year) {
    const year = parseInt(revenue.year);
    if (isNaN(year) || year < 1900 || year > currentYear + 10) {
      errors.year = `Year must be between 1900 and ${currentYear + 10}`;
    }
  } else if (amountGiven) {
    errors.year = 'Year is required when revenue amount is specified';
  }

  // Revenue amount validation
  if (amountGiven) {
    const amount = parseFloat(revenue.revenue_amount);
    if (isNaN(amount) || amount < 0) {
      errors.revenue_amount = 'Revenue amount must be a positive number';
    } else if (amount > 1000000000) {
      errors.revenue_amount = 'Revenue amount exceeds maximum limit (1 billion)';
    }
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

// The form's data as a save sends it: each text field and list trimmed
// (sanitizeInput), nothing escaped or removed
export const sanitizeFormData = (formData) => {
  const sanitized = { ...formData };
  
  // Trim string fields
  Object.keys(VALIDATION_RULES).forEach(fieldName => {
    if (typeof sanitized[fieldName] === 'string') {
      sanitized[fieldName] = sanitizeInput(sanitized[fieldName]);
    }
  });
  
  // Trim arrays
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
    const { [fieldName]: _removed, ...rest } = currentErrors;
    return rest;
  }
};
