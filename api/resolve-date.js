const { TimeAI } = require('@blueprintlabio/time-ai');

function toTitleCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

function extractWeekday(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  return match ? toTitleCase(match[1]) : null;
}

function weekdayOf(date, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: timezone,
  }).format(date);
}

function dateOnly(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatSpoken(date, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(date);
}

function isoWithOffset(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const local = new Date(`${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}Z`);
  const offsetMinutes = Math.round((local.getTime() - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');

  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}${sign}${hh}:${mm}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { utterance, timezone = 'America/Montreal', referenceNow = new Date().toISOString() } = req.body || {};

  if (!utterance || typeof utterance !== 'string') {
    return res.status(400).json({
      success: false,
      needsClarification: true,
      reason: 'missing_utterance',
      message: 'Missing required field: utterance'
    });
  }

  try {
    const timeAI = new TimeAI({
      timezone,
      locale: 'en-US'
    });

    const parsed = timeAI.parseDate(utterance, {
      referenceDate: new Date(referenceNow)
    });

    if (!parsed || !parsed.resolvedDate) {
      return res.status(200).json({
        success: false,
        needsClarification: true,
        reason: 'no_date_found',
        originalUtterance: utterance,
        message: 'Could not resolve a date from the utterance.'
      });
    }

    const resolved = new Date(parsed.resolvedDate);
    const userWeekday = extractWeekday(utterance);
    const actualWeekday = weekdayOf(resolved, timezone);

    return res.status(200).json({
      success: true,
      needsClarification: userWeekday ? userWeekday !== actualWeekday : false,
      reason: userWeekday && userWeekday !== actualWeekday ? 'weekday_mismatch' : null,
      originalUtterance: utterance,
      parsed: {
        resolvedDate: dateOnly(resolved, timezone),
        resolvedDateTime: isoWithOffset(resolved, timezone),
        actualWeekday,
        userWeekday,
        spoken: formatSpoken(resolved, timezone),
        originalText: parsed.originalText ?? utterance,
        confidence: parsed.confidence ?? null,
        type: parsed.type ?? null,
        grain: parsed.grain ?? null
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      needsClarification: true,
      reason: 'parse_error',
      message: error.message || 'Unexpected error'
    });
  }
};
