// The Convert worker of the swift clients: the tool's core and this family's writers only, a file of its own (serve.ts).
import { serve } from '../serve';
import { swiftClients } from '@workspace/tool-logic-curl-to-code';

serve(swiftClients);
