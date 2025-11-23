export function scaleTime(ms: number): {
  value: number;
  unit: "s" | "m" | "h" | "d";
} {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return { value: seconds, unit: "s" };

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { value: minutes, unit: "m" };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: hours, unit: "h" };

  const days = Math.floor(hours / 24);
  return { value: days, unit: "d" };
}
