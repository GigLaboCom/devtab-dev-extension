// @vitest-environment node
/**
 * The manifest and the start page's parts hold together: manifest.config.ts derives its permissions from the parts'
 * definitions, so every permission a part declares is in the manifest, of the same kind, and the manifest has no other
 * permission than `storage` (the page's own). scripts/validate-build.sh holds the built manifest to the same
 * definitions (scripts/permissions.mjs). Node, not jsdom: the manifest's module loads the crxjs plugin.
 */
import { partDefinitions } from '.';
import exported from '../../../manifest.config';
import { declaredSectionPermissions, sectionPermissions } from '../../app/sectionPermissions';
import { declaredPermissions } from '../part';
import { describe, expect, it } from 'vitest';

// defineManifest returns the object it was given.
const manifest = exported as chrome.runtime.ManifestV3;

describe('the manifest and the parts', () => {
  const declared = declaredPermissions(partDefinitions());
  const sections = declaredSectionPermissions();

  it('requires `storage` and the parts’ and sections’ required permissions, nothing else', () => {
    expect(manifest.permissions).toEqual(['storage', ...declared.required, ...sections.required]);
  });

  it('declares exactly the parts’ and the sections’ optional permissions as optional', () => {
    expect(manifest.optional_permissions).toEqual([...declared.optional, ...sections.optional]);
  });

  it('asks for nativeMessaging only as the Projects section’s optional permission (§8.3)', () => {
    expect(manifest.permissions).not.toContain('nativeMessaging');
    expect(manifest.optional_permissions).toContain('nativeMessaging');
    expect(sectionPermissions()).toEqual([
      { id: 'projects', permissions: [expect.objectContaining({ name: 'nativeMessaging', optional: true })] },
    ]);
  });

  it.each(partDefinitions().flatMap(p => p.permissions.map(q => [p.id, q.name, q.optional] as const)))(
    '%s: %s is in the manifest as %s',
    (_part, name, optional) => {
      expect(optional ? manifest.optional_permissions : manifest.permissions).toContain(name);
    },
  );
});
