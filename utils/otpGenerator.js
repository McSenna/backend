const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const generateOTPWithExpiry = (expiryMinutes = 5) => ({
  otp: generateOTP(),
  expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
});

const isOTPExpired = (expiresAt) => new Date() > new Date(expiresAt);

const verifyOTP = (providedOTP, storedOTP, expiresAt) =>
  providedOTP === storedOTP && !isOTPExpired(expiresAt);

module.exports = { generateOTP, generateOTPWithExpiry, verifyOTP, isOTPExpired };