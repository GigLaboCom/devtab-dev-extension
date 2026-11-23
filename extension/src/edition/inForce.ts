/**
 * From a source's state to the edition in force — the one place of the assumption "what the product does in each
 * licence state" (the owner decides what happens to what was kept once Pro ends; until then every state that is not
 * Pro behaves as the free build: nothing kept is read or deleted). Changing that is this function, and nothing else.
 */
import { free } from './free';
import { pro } from './pro';
import type { Edition } from './edition';
import type { SourceState } from './source';

/** active, grace → pro; fixed → its edition; every other state (unknown included) → free. */
export const editionFor = (
  state: SourceState,
  editions: { readonly pro: Edition; readonly free: Edition } = { pro, free },
): Edition => {
  switch (state.kind) {
    case 'active':
    case 'grace':
      return editions.pro;
    case 'fixed':
      return state.edition === 'pro' ? editions.pro : editions.free;
    default:
      return editions.free;
  }
};
