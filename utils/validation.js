const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const validatePassword = (password) => {
  const errors = [];
  if (!password || password.length < 8) errors.push("Password must be at least 8 characters long");
  if (!/[A-Za-z]/.test(password)) errors.push("Password must contain at least one letter");
  if (!/\d/.test(password)) errors.push("Password must contain at least one number");
  return { isValid: errors.length === 0, errors };
};

const isValidFullName = (fullname) => {
  const len = fullname?.trim().length;
  return len >= 2 && len <= 100;
};

const validateDateOfBirth = (dateOfBirth) => {
  try {
    const date = new Date(dateOfBirth);
    const now = new Date();
    if (isNaN(date.getTime())) return { isValid: false, error: "Invalid date format" };
    if (date > now) return { isValid: false, error: "Date of birth cannot be in the future" };
    if (now.getFullYear() - date.getFullYear() < 1) return { isValid: false, error: "Invalid date of birth" };
    return { isValid: true };
  } catch {
    return { isValid: false, error: "Invalid date of birth" };
  }
};

const isValidAddress = (address) => {
  const len = address?.trim().length;
  return len >= 5 && len <= 255;
};

const isValidGender = (gender) =>
  ["male", "female", "other"].includes(gender?.toLowerCase());

const isValidOTP = (otp) =>
  /^\d{6}$/.test(String(otp).trim());

const validateRegistrationPayload = (data) => {
  const errors = [];

  if (!data.fullname) errors.push("Full name is required");
  else if (!isValidFullName(data.fullname)) errors.push("Full name must be between 2 and 100 characters");

  if (!data.email) errors.push("Email is required");
  else if (!isValidEmail(data.email)) errors.push("Invalid email format");

  if (!data.password) errors.push("Password is required");
  else {
    const { isValid, errors: pwErrors } = validatePassword(data.password);
    if (!isValid) errors.push(...pwErrors);
  }

  if (!data.gender) errors.push("Gender is required");
  else if (!isValidGender(data.gender)) errors.push("Gender must be male, female, or other");

  const dob = data.dateOfBirth || data.birthdate;
  if (!dob) errors.push("Date of birth is required");
  else {
    const { isValid, error } = validateDateOfBirth(dob);
    if (!isValid) errors.push(error);
  }

  if (!data.address) errors.push("Address is required");
  else if (!isValidAddress(data.address)) errors.push("Address must be between 5 and 255 characters");

  return { isValid: errors.length === 0, errors };
};

module.exports = {
  isValidEmail,
  validatePassword,
  isValidFullName,
  validateDateOfBirth,
  isValidAddress,
  isValidGender,
  isValidOTP,
  validateRegistrationPayload,
};