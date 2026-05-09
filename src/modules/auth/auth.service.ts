import jwt from "jsonwebtoken";

export function generateAccessToken(payload: object) {
  return jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET || "fallbacktoverysecretkeyhehe",
    {
      expiresIn: "1d",
    },
  );
}

export function generateRefreshToken(payload: object) {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET ||
      "fallbacktoverysecretkeyhehekeysecretveryovertofallback",
    {
      expiresIn: "7d",
    },
  );
}
export function generateVerificationToken(payload: { userId: string }) {
  return jwt.sign(
    payload,
    process.env.VERIFICATION_SECRET || "verification-secret-key-123",
    {
      expiresIn: "1h",
    },
  );
}
