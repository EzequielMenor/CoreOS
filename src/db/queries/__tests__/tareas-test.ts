import { normalizeDueDate } from '../tareas';

jest.mock('../../index', () => ({
  getDb: jest.fn(),
}));

describe('normalizeDueDate', () => {
  test.each([
    ['hoy', '2026-12-31', '2026-12-31'],
    ['mañana', '2026-12-31', '2027-01-01'],
    ['2026-09-15', '2026-12-31', '2026-09-15'],
  ])('normaliza %s respecto a %s', (raw, hoy, expected) => {
    expect(normalizeDueDate(raw, hoy)).toBe(expected);
  });
});
