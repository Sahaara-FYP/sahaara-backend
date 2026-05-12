/**
 * Utility to calculate expiration dates based on content type and urgency.
 */
export const calculateExpiryDate = (
  type: "request" | "offer" | "alert",
  urgencyLevel: "high" | "normal" | "low" = "normal",
  isVerified: boolean = false,
): Date => {
  const now = new Date();
  let hours = 0;

  switch (type) {
    case "alert":
      // Alerts are short-lived
      hours = urgencyLevel === "high" ? 24 : 48;
      break;

    case "offer":
      // Offers stay longer
      hours = 24 * 30; // 30 days default
      break;

    case "request":
    default:
      if (urgencyLevel === "high") {
        hours = 48; // 2 days
      } else if (urgencyLevel === "normal") {
        hours = 24 * 7; // 7 days
      } else {
        hours = 24 * 14; // 14 days
      }
      break;
  }

  // Bonus for verified users: +50% duration (optional product rule)
  if (isVerified && type !== "alert") {
    hours *= 1.5;
  }

  return new Date(now.getTime() + hours * 60 * 60 * 1000);
};
