export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cinearchive.theme.v1';
export const LIGHT_THEME_COLOR = '#F7F5F0';
export const DARK_THEME_COLOR = '#141210';

export function normalizeThemeMode(value: unknown): ThemeMode | null {
  if (value === 'dark' || value === 'light') {
    return value;
  }
  return null;
}

export function resolveInitialTheme(
  storedValue: string | null | undefined,
  prefersDark = false
): ThemeMode {
  const normalized = normalizeThemeMode(storedValue);
  if (normalized) return normalized;
  return prefersDark ? 'dark' : 'light';
}

export function toggleThemeMode(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark';
}

export function loadSavedTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveInitialTheme(stored, prefersDark);
}

export function saveThemePreference(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = theme === 'dark';
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = theme;

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute(
      'content',
      isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR
    );
  }
}
