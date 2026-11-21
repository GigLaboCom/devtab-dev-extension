// The theme in the e2e checks. The theme is chosen in Settings → Appearance only (the sidebar has no picker since
// 2026-11-21), so a check that wants another theme on the page it is on opens Settings in a tab of its own, chooses
// there, and closes it: the page it is on follows through chrome.storage — what a user with two tabs sees.
//
//   await withSettings(ctx, base, async settings => …)     a Settings tab for the callback, closed after
//   await themeMode(ctx, base, 'Dark')                     'System' | 'Light' | 'Dark'
//   await themeFromList(ctx, base, 'Dark theme', 'Tokyo Night')

/* global document -- page.evaluate callbacks run in the pages */

export const withSettings = async (ctx, base, fn) => {
  const settings = await ctx.newPage();
  try {
    await settings.goto(`${base}#/settings`);
    await settings.getByRole('heading', { name: 'Appearance' }).waitFor({ timeout: 10_000 });
    return await fn(settings);
  } finally {
    await settings.close();
  }
};

export const themeMode = (ctx, base, mode) =>
  withSettings(ctx, base, async settings => {
    await settings
      .getByRole('radiogroup', { name: 'Theme mode' })
      .getByRole('radio', { name: mode, exact: true })
      .click();
    await settings.waitForFunction(
      want => document.querySelector('[data-theme-note]')?.getAttribute('data-theme-note') === want,
      mode.toLowerCase(),
    );
  });

export const themeFromList = (ctx, base, label, name) =>
  withSettings(ctx, base, async settings => {
    await settings.getByLabel(label, { exact: true }).click();
    await settings.getByRole('option', { name, exact: true }).click();
    await settings.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
  });
