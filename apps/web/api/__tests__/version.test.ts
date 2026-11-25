import { expect, it, vi } from 'vitest';
import handler from '../version';
import buildInfo from '../../build-info.json';

it('returns embedded build information without authentication or caching', () => {
  const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  handler({}, res);
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(buildInfo);
});
