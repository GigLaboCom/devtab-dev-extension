/**
 * The «Scratches» group on the Projects section's home (D34), next to the list of projects — as IntelliJ shows
 * «Scratches and Consoles» under the projects in its tree. A scratch is a file of no project: it needs no companion and
 * is there in every state of the connection.
 *
 * Making one is IntelliJ's «New Scratch File»: the language first (all the editor's languages, the one the last scratch
 * was made in offered), then the scratch opens at once, named `scratch.<extension>` (`scratch_1`, … when taken); it is
 * renamed afterwards. The list is by name, as a tree lists files; each one has its delete button, which asks first.
 * At the limit of scratches the new one is refused with one line saying so.
 */
import { DeleteScratchDialog } from './DeleteScratchDialog';
import { TEXT, formatTime, printable, scratchRefusal } from './text';
import { routeHash } from '../route';
import { LANGUAGES, labelOf } from '@src/compare/languages';
import { fileName } from '@src/projects/scratch/store';
import { Button } from '@workspace/ui/button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ScratchInfo, ScratchList, ScratchStore } from '@src/projects/scratch/store';
import type { ReactElement } from 'react';

export interface ScratchGroupProps {
  store: ScratchStore;
  /** A scratch was made: the page opens it. */
  onCreated(scratch: ScratchInfo): void;
}

export const ScratchGroup = ({ store, onCreated }: ScratchGroupProps): ReactElement => {
  const [list, setList] = useState<ScratchList | null>(null);
  // The language chosen for the next scratch; until the person chooses, the one the last scratch was made in.
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ScratchInfo | null>(null);

  const reload = useCallback(() => {
    let live = true;
    store.list().then(
      next => live && setList(next),
      () => live && setList({ scratches: [], lastLanguage: 'text' }),
    );
    return () => {
      live = false;
    };
  }, [store]);
  useEffect(reload, [reload]);

  const language = chosen ?? list?.lastLanguage ?? 'text';

  const create = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const made = await store.create(language);
    setBusy(false);
    if (made.ok) onCreated(made.value);
    else setProblem(scratchRefusal(made.refused));
  };

  const remove = async (scratch: ScratchInfo): Promise<void> => {
    setDeleting(null);
    const done = await store.remove(scratch.id);
    setProblem(done.ok ? null : scratchRefusal(done.refused));
    reload();
  };

  return (
    <section className="kit-projects-home-part" aria-labelledby="scratches-title">
      <h2 id="scratches-title" className="kit-projects-part-title">
        {TEXT.scratchesTitle}
      </h2>
      <p className="kit-projects-part-hint">{store.keeps ? TEXT.scratchesHint : TEXT.scratchesNotKept}</p>
      <div className="kit-projects-scratch-new">
        <Label htmlFor="scratch-language" className="sr-only">
          {TEXT.newScratchLanguage}
        </Label>
        <Select value={language} onValueChange={setChosen}>
          <SelectTrigger id="scratch-language" className="kit-projects-scratch-language" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map(l => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={busy || !list} onClick={() => void create()}>
          <PlusIcon aria-hidden="true" />
          {TEXT.newScratch}
        </Button>
      </div>
      {problem && (
        <p className="kit-projects-note" data-tone="error" role="status">
          {problem}
        </p>
      )}
      {list && list.scratches.length === 0 && <p className="kit-projects-part-hint">{TEXT.noScratches}</p>}
      {list && list.scratches.length > 0 && (
        <ul className="kit-projects-list" aria-label={TEXT.scratchesTitle}>
          {list.scratches.map(scratch => {
            const name = printable(fileName(scratch));
            return (
              <li key={scratch.id} className="kit-projects-scratch">
                <a
                  className="kit-projects-item"
                  href={routeHash({ section: 'projects', scratch: scratch.id })}
                  data-language={scratch.language}>
                  <span className="kit-projects-item-name">{name}</span>
                  <span className="kit-projects-item-path">{labelOf(scratch.language)}</span>
                  <span className="kit-projects-item-meta">{TEXT.scratchEdited(formatTime(scratch.updatedMs))}</span>
                </a>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={TEXT.deleteScratchOf(name)}
                  title={TEXT.deleteScratchOf(name)}
                  onClick={() => setDeleting(scratch)}>
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <DeleteScratchDialog scratch={deleting} onCancel={() => setDeleting(null)} onDelete={s => void remove(s)} />
    </section>
  );
};
