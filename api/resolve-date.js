const { TimeAI } = require('@blueprintlabio/time-ai');

function toTitleCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function subDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function emptyParsed() {
  return {
    resolvedDate: null,
    resolvedDateTime: null,
    actualWeekday: null,
    userWeekday: null,
    spoken: null,
    originalText: null,
    confidence: null,
    type: null,
    grain: null,
  };
}

function defaultClarification(reason) {
  switch (reason) {
    case 'missing_utterance':
      return 'I did not catch the date. Could you repeat it?';
    case 'no_date_found':
      return 'I could not understand the date. Could you say it again differently?';
    case 'weekday_mismatch':
      return 'The weekday and date do not match. Which one should I use?';
    case 'parse_error':
      return 'Something went wrong while reading the date. Could you repeat it?';
    default:
      return 'Could you clarify the date and time?';
  }
}

function buildResponse(overrides = {}) {
  const response = {
    success: false,
    needsClarification: false,
    reason: null,
    originalUtterance: null,
    message: null,
    clarificationPrompt: null,
    parsed: emptyParsed(),
    ...overrides,
    parsed: {
      ...emptyParsed(),
      ...(overrides.parsed || {}),
    },
  };

  if (response.needsClarification && !response.clarificationPrompt) {
    response.clarificationPrompt = defaultClarification(response.reason);
  }

  return response;
}

function buildParsedResult({ utterance, resolved, timezone, type = 'relative', grain = 'day' }) {
  return {
    resolvedDate: dateOnly(resolved, timezone),
    resolvedDateTime: isoWithOffset(resolved, timezone),
    actualWeekday: weekdayOf(resolved, timezone),
    userWeekday: null,
    spoken: formatSpoken(resolved, timezone),
    originalText: utterance,
    confidence: 1,
    type,
    grain,
  };
}

function containsAnyPhrase(text, phrases) {
  return phrases.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    return re.test(text);
  });
}

function preprocessRelativeDate(utterance, timezone, referenceNow) {
  const text = normalizeText(utterance);
  const ref = new Date(referenceNow);

  if (
    containsAnyPhrase(text, [
      'after tomorrow',
      'day after tomorrow',
      'after tmw',
      'overmorrow',
    ])
  ) {
    const resolved = addDays(ref, 2);
    return {
      handled: true,
      parsed: buildParsedResult({
        utterance,
        resolved,
        timezone,
      }),
    };
  }

  if (
    containsAnyPhrase(text, [
      'before yesterday',
      'day before yesterday',
    ])
  ) {
    const resolved = subDays(ref, 2);
    return {
      handled: true,
      parsed: buildParsedResult({
        utterance,
        resolved,
        timezone,
      }),
    };
  }

  return { handled: false };
}

function nextWeekdayDate(anchorDate, targetWeekday, timezone) {
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const target = weekdays.indexOf(targetWeekday);
  if (target < 0) return null;

  const base = new Date(anchorDate);

  for (let i = 1; i <= 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    if (weekdayOf(d, timezone) === targetWeekday) return d;
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json(
      buildResponse({
        reason: 'method_not_allowed',
        message: 'Method not allowed',
        needsClarification: true,
      })
    );
  }

  const {
    utterance,
    timezone = 'America/Montreal',
    referenceNow = new Date().toISOString(),
  } = req.body || {};

  if (!utterance || typeof utterance !== 'string') {
    return res.status(400).json(
      buildResponse({
        reason: 'missing_utterance',
        message: 'Missing required field: utterance',
        needsClarification: true,
        originalUtterance: utterance ?? null,
      })
    );
  }

  try {
    const preprocessed = preprocessRelativeDate(utterance, timezone, referenceNow);

    if (preprocessed.handled) {
      return res.status(200).json(
        buildResponse({
          success: true,
          originalUtterance: utterance,
          message: 'Date resolved successfully',
          parsed: preprocessed.parsed,
        })
      );
    }

    const timeAI = new TimeAI({
      timezone,
      locale: 'en-US',
    });

    const parsed = timeAI.parseDate(utterance, {
      referenceDate: new Date(referenceNow),
    });

    if (!parsed || !parsed.resolvedDate) {
      return res.status(200).json(
        buildResponse({
          reason: 'no_date_found',
          originalUtterance: utterance,
          message: 'Could not resolve a date from the utterance.',
          needsClarification: true,
        })
      );
    }

    const resolved = new Date(parsed.resolvedDate);
    const userWeekday = extractWeekday(utterance);
    const actualWeekday = weekdayOf(resolved, timezone);

    const result = {
      resolvedDate: dateOnly(resolved, timezone),
      resolvedDateTime: isoWithOffset(resolved, timezone),
      actualWeekday,
      userWeekday,
      spoken: formatSpoken(resolved, timezone),
      originalText: parsed.originalText ?? utterance,
      confidence: parsed.confidence ?? null,
      type: parsed.type ?? null,
      grain: parsed.grain ?? null,
    };

    if (userWeekday && userWeekday !== actualWeekday) {
      const alt = nextWeekdayDate(resolved, userWeekday, timezone);
      const altSpoken = alt ? formatSpoken(alt, timezone) : null;

      return res.status(200).json(
        buildResponse({
          reason: 'weekday_mismatch',
          originalUtterance: utterance,
          needsClarification: true,
          clarificationPrompt: altSpoken
            ? `I heard ${userWeekday} in your request, but ${result.spoken} is actually a ${actualWeekday}. Did you mean ${altSpoken}, or ${result.spoken}?`
            : null,
          parsed: result,
        })
      );
    }

    return res.status(200).json(
      buildResponse({
        success: true,
        originalUtterance: utterance,
        message: 'Date resolved successfully',
        parsed: result,
      })
    );
  } catch (error) {
    return res.status(500).json(
      buildResponse({
        reason: 'parse_error',
        originalUtterance: utterance,
        message: error.message || 'Unexpected error',
        needsClarification: true,
      })
    );
  }
};
