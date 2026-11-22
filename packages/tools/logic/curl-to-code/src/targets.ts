/**
 * The clients the tool writes code for (docs/tools/specs/curl-to-code.md §4, §5 «Код»): their names in the interface,
 * their groups in the picker, and the family module that holds each writer (load.ts). Data only: no writer is here, so
 * the page holds the list without the code of seventeen clients.
 *
 * Order: groups by how widely the language is used (Stack Overflow Developer Survey 2024, «most used languages»; the
 * command line as Bash/Shell), and inside a group the most common client first. The page opens on JavaScript (fetch).
 */
import type { Target } from './types';

/** The module of clients/ a writer lives in: clients of one language share its literals and are loaded together. */
export type Family =
  | 'javascript'
  | 'python'
  | 'shell'
  | 'java'
  | 'csharp'
  | 'php'
  | 'powershell'
  | 'go'
  | 'rust'
  | 'kotlin'
  | 'dart'
  | 'ruby'
  | 'swift';

export interface TargetInfo {
  value: Target;
  /** As the picker and the history label name it. */
  label: string;
  family: Family;
}

export interface TargetGroup {
  label: string;
  targets: readonly TargetInfo[];
}

const t = (value: Target, label: string, family: Family): TargetInfo => ({ value, label, family });

export const TARGET_GROUPS: readonly TargetGroup[] = [
  {
    label: 'JavaScript',
    targets: [
      t('javascript', 'JavaScript (fetch)', 'javascript'),
      t('node', 'Node.js (fetch)', 'javascript'),
      t('axios', 'Node.js (axios)', 'javascript'),
    ],
  },
  {
    label: 'Python',
    targets: [t('python', 'Python (requests)', 'python'), t('http-client', 'Python (http.client)', 'python')],
  },
  { label: 'Command line', targets: [t('httpie', 'HTTPie', 'shell'), t('wget', 'wget', 'shell')] },
  {
    label: 'Other languages',
    targets: [
      t('java', 'Java (HttpClient)', 'java'),
      t('csharp', 'C# (HttpClient)', 'csharp'),
      t('php', 'PHP (cURL)', 'php'),
      t('powershell', 'PowerShell (Invoke-WebRequest)', 'powershell'),
      t('go', 'Go (net/http)', 'go'),
      t('rust', 'Rust (reqwest)', 'rust'),
      t('kotlin', 'Kotlin (OkHttp)', 'kotlin'),
      t('dart', 'Dart (http)', 'dart'),
      t('ruby', 'Ruby (Net::HTTP)', 'ruby'),
      t('swift', 'Swift (URLSession)', 'swift'),
    ],
  },
];

/** Every target, in the picker's order. */
export const TARGETS: readonly TargetInfo[] = TARGET_GROUPS.flatMap(g => g.targets);

/** The target the page opens on (§4). */
export const DEFAULT_TARGET: Target = 'javascript';

export const isTarget = (value: unknown): value is Target => TARGETS.some(x => x.value === value);

export const targetInfo = (target: Target): TargetInfo => TARGETS.find(x => x.value === target)!;
