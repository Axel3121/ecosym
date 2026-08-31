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
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function isRepresentableUtcInstant(value: unknown): value is string {
  return utcInstantOrderingKey(value) !== null;
}

export function isCanonicalUtcInstant(value: unknown): value is string {
  return isRepresentableUtcInstant(value);
}

export function utcInstantOrderingKey(value: unknown): null | string {
  if (typeof value !== "string") {
    return null;
  }
  const match =
    /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|\+00:00)$/.exec(
      value,
    );
  if (match === null || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return null;
  }
  // Leap seconds are deliberately refused: Date cannot represent, order, or compare them.
  if (Number(match[3]) > 59) {
    return null;
  }
  const milliseconds = parseCalendarInstant(value);
  if (milliseconds === null) {
    return null;
  }
  const orderingKey = new Date(milliseconds).toISOString();
  return /^\d{4}-/.test(orderingKey) ? orderingKey : null;
}
