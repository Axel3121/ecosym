export function parseCalendarInstant(value: string): null | number {
  const match = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }
  const daysInMonth =
    month === 2
      ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
        ? 29
        : 28
      : month === 4 || month === 6 || month === 9 || month === 11
        ? 30
        : 31;
  if (day > daysInMonth) {
    return null;
  }
  // Leap seconds are deliberately refused: JavaScript Date cannot represent
  // one, so a stored leap second would have no ordering key and could not be
  // compared against other instants.
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function isRepresentableUtcInstant(value: unknown): value is string {
  return utcInstantOrderingKey(value) !== null;
}

export function isCanonicalUtcInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function utcInstantOrderingKey(value: unknown): null | string {
  if (typeof value !== "string") {
    return null;
  }
  const match =
    /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|\+00:00)$/.exec(
      value,
    );
  if (match === null) {
    return null;
  }
  const milliseconds = parseCalendarInstant(value);
  if (milliseconds === null) {
    return null;
  }
  // The entry pattern above admits only four-digit years, and `toISOString`
  // widens a year to the expanded `+YYYYYY` form only outside that range, so
  // the key is always lexicographically comparable here.
  return new Date(milliseconds).toISOString();
}
