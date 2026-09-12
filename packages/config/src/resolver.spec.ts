import { describe, expect, it } from 'vitest';
import { getDefaultGlobalConfigPath } from './index.js';

describe('global configuration paths', () => {
  it('uses XDG_CONFIG_HOME on Linux and macOS when injected', () => {
    expect(
      getDefaultGlobalConfigPath({ env: { XDG_CONFIG_HOME: '/xdg' }, homedir: '/home/user', platform: 'linux' }),
    ).toBe('/xdg/neottia/config.yml');
    expect(
      getDefaultGlobalConfigPath({ env: { XDG_CONFIG_HOME: '/xdg' }, homedir: '/Users/user', platform: 'darwin' }),
    ).toBe('/xdg/neottia/config.yml');
  });

  it('uses platform conventions when XDG_CONFIG_HOME is absent', () => {
    expect(getDefaultGlobalConfigPath({ env: {}, homedir: '/home/user', platform: 'linux' })).toBe(
      '/home/user/.config/neottia/config.yml',
    );
    expect(getDefaultGlobalConfigPath({ env: {}, homedir: '/Users/user', platform: 'darwin' })).toBe(
      '/Users/user/Library/Application Support/neottia/config.yml',
    );
    expect(
      getDefaultGlobalConfigPath({ env: { APPDATA: 'C:\\Users\\user\\AppData\\Roaming' }, platform: 'win32' }),
    ).toBe('C:\\Users\\user\\AppData\\Roaming\\neottia\\config.yml');
  });

  it('uses the conventional Windows roaming directory when APPDATA is absent', () => {
    expect(getDefaultGlobalConfigPath({ env: {}, homedir: 'C:\\Users\\user', platform: 'win32' })).toBe(
      'C:\\Users\\user\\AppData\\Roaming\\neottia\\config.yml',
    );
  });
});
