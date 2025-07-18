const { body, param, validationResult } = require('express-validator');
const validator = require('validator');

// Sanitization helper
const sanitizeInput = (value) => {
  if (typeof value !== 'string') return value;
  return validator.escape(value).trim();
};

// Custom sanitizer for arrays
const sanitizeArray = (array) => {
  if (!Array.isArray(array)) return [];
  return array.map(item => typeof item === 'string' ? sanitizeInput(item) : item);
};

// Validation rules for client data
const clientValidationRules = [
  // Name validation
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Client name must be between 1 and 255 characters')
    .matches(/^[a-zA-Z0-9\s\-\.,&'()]+$/)
    .withMessage('Client name contains invalid characters')
    .customSanitizer(sanitizeInput),

  // Status validation
  body('status')
    .trim()
    .isIn(['Active', 'Prospect', 'Inactive', 'Former'])
    .withMessage('Status must be one of: Active, Prospect, Inactive, Former')
    .customSanitizer(sanitizeInput),

  // Practice area validation
  body('practiceArea')
    .isArray({ min: 1 })
    .withMessage('At least one practice area must be selected')
    .customSanitizer(sanitizeArray)
    .custom((value) => {
      const validAreas = [
        'Healthcare', 'Municipal', 'Corporate', 'Energy', 
        'Financial', 'Education', 'Transportation', 'Environmental', 
        'Technology', 'Real Estate', 'Non-Profit', 'Other'
      ];
      const invalid = value.filter(area => !validAreas.includes(area));
      if (invalid.length > 0) {
        throw new Error(`Invalid practice areas: ${invalid.join(', ')}`);
      }
      return true;
    }),

  // Relationship strength validation
  body('relationship_strength')
    .isInt({ min: 1, max: 10 })
    .withMessage('Relationship strength must be an integer between 1 and 10'),

  // Conflict risk validation
  body('conflict_risk')
    .trim()
    .isIn(['Low', 'Medium', 'High'])
    .withMessage('Conflict risk must be one of: Low, Medium, High')
    .customSanitizer(sanitizeInput),

  // Primary lobbyist validation
  body('primary_lobbyist')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 255 })
    .withMessage('Primary lobbyist name must not exceed 255 characters')
    .matches(/^[a-zA-Z\s\-'\.]*$/)
    .withMessage('Primary lobbyist name contains invalid characters')
    .customSanitizer(sanitizeInput),

  // Client originator validation
  body('client_originator')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 255 })
    .withMessage('Client originator name must not exceed 255 characters')
    .matches(/^[a-zA-Z\s\-'\.]*$/)
    .withMessage('Client originator name contains invalid characters')
    .customSanitizer(sanitizeInput),

  // Lobbyist team validation
  body('lobbyist_team')
    .optional()
    .isArray()
    .withMessage('Lobbyist team must be an array')
    .customSanitizer(sanitizeArray),

  // Interaction frequency validation
  body('interaction_frequency')
    .trim()
    .isIn(['Daily', 'Weekly', 'Monthly', 'Quarterly', 'As-Needed'])
    .withMessage('Interaction frequency must be one of: Daily, Weekly, Monthly, Quarterly, As-Needed')
    .customSanitizer(sanitizeInput),

  // Relationship intensity validation
  body('relationship_intensity')
    .isInt({ min: 1, max: 10 })
    .withMessage('Relationship intensity must be an integer between 1 and 10'),

  // Renewal probability validation
  body('renewal_probability')
    .isFloat({ min: 0, max: 1 })
    .withMessage('Renewal probability must be a decimal between 0 and 1'),

  // Notes validation
  body('notes')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes must not exceed 2000 characters')
    .customSanitizer(sanitizeInput),

  // Revenues validation
  body('revenues')
    .optional()
    .isArray()
    .withMessage('Revenues must be an array')
    .custom((revenues) => {
      if (!Array.isArray(revenues)) return true;
      
      for (let i = 0; i < revenues.length; i++) {
        const revenue = revenues[i];
        
        // Validate year
        if (!revenue.year || !Number.isInteger(revenue.year)) {
          throw new Error(`Revenue entry ${i + 1}: Year must be an integer`);
        }
        
        if (revenue.year < 1900 || revenue.year > new Date().getFullYear() + 10) {
          throw new Error(`Revenue entry ${i + 1}: Year must be between 1900 and ${new Date().getFullYear() + 10}`);
        }
        
        // Validate revenue amount
        if (revenue.revenue_amount === null || revenue.revenue_amount === undefined) {
          throw new Error(`Revenue entry ${i + 1}: Revenue amount is required`);
        }
        
        const amount = parseFloat(revenue.revenue_amount);
        if (isNaN(amount) || amount < 0) {
          throw new Error(`Revenue entry ${i + 1}: Revenue amount must be a positive number`);
        }
        
        if (amount > 1000000000) { // 1 billion limit
          throw new Error(`Revenue entry ${i + 1}: Revenue amount exceeds maximum limit`);
        }
      }
      
      return true;
    })
];

// Validation rules for revenue data specifically
const revenueValidationRules = [
  body('year')
    .isInt({ min: 1900, max: new Date().getFullYear() + 10 })
    .withMessage(`Year must be between 1900 and ${new Date().getFullYear() + 10}`),
    
  body('revenue_amount')
    .isFloat({ min: 0, max: 1000000000 })
    .withMessage('Revenue amount must be a positive number not exceeding 1 billion')
];

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));
    
    console.log('Validation errors:', errorMessages);
    
    return res.status(400).json({
      error: 'Validation failed',
      details: errorMessages
    });
  }
  
  next();
};

// Additional security middleware for general input sanitization
const sanitizeRequestBody = (req, res, next) => {
  if (req.body) {
    // Recursively sanitize all string values in the request body
    const sanitize = (obj) => {
      if (typeof obj === 'string') {
        return validator.escape(obj.trim());
      } else if (Array.isArray(obj)) {
        return obj.map(sanitize);
      } else if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitize(value);
        }
        return sanitized;
      }
      return obj;
    };
    
    req.body = sanitize(req.body);
  }
  
  next();
};

// ID parameter validation
const idValidationRules = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID must be a positive integer')
];

// Revenue ID parameter validation  
const revenueIdValidationRules = [
  param('revId')
    .isInt({ min: 1 })
    .withMessage('Revenue ID must be a positive integer')
];

module.exports = {
  clientValidationRules,
  revenueValidationRules,
  idValidationRules,
  revenueIdValidationRules,
  handleValidationErrors,
  sanitizeRequestBody,
  sanitizeInput,
  sanitizeArray
};
