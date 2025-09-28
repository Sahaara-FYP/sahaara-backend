import jwt from "jsonwebtoken";

export function generateAccessToken(payload: object) {
  return jwt.sign(payload, process.env.JWT_SECRET || "your-secret-key", {
    expiresIn: "15m",
  });
}

export function generateRefreshToken(payload: object) {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET || "your-refresh-secret",
    {
      expiresIn: "7d",
    }
  );
}
