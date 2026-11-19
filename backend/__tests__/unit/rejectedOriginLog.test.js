jest.mock('../../models/SystemLog', () => ({
  findOneAndUpdate: jest.fn(() => Promise.resolve()),
}));

const SystemLog = require('../../models/SystemLog');
const { recordRejectedOrigin, isOwnPreviewOrigin } = require('../../utils/rejectedOriginLog');

const req = { originalUrl: '/api/settings', headers: { 'user-agent': 'test' } };

beforeEach(() => SystemLog.findOneAndUpdate.mockClear());

describe('isOwnPreviewOrigin', () => {
  it.each([
    'https://skywatch-8emgy8qkm-james-projects-cecab406.vercel.app',
    'https://skywatch-ogrnsvoae-james-projects-cecab406.vercel.app',
    'https://skywatch-git-main-james-projects-cecab406.vercel.app',
  ])('matches our own preview build %s', (origin) => {
    expect(isOwnPreviewOrigin(origin)).toBe(true);
  });

  it.each([
    'https://evil.vercel.app',
    'https://skywatch-abc-someone-else.vercel.app',
    'https://skywatch-abc-james-projects-cecab406.vercel.app.evil.com',
    'https://evil.com/?skywatch-abc-james-projects-cecab406.vercel.app',
    'http://skywatch-abc-james-projects-cecab406.vercel.app',
    'https://notskywatch-abc-james-projects-cecab406.vercel.app',
    'https://skywatch.academy.evil.com',
    undefined,
    '',
  ])('does not match %s', (origin) => {
    expect(isOwnPreviewOrigin(origin)).toBe(false);
  });
});

describe('recordRejectedOrigin', () => {
  it('skips logging our own preview builds', () => {
    recordRejectedOrigin('https://skywatch-8emgy8qkm-james-projects-cecab406.vercel.app', req);
    expect(SystemLog.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still logs any other unknown origin', () => {
    recordRejectedOrigin('https://scraper.example.com', req);
    expect(SystemLog.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(SystemLog.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      type: 'cors_origin_rejected',
      origin: 'https://scraper.example.com',
    });
  });
});
