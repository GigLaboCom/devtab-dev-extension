/**
 * «Compare code» (D11): two texts or two files → the editor page in the iframe (src/viewer/), whose wasm module
 * compares them (crates/review-view: the comparison lives in Rust, D13) and shows them side by side → the counts come
 * back with the module's answer. Works without any companion — the part a store reviewer can try as it is. Opens with
 * an example so the editor shows a real diff from the first second. Nothing typed or opened here is stored.
 */
import newSample from '@src/compare/fixtures/new.rs?raw';
import oldSample from '@src/compare/fixtures/old.rs?raw';
import { LANGUAGES, languageOfFile } from '@src/compare/languages';
import { Button } from '@src/components/ui/button';
import { Label } from '@src/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@src/components/ui/select';
import { Textarea } from '@src/components/ui/textarea';
import { VIEWER_PAGE } from '@src/shared/pages';
import { isFromViewer } from '@src/shared/viewerProtocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffShown } from '@extension/review-wasm';
import type { ToViewer } from '@src/shared/viewerProtocol';
import type { ChangeEvent, ReactElement } from 'react';

type ViewerState = 'loading' | 'ready' | 'error';

const SidePanel = ({
  side,
  label,
  text,
  fileName,
  onText,
  onFile,
}: {
  side: 'old' | 'new';
  label: string;
  text: string;
  fileName: string;
  onText: (text: string) => void;
  onFile: (file: File) => void;
}): ReactElement => {
  const fieldId = `compare-${side}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label htmlFor={fieldId}>
          {label}
          {fileName && <span className="font-normal text-muted-foreground"> · {fileName}</span>}
        </Label>
        <Button asChild variant="ghost" size="sm">
          <label>
            Open file…
            <input
              type="file"
              className="sr-only"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </Button>
      </div>
      <Textarea
        id={fieldId}
        className="h-42.5 resize-y font-mono text-code field-sizing-fixed [tab-size:4]"
        spellCheck={false}
        value={text}
        onChange={e => onText(e.target.value)}
      />
    </div>
  );
};

export const ComparePage = (): ReactElement => {
  const [oldText, setOldText] = useState(oldSample);
  const [newText, setNewText] = useState(newSample);
  const [oldName, setOldName] = useState('example/old.rs');
  const [newName, setNewName] = useState('example/new.rs');
  const [language, setLanguage] = useState('rust');
  const [viewer, setViewer] = useState<ViewerState>('loading');
  // What the module reports for the latest request: the counts come from the comparison it ran.
  const [result, setResult] = useState<DiffShown | null>(null);
  const [error, setError] = useState<string | null>(null);
  // How many results the editor has reported (on the status line as data-shown, for the e2e check).
  const [shown, setShown] = useState({ count: 0, path: '' });
  const frame = useRef<HTMLIFrameElement>(null);

  // The comparison runs in the editor page's module and answers asynchronously; only the latest request may show
  // its result.
  const request = useRef(0);
  const compare = useCallback(() => {
    const id = ++request.current;
    setError(null);
    const message: ToViewer = {
      type: 'viewer/compare',
      id,
      request: { path: newName || oldName || 'untitled', language, oldText, newText },
    };
    frame.current?.contentWindow?.postMessage(message, location.origin);
  }, [oldText, newText, oldName, newName, language]);

  // The first comparison goes out as soon as the editor has drawn its first frame.
  const compareRef = useRef(compare);
  compareRef.current = compare;
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (!isFromViewer(event.data)) return;
      if (event.data.type === 'viewer/ready') {
        setViewer('ready');
        compareRef.current();
      } else if (event.data.type === 'viewer/shown') {
        if (event.data.id !== request.current) return;
        const { shown: answer } = event.data;
        setResult(answer);
        setShown(s => ({ count: s.count + 1, path: answer.path }));
      } else if (event.data.type === 'viewer/error') {
        if (event.data.id !== undefined && event.data.id !== request.current) return;
        setError(event.data.message);
        setViewer(state => (state === 'loading' ? 'error' : state));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const openFile = (setText: (t: string) => void, setName: (n: string) => void) => (file: File) => {
    file
      .text()
      .then(text => {
        setText(text);
        setName(file.name);
        const detected = languageOfFile(file.name);
        if (detected) setLanguage(detected);
      })
      .catch(e => setError(`Could not read ${file.name}: ${String(e)}`));
  };

  return (
    <section className="kit-section h-full" aria-labelledby="compare-title">
      <header className="kit-section-head">
        <div>
          <h1 id="compare-title" className="kit-section-title">
            Compare code
          </h1>
          <p className="kit-section-hint">
            Paste two versions or open two files. Nothing leaves this page and nothing is stored.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="compare-language" className="text-muted-foreground">
            Language
          </Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger id="compare-language" className="min-w-36">
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
          <Button onClick={compare} disabled={viewer !== 'ready'}>
            Compare
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <SidePanel
          side="old"
          label="Before"
          text={oldText}
          fileName={oldName}
          onText={text => {
            setOldText(text);
            setOldName('');
          }}
          onFile={openFile(setOldText, setOldName)}
        />
        <SidePanel
          side="new"
          label="After"
          text={newText}
          fileName={newName}
          onText={text => {
            setNewText(text);
            setNewName('');
          }}
          onFile={openFile(setNewText, setNewName)}
        />
      </div>

      <div
        className="status-line"
        role="status"
        data-viewer-state={viewer}
        data-shown={shown.count}
        data-shown-path={shown.path}>
        {viewer === 'loading' && 'Loading the editor…'}
        {viewer === 'error' && `The editor could not start${error ? `: ${error}` : '.'}`}
        {viewer === 'ready' &&
          result &&
          (result.changes === 0
            ? 'No differences.'
            : `${result.changes} ${result.changes === 1 ? 'change' : 'changes'} · +${result.added} −${result.removed} lines`)}
        {viewer === 'ready' && error && <span className="text-destructive"> · {error}</span>}
      </div>

      <iframe ref={frame} className="viewer-frame" src={`/${VIEWER_PAGE}`} title="Side-by-side comparison" />
    </section>
  );
};
