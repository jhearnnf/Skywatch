/**
 * clipperWhisperInstall.test.js
 *
 * Installing whisper.cpp for the captions stage.
 *
 * @remotion/install-whisper-cpp downloads its archive to `process.cwd()` and
 * unpacks it with `Expand-Archive -Force <zip> <dest>` through PowerShell —
 * spawned with `shell: 'powershell'`, which joins argv into one string and
 * quotes nothing. This repo lives under "Cursor Projects", so PowerShell split
 * the path at the space and the install died with "Exit code: 1".
 *
 * The agent therefore controls the paths the library is given. These cover that
 * contract; the download itself is stubbed.
 *
 * Lives here because clipper-agent/ has no test runner of its own.
 */

const path = require('path');
const os = require('os');

const MODULE = '../../../clipper-agent/handlers/captions';

// The module reads WHISPER_DIR at load time, so each case re-requires it.
function load(whisperDir) {
  jest.resetModules();
  if (whisperDir === undefined) delete process.env.WHISPER_DIR;
  else process.env.WHISPER_DIR = whisperDir;
  return require(MODULE);
}

const savedDir = process.env.WHISPER_DIR;
const savedCwd = process.cwd();

afterEach(() => {
  if (savedDir === undefined) delete process.env.WHISPER_DIR;
  else process.env.WHISPER_DIR = savedDir;
  process.chdir(savedCwd);
});

describe('whisperExecutable', () => {
  it('points at the binary for the pinned version', () => {
    const { whisperExecutable } = load(path.join(os.tmpdir(), 'wtest'));
    // 1.5.5 predates the build/bin/whisper-cli layout, so it is `main` at root.
    expect(path.basename(whisperExecutable())).toBe(process.platform === 'win32' ? 'main.exe' : 'main');
    expect(whisperExecutable().startsWith(path.join(os.tmpdir(), 'wtest'))).toBe(true);
  });
});

describe('installWhisper', () => {
  const spaceFreeDir = path.join(os.tmpdir(), 'whisper-test-dir');

  it('runs the installer from a directory with no spaces in its path', async () => {
    const { installWhisper } = load(spaceFreeDir);

    let cwdDuringInstall = null;
    await installWhisper(async () => { cwdDuringInstall = process.cwd(); });

    expect(cwdDuringInstall).not.toBeNull();
    expect(cwdDuringInstall).not.toMatch(/\s/);
  });

  it('passes the destination and pinned version through', async () => {
    const { installWhisper } = load(spaceFreeDir);

    let args = null;
    await installWhisper(async (a) => { args = a; });

    expect(args.to).toBe(spaceFreeDir);
    expect(args.version).toBe('1.5.5');
  });

  it('restores the working directory afterwards', async () => {
    const { installWhisper } = load(spaceFreeDir);
    const before = process.cwd();

    await installWhisper(async () => {});

    expect(process.cwd()).toBe(before);
  });

  // A chdir left behind would silently relocate every later job's relative
  // path, and the agent runs jobs in one long-lived process.
  it('restores the working directory even when the install fails', async () => {
    const { installWhisper } = load(spaceFreeDir);
    const before = process.cwd();

    await expect(installWhisper(async () => { throw new Error('download died'); }))
      .rejects.toThrow('download died');

    expect(process.cwd()).toBe(before);
  });

  // The destination is handed to the same unquoted PowerShell command, so a
  // space there fails the same way — but with an error naming Expand-Archive
  // rather than the setting that caused it.
  it('refuses a destination whose path contains a space', async () => {
    const { installWhisper } = load(path.join(os.tmpdir(), 'whisper dir'));

    const install = jest.fn();
    await expect(installWhisper(install)).rejects.toThrow(/contains a space/);
    await expect(installWhisper(install)).rejects.toThrow(/WHISPER_DIR/);
    expect(install).not.toHaveBeenCalled();
  });
});
