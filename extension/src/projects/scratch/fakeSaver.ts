/**
 * A `SideSaver` for tests (src/compare/sideSaver.ts): it keeps what it was asked to save and answers as told — saved
 * (under the suggested name, as a download), cancelled (the picker closed), or failed.
 */
import type { SaveRequest, SaveResult, SideSaver } from '@src/compare/sideSaver';

export const recordingSaver = (
  answer: 'saved' | 'cancelled' | 'failed' = 'saved',
): SideSaver & { requests: SaveRequest[]; answer: typeof answer } => {
  const saver = {
    name: 'recording',
    requests: [] as SaveRequest[],
    answer,
    save: (request: SaveRequest) => saver.saveAs(request),
    saveAs: (request: SaveRequest): Promise<SaveResult> => {
      saver.requests.push(request);
      return Promise.resolve(
        saver.answer === 'saved'
          ? { status: 'saved', fileName: request.suggestedName, handle: null, how: 'download' }
          : saver.answer === 'cancelled'
            ? { status: 'cancelled' }
            : { status: 'failed', message: 'the disk is full' },
      );
    },
  };
  return saver;
};
