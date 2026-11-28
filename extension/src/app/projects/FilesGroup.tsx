/**
 * The «Files» group on the Projects section's home (D42), next to «Scratches»: the single files opened from the
 * computer (by «Open With» or `devtab open <file>`), each with its name, where it is (`~/…`), the quiet marks «read
 * only» and «runs on its own» the companion gives it, and «Forget» — asked first: the file leaves the list and the
 * companion deletes its copies of it; the file itself stays.
 * The group is not there at all while nothing is listed and nothing was ever opened here, nor while the companion does
 * not offer files (ProjectsPage.tsx decides).
 *
 * The two settings that live in the extension (open in this tab, bring the window forward) are here, in both
 * editions. The terminal command that sends a file here is named only where the edition edits these files (Pro): the
 * free page does not advertise it (D42, D40).
 */
import { ForgetFileDialog } from './ForgetFileDialog';
import { TEXT, printable } from './text';
import { routeHash } from '../route';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { Label } from '@workspace/ui/label';
import { XIcon } from 'lucide-react';
import { useState } from 'react';
import type { OpenFilesEdition } from '@src/edition/edition';
import type { OpenedFile } from '@src/projects/openFiles/files';
import type { OpenFilesSettings } from '@src/projects/openFiles/settings';
import type { ReactElement } from 'react';

export interface FilesGroupProps {
  files: readonly OpenedFile[];
  settings: OpenFilesSettings | null;
  onSettings(change: Partial<OpenFilesSettings>): void;
  /** Whether the companion lets the page forget a file (its `welcome` lists the method). */
  canForget: boolean;
  onForget(id: string): Promise<void>;
  edition: OpenFilesEdition;
}

export const FilesGroup = ({
  files,
  settings,
  onSettings,
  canForget,
  onForget,
  edition,
}: FilesGroupProps): ReactElement => {
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<OpenedFile | null>(null);
  const forget = (file: OpenedFile): void => {
    setAsking(null);
    setProblem(null);
    onForget(file.id).catch((error: unknown) =>
      setProblem(TEXT.failed(error instanceof Error ? error.message : String(error))),
    );
  };
  return (
    <section className="kit-projects-home-part" aria-labelledby="opened-files-title">
      <h2 id="opened-files-title" className="kit-projects-part-title">
        {TEXT.openFiles.title}
      </h2>
      <p className="kit-projects-part-hint">{TEXT.openFiles.hint}</p>
      {problem && (
        <p className="kit-projects-note" data-tone="error" role="status">
          {problem}
        </p>
      )}
      {files.length === 0 ? (
        <p className="kit-projects-part-hint">{TEXT.openFiles.empty}</p>
      ) : (
        <ul className="kit-projects-list" aria-label={TEXT.openFiles.listLabel}>
          {files.map(file => {
            const name = printable(file.name);
            return (
              <li key={file.id} className="kit-projects-opened" data-mode={file.mode}>
                <a className="kit-projects-item" href={routeHash({ section: 'projects', file: file.id })}>
                  <span className="kit-projects-item-name">{name}</span>
                  <span className="kit-projects-item-path">{printable(file.displayPath)}</span>
                  {(file.mode === 'read' || file.executes) && (
                    <span className="kit-projects-item-meta">
                      {file.mode === 'read' && (
                        <span className="kit-projects-class" data-class="view" data-mark="read-only">
                          {TEXT.openFiles.markReadOnly}
                        </span>
                      )}
                      {file.executes && (
                        <span className="kit-projects-class" data-mark="executes">
                          {TEXT.openFiles.markExecutes}
                        </span>
                      )}
                    </span>
                  )}
                </a>
                {canForget && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={TEXT.openFiles.forgetOf(name)}
                    title={TEXT.openFiles.forgetTitle}
                    onClick={() => setAsking(file)}>
                    <XIcon aria-hidden="true" />
                    {TEXT.openFiles.forget}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {settings && (
        <fieldset className="kit-projects-opened-settings">
          <legend className="kit-projects-part-hint">{TEXT.openFiles.settingsTitle}</legend>
          <div className="kit-projects-opened-setting">
            <Checkbox
              id="opened-files-reuse-tab"
              checked={settings.reuseTab}
              onCheckedChange={checked => onSettings({ reuseTab: checked === true })}
            />
            <Label htmlFor="opened-files-reuse-tab">{TEXT.openFiles.reuseTab}</Label>
          </div>
          <div className="kit-projects-opened-setting">
            <Checkbox
              id="opened-files-bring-forward"
              checked={settings.bringForward}
              onCheckedChange={checked => onSettings({ bringForward: checked === true })}
            />
            <Label htmlFor="opened-files-bring-forward">{TEXT.openFiles.bringForward}</Label>
          </div>
        </fieldset>
      )}
      <ForgetFileDialog file={asking} onCancel={() => setAsking(null)} onForget={forget} />
      {edition === 'edit' && (
        <p className="kit-projects-part-hint" data-command-hint="">
          {TEXT.openFiles.commandHint} <code className="kit-projects-command">{TEXT.openFiles.command}</code>
        </p>
      )}
    </section>
  );
};
