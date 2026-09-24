// Password and username rules shared by create-admin.cjs,
// scripts/reset-password.cjs and POST /api/auth/change-password. Pure: no
// database, no environment, so tests can import it.

const MIN_PASSWORD_LENGTH = 8;

/**
 * Validates password strength.
 * @param {unknown} password
 * @returns {{ isValid: boolean, errors: string[] }}
 */
function validatePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { isValid: false, errors: ['Password is required'] };
  }

  const errors = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates a username.
 * @param {unknown} username
 * @returns {{ isValid: boolean, errors: string[] }}
 */
function validateUsername(username) {
  if (typeof username !== 'string' || username.trim().length === 0) {
    return { isValid: false, errors: ['Username is required'] };
  }

  const errors = [];

  if (username.length < 3) {
    errors.push('Username must be at least 3 characters long');
  }

  if (username.length > 50) {
    errors.push('Username must be no more than 50 characters long');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    errors.push('Username can only contain letters, numbers, underscores, and hyphens');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = { MIN_PASSWORD_LENGTH, validatePassword, validateUsername };
