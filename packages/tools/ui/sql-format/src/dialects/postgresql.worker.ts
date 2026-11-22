// The PostgreSQL formatter's worker: the library's core and this one dialect, a file of its own (serve.ts).
import { serve } from '../serve';
import { postgresql } from 'sql-formatter';

serve(postgresql);
