export type ExpiryStatus = "expired" | "expiring_soon" | "good" | "no_expiry";

export type ExpiryInfo = {
  status: ExpiryStatus;
  daysRemaining: number | null;
  label: string;
};

/**
 * Calculates expiry status and remaining days relative to today.
 * Threshold defaults to 30 days.
 */
export function calculateExpiryStatus(
  expiryDateStr?: string | null,
  thresholdDays: number = 30,
): ExpiryInfo {
  if (!expiryDateStr || !expiryDateStr.trim()) {
    return { status: "no_expiry", daysRemaining: null, label: "No expiry" };
  }

  const parsed = new Date(expiryDateStr);
  if (isNaN(parsed.getTime())) {
    return { status: "no_expiry", daysRemaining: null, label: "Invalid date" };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);

  const diffTime = parsed.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const expiredDaysAgo = Math.abs(diffDays);
    return {
      status: "expired",
      daysRemaining: diffDays,
      label: expiredDaysAgo === 1 ? "Expired 1 day ago" : `Expired ${expiredDaysAgo} days ago`,
    };
  }

  if (diffDays <= thresholdDays) {
    return {
      status: "expiring_soon",
      daysRemaining: diffDays,
      label: diffDays === 0 ? "Expires today" : diffDays === 1 ? "Expires in 1 day" : `Expires in ${diffDays} days`,
    };
  }

  return {
    status: "good",
    daysRemaining: diffDays,
    label: `Expires in ${diffDays} days`,
  };
}
