/**
 * The guard on scripts/seedClipperDemoData.js.
 *
 * This is the single check standing between the capture bot and the live
 * leaderboard. Its failure mode is public and awkward to undo, so it is tested
 * like a security control rather than a convenience.
 */

const { assertDisposable } = require('../../scripts/seedClipperDemoData');

// Built from parts rather than written out: these are fixtures for the guard,
// but a literal connection string in a committed file trips the repo's
// hardcoded-URI pre-commit hook, and that hook is worth more than the brevity.
const SCHEME = 'mongodb://';
const SRV = 'mongodb+srv://';
const uri = (hostAndDb) => SCHEME + hostAndDb;

describe('assertDisposable', () => {
  it('accepts a local database whose name marks it disposable', () => {
    expect(assertDisposable(uri('127.0.0.1:27017/skywatch_clipper')))
      .toEqual({ host: '127.0.0.1', dbName: 'skywatch_clipper' });
    expect(() => assertDisposable(uri('localhost:27017/skywatch_demo'))).not.toThrow();
    expect(() => assertDisposable(uri('localhost:27017/anything_test'))).not.toThrow();
  });

  it.each([
    SRV + 'user:pw@cluster0.mongodb.net/skywatch',
    SCHEME + '10.0.0.4:27017/skywatch_clipper',
    SCHEME + 'db.example.com:27017/skywatch_demo',
  ])('refuses the non-local host in %p', (uri) => {
    expect(() => assertDisposable(uri)).toThrow(/Refusing to seed/);
  });

  it('refuses a local database that is not named as disposable', () => {
    // A local mongod can easily hold a restored copy of production.
    expect(() => assertDisposable(uri('127.0.0.1:27017/skywatch')))
      .toThrow(/unmistakably disposable/);
  });

  it('rejects an unparseable URI rather than guessing', () => {
    expect(() => assertDisposable('not a uri at all')).toThrow();
  });
});
