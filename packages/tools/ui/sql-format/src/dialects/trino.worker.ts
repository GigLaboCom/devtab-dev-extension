// The Trino formatter's worker: the library's core and this one dialect, a file of its own (serve.ts).
import { serve } from '../serve';
import { trino } from 'sql-formatter';

serve(trino);
