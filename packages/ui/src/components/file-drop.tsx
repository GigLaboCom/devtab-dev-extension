/**
 * A zone to drop a file on, or to choose one (`kit-file-drop*` in @workspace/dna/style-gpui.css): "Drop a file here or
 * [Choose file]", the hidden `<input type="file">` behind the button, the ring of focus while a file is over it.
 * Neither needs a permission. Files are handed over as they are; reading them is the tool's (`File.arrayBuffer()`).
 *
 *   <FileDrop onFiles={([file]) => open(file)} />
 *   <FileDrop onFiles={…} label="Drop an image here or" accept="image/*">{file && `${file.name} — 4.2 MB`}</FileDrop>
 *
 * One file unless `multiple`; a drop of several when one is expected hands over the first. Children go under the line
 * (the chosen file's name and size, progress, Cancel).
 */
import { Button } from './button';
import { cn } from '../lib/utils';
import { useId, useRef, useState } from 'react';
import type { ComponentProps, DragEvent, ReactElement, ReactNode } from 'react';

export interface FileDropProps extends Omit<ComponentProps<'div'>, 'onDrop'> {
  onFiles: (files: File[]) => void;
  /** The words before the button. */
  label?: ReactNode;
  /** The button's words. */
  choose?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
}

const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

export const FileDrop = ({
  onFiles,
  label = 'Drop a file here or',
  choose = 'Choose file',
  accept,
  multiple = false,
  disabled = false,
  className,
  children,
  ...props
}: FileDropProps): ReactElement => {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [dragging, setDragging] = useState(false);
  // dragenter / dragleave fire for every child the pointer crosses; count them.
  const depth = useRef(0);
  const hand = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      data-slot="file-drop"
      data-dragging={dragging}
      data-disabled={disabled || undefined}
      className={cn('kit-file-drop', className)}
      onDragEnter={event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        hand(event.dataTransfer.files);
      }}
      {...props}>
      <div className="kit-file-drop-line">
        <span id={id}>{label}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-describedby={id}
          onClick={() => input.current?.click()}>
          {choose}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          tabIndex={-1}
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={event => {
            hand(event.currentTarget.files);
            // Choosing the same file again is a choice too.
            event.currentTarget.value = '';
          }}
        />
      </div>
      {children}
    </div>
  );
};
