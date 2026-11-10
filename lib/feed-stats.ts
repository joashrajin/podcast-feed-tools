export function durationSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.round(seconds) : undefined;
  }
  const parts = text.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return undefined;
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  return undefined;
}

export function describeCadence(dates: Date[]): string | undefined {
  const valid = dates.filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => b.getTime() - a.getTime());
  if (valid.length < 3) return undefined;
  const gaps: number[] = [];
  for (let i = 0; i < valid.length - 1 && gaps.length < 12; i++) {
    gaps.push((valid[i].getTime() - valid[i + 1].getTime()) / 86_400_000);
  }
  const positive = gaps.filter((gap) => gap > 0.05);
  if (positive.length < 2) return undefined;
  const sorted = [...positive].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1];
  if (max > median * 3 && max - median > 10) return "Irregular";
  if (median < 1.6) return "Most days";
  if (median < 2.6) return "About daily";
  if (median < 9) return "About weekly";
  if (median < 18) return "About every two weeks";
  if (median < 45) return "About monthly";
  return "Less often than monthly";
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
