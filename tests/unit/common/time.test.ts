// time.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseInTimezone,
  formatDateInTimezone,
  applyTimeFromReference,
  formatWithOrdinal,
  fromNow,
  isInDefaultTimezone,
  currentTimezone,
} from '../../../src/common/time.js';
import { DEFAULT_TIMEZONE } from '../../../src/common/constants.js';

const originalTZ = process.env.TZ;

function setTimezone(timezone: string) {
  process.env.TZ = timezone;
}

function restoreTimezone() {
  if (originalTZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTZ;
  }
}

describe('parseInTimezone', () => {
  const TEST_TIMEZONES = ['UTC', 'America/Chicago', 'America/New_York', 'Asia/Tokyo', 'Europe/London'];

  describe.each(TEST_TIMEZONES)('when server runs in %s', (serverTimezone) => {
    beforeEach(() => {
      setTimezone(serverTimezone);
    });

    afterEach(() => {
      restoreTimezone();
    });

    it('parses naive datetime string as wall-clock time in target timezone', () => {
      const result = parseInTimezone('2025-06-15T17:00:00', 'America/Chicago');

      // June 15 is during CDT (UTC-5), so 17:00 CDT = 22:00 UTC
      expect(result.toISOString()).toBe('2025-06-15T22:00:00.000Z');
    });

    it('parses naive datetime during CST correctly', () => {
      const result = parseInTimezone('2025-01-15T17:00:00', 'America/Chicago');

      // January is during CST (UTC-6), so 17:00 CST = 23:00 UTC
      expect(result.toISOString()).toBe('2025-01-15T23:00:00.000Z');
    });

    it('parses UTC datetime string (Z suffix) correctly', () => {
      const result = parseInTimezone('2025-06-15T22:00:00Z', 'America/Chicago');

      expect(result.toISOString()).toBe('2025-06-15T22:00:00.000Z');
    });

    it('handles space-separated datetime format', () => {
      const result = parseInTimezone('2025-06-15 17:00:00', 'America/Chicago');

      expect(result.toISOString()).toBe('2025-06-15T22:00:00.000Z');
    });

    it('handles datetime with milliseconds', () => {
      const result = parseInTimezone('2025-06-15T17:30:45.123', 'America/Chicago');

      expect(result.toISOString()).toBe('2025-06-15T22:30:45.123Z');
    });

    it('produces consistent results for different target timezones', () => {
      const dateStr = '2025-06-15T12:00:00';

      const chicagoResult = parseInTimezone(dateStr, 'America/Chicago');
      const tokyoResult = parseInTimezone(dateStr, 'Asia/Tokyo');
      const londonResult = parseInTimezone(dateStr, 'Europe/London');

      // 12:00 Chicago (CDT, UTC-5) = 17:00 UTC
      expect(chicagoResult.toISOString()).toBe('2025-06-15T17:00:00.000Z');

      // 12:00 Tokyo (JST, UTC+9) = 03:00 UTC
      expect(tokyoResult.toISOString()).toBe('2025-06-15T03:00:00.000Z');

      // 12:00 London (BST, UTC+1) = 11:00 UTC
      expect(londonResult.toISOString()).toBe('2025-06-15T11:00:00.000Z');
    });
  });

  describe('DST transitions', () => {
    beforeEach(() => {
      setTimezone('UTC');
    });

    afterEach(() => {
      restoreTimezone();
    });

    it('handles spring forward correctly', () => {
      const result = parseInTimezone('2025-03-09T03:30:00', 'America/Chicago');

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).not.toBeNaN();
    });

    it('handles fall back correctly', () => {
      const result = parseInTimezone('2025-11-02T01:30:00', 'America/Chicago');

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).not.toBeNaN();
    });

    it('correctly differentiates times on either side of DST transition', () => {
      // Day before DST starts (still CST, UTC-6)
      const beforeDST = parseInTimezone('2025-03-08T12:00:00', 'America/Chicago');
      expect(beforeDST.toISOString()).toBe('2025-03-08T18:00:00.000Z');

      // Day after DST starts (now CDT, UTC-5)
      const afterDST = parseInTimezone('2025-03-10T12:00:00', 'America/Chicago');
      expect(afterDST.toISOString()).toBe('2025-03-10T17:00:00.000Z');
    });
  });
});

describe('formatDateInTimezone', () => {
  const TEST_TIMEZONES = ['UTC', 'America/Chicago', 'Asia/Tokyo'];

  describe.each(TEST_TIMEZONES)('when server runs in %s', (serverTimezone) => {
    beforeEach(() => {
      setTimezone(serverTimezone);
    });

    afterEach(() => {
      restoreTimezone();
    });

    it('formats naive datetime to YYYY-MM-DD', () => {
      const result = formatDateInTimezone('2025-06-15T17:00:00', 'America/Chicago');
      expect(result).toBe('2025-06-15');
    });

    it('formats UTC datetime to correct date in target timezone', () => {
      // 2025-06-16T03:00:00Z is still June 15 in Chicago (CDT, UTC-5)
      const result = formatDateInTimezone('2025-06-16T03:00:00Z', 'America/Chicago');
      expect(result).toBe('2025-06-15');
    });

    it('handles date boundary correctly for late night UTC', () => {
      // 2025-06-15T23:00:00Z is June 16 in Tokyo (JST, UTC+9)
      const result = formatDateInTimezone('2025-06-15T23:00:00Z', 'Asia/Tokyo');
      expect(result).toBe('2025-06-16');
    });
  });
});

describe('formatWithOrdinal', () => {
  afterEach(() => {
    restoreTimezone();
  });

  it.each([
    [1, 'st'],
    [2, 'nd'],
    [3, 'rd'],
    [4, 'th'],
    [11, 'th'],
    [12, 'th'],
    [13, 'th'],
    [21, 'st'],
    [22, 'nd'],
    [23, 'rd'],
    [31, 'st'],
  ])('formats day %i with suffix "%s"', (day, suffix) => {
    const paddedDay = String(day).padStart(2, '0');
    const result = formatWithOrdinal(`2025-01-${paddedDay}T15:45:30`, 'America/Chicago');
    expect(result).toContain(`${day}${suffix}`);
  });

  it('formats time in 12-hour format with AM/PM', () => {
    const resultPM = formatWithOrdinal('2025-01-07T15:45:30', 'America/Chicago');
    expect(resultPM).toMatch(/3:45:30\s*PM/i);

    const resultAM = formatWithOrdinal('2025-01-07T09:30:00', 'America/Chicago');
    expect(resultAM).toMatch(/9:30:00\s*AM/i);
  });
});

describe('applyTimeFromReference', () => {
  const TEST_TIMEZONES = ['UTC', 'America/Chicago', 'Europe/London'];

  describe.each(TEST_TIMEZONES)('when server runs in %s', (serverTimezone) => {
    beforeEach(() => {
      setTimezone(serverTimezone);
    });

    afterEach(() => {
      restoreTimezone();
    });

    it('applies time from reference to target date in same DST period', () => {
      const result = applyTimeFromReference(
        '2025-06-20',
        '2025-06-15T14:30:00',
        'America/Chicago'
      );

      expect(result.toISOString()).toBe('2025-06-20T19:30:00.000Z');
    });

    it('returns valid date when reference and target span DST transition', () => {
      const result = applyTimeFromReference(
        '2025-06-20',
        '2025-01-15T14:00:00',
        'America/Chicago'
      );

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).not.toBeNaN();
    });
  });
});

describe('fromNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreTimezone();
  });

  const testCases = [
    { offset: 30 * 1000, expected: 'a few seconds ago' },
    { offset: -30 * 1000, expected: 'in a few seconds' },
    { offset: 2 * 60 * 1000, expected: '2 minutes ago' },
    { offset: -2 * 60 * 1000, expected: 'in 2 minutes' },
    { offset: 3 * 60 * 60 * 1000, expected: '3 hours ago' },
    { offset: -3 * 60 * 60 * 1000, expected: 'in 3 hours' },
    { offset: 5 * 24 * 60 * 60 * 1000, expected: '5 days ago' },
    { offset: -5 * 24 * 60 * 60 * 1000, expected: 'in 5 days' },
  ];

  it.each(testCases)('returns "$expected"', ({ offset, expected }) => {
    const now = new Date('2025-06-15T12:00:00Z');
    vi.setSystemTime(now);

    const targetTime = new Date(now.getTime() - offset);
    const result = fromNow(targetTime.toISOString(), 'UTC');

    expect(result).toBe(expected);
  });
});

describe('isInDefaultTimezone', () => {
  afterEach(() => {
    restoreTimezone();
  });

  it('returns true when system timezone matches default', () => {
    setTimezone(DEFAULT_TIMEZONE);
    expect(isInDefaultTimezone()).toBe(true);
  });

  it('returns false when system timezone differs from default', () => {
    const differentTimezone = 'UTC';
    setTimezone(differentTimezone);
    expect(isInDefaultTimezone()).toBe(false);
  });
});

describe('currentTimezone', () => {
  afterEach(() => {
    restoreTimezone();
  });

  it('returns the current system timezone', () => {
    setTimezone('America/New_York');
    expect(currentTimezone()).toBe('America/New_York');
  });
});

describe('Integration: Discord event scheduling', () => {
  const TEST_TIMEZONES = ['UTC', 'America/Chicago', 'America/Los_Angeles'];

  describe.each(TEST_TIMEZONES)('server running in %s', (serverTimezone) => {
    beforeEach(() => {
      setTimezone(serverTimezone);
    });

    afterEach(() => {
      restoreTimezone();
    });

    it('schedules event at correct UTC time regardless of server timezone', () => {
      const eventStart = '2025-06-15T17:00:00';
      const eventEnd = '2025-06-15T19:00:00';

      const startDate = parseInTimezone(eventStart, 'America/Chicago');
      const endDate = parseInTimezone(eventEnd, 'America/Chicago');

      // 17:00 CDT = 22:00 UTC, 19:00 CDT = 00:00 UTC next day
      expect(startDate.toISOString()).toBe('2025-06-15T22:00:00.000Z');
      expect(endDate.toISOString()).toBe('2025-06-16T00:00:00.000Z');
    });

    it('handles winter event (CST) correctly', () => {
      const eventStart = '2025-01-15T17:00:00';
      const startDate = parseInTimezone(eventStart, 'America/Chicago');

      // 17:00 CST = 23:00 UTC
      expect(startDate.toISOString()).toBe('2025-01-15T23:00:00.000Z');
    });
  });
});
