const TZ_NO_COLON = /([+-]\d{2})(\d{2})$/;
const UNIX = /^\d{10,13}$/;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

export function toIso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parseTimestamp(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (UNIX.test(text)) {
    let seconds = Number(text);
    if (seconds > 10_000_000_000) seconds = Math.floor(seconds / 1000);
    return toIso(new Date(seconds * 1000));
  }
  let raw = text.replace("Z", "+00:00");
  if (TZ_NO_COLON.test(raw) && raw.at(-3) !== ":") {
    raw = `${raw.slice(0, -2)}:${raw.slice(-2)}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return toIso(parsed);
}

export function validUsername(username) {
  return USERNAME.test(username);
}
