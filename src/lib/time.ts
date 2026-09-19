export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function formatMeetings(
  meetings: { day: string; startMin: number; endMin: number }[],
): string {
  if (meetings.length === 0) return "TBA";
  return meetings
    .map(
      (meeting) =>
        `${meeting.day} ${minutesToTime(meeting.startMin)}–${minutesToTime(meeting.endMin)}`,
    )
    .join(", ");
}
