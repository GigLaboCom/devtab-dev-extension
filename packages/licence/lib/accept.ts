/**
 * Which signed answer the worker may keep (pro-entitlement §4.3). A replayed old answer gives only its old `exp`; an
 * old "revoked" never overrides a newer "active". No request number is needed: the token's own `iat` orders them.
 */
import type { Claims } from './types';

export type Acceptance =
  | { readonly accept: true }
  | { readonly accept: false; readonly why: 'other-licence' | 'other-installation' | 'older' | 'not-active' };

const ACCEPT: Acceptance = { accept: true };

/** May a token from `refresh` replace the one held? Same licence, same installation, issued no earlier. */
export const acceptRefresh = (held: Claims, candidate: Claims): Acceptance => {
  if (candidate.lid !== held.lid) return { accept: false, why: 'other-licence' };
  if (candidate.inst !== held.inst) return { accept: false, why: 'other-installation' };
  if (candidate.iat < held.iat) return { accept: false, why: 'older' };
  return ACCEPT;
};

/** May a token from `activate` be stored for this installation? Only an `active` one for the `inst` sent. */
export const acceptActivation = (inst: string, candidate: Claims): Acceptance => {
  if (candidate.inst !== inst) return { accept: false, why: 'other-installation' };
  if (candidate.status !== 'active') return { accept: false, why: 'not-active' };
  return ACCEPT;
};
