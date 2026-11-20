/** The JSON tool's page: input, the actions, the result. All logic is in ./logic.ts. */
import { formatJson, locateJsonError, minifyJson } from './logic';
import { createDebug } from '@extension/logger';
import { Button } from '@src/components/ui/button';
import { Checkbox } from '@src/components/ui/checkbox';
import { Label } from '@src/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@src/components/ui/select';
import { Textarea } from '@src/components/ui/textarea';
import { cn } from '@src/lib/utils';
import { useMemo, useState } from 'react';
import type { Indent, JsonResult } from './logic';
import type { ReactElement } from 'react';

const debug = createDebug('extension:tools:json');

const INDENTS: Array<{ value: Indent; label: string }> = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 'tab', label: 'Tab' },
];

const JsonTool = (): ReactElement => {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<Indent>(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [result, setResult] = useState<JsonResult | null>(null);
  const [copied, setCopied] = useState(false);

  const validity = useMemo(() => (input.trim() === '' ? null : locateJsonError(input)), [input]);

  const run = (next: JsonResult): void => {
    setResult(next);
    setCopied(false);
  };

  const copy = (): void => {
    if (!result?.ok) return;
    navigator.clipboard.writeText(result.text).then(
      () => setCopied(true),
      e => debug.warn('copy', e),
    );
  };

  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => run(formatJson(input, { indent, sortKeys }))}>Format</Button>
        <Button variant="outline" onClick={() => run(minifyJson(input, { sortKeys }))}>
          Minify
        </Button>
        <Label htmlFor="json-indent" className="ml-2 text-muted-foreground">
          Indent
        </Label>
        <Select
          value={String(indent)}
          onValueChange={value => setIndent(value === 'tab' ? 'tab' : (Number(value) as Indent))}>
          <SelectTrigger id="json-indent" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDENTS.map(i => (
              <SelectItem key={String(i.value)} value={String(i.value)}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-2 flex items-center gap-2">
          <Checkbox id="json-sort" checked={sortKeys} onCheckedChange={checked => setSortKeys(checked === true)} />
          <Label htmlFor="json-sort" className="font-normal">
            Sort keys
          </Label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex min-h-6 items-center">
            <Label htmlFor="json-input">Input</Label>
          </div>
          <Textarea
            id="json-input"
            className={code}
            spellCheck={false}
            placeholder='{"paste": "JSON here"}'
            value={input}
            onChange={e => setInput(e.target.value)}
          />
          <p className={cn('validity min-h-5 text-sm', validity ? 'text-destructive' : 'text-success')} role="status">
            {input.trim() === ''
              ? ' '
              : validity
                ? `Line ${validity.line}, column ${validity.column}: ${validity.message}`
                : 'Valid JSON'}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex min-h-6 items-center justify-between gap-2">
            <Label htmlFor="json-output">Result</Label>
            <Button variant="ghost" size="sm" onClick={copy} disabled={!result?.ok}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Textarea
            id="json-output"
            className={code}
            spellCheck={false}
            readOnly
            value={result?.ok ? result.text : ''}
          />
          {result && !result.ok && (
            <p className="validity min-h-5 text-sm text-destructive" role="alert">
              Line {result.error.line}, column {result.error.column}: {result.error.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default JsonTool;
