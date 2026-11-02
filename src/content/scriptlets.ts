import { callsFor } from '../engines/adblock/scriptlets.ts';
import { SCRIPTLETS } from '../engines/adblock/scriptlet-impl.ts';

// MAIN world at document_start, in every frame. The `scriptlets/<id>.js` data files run first, in
// the same synchronous pass, so a matching page's scripts cannot run before these hooks.
declare global {
  var __nexusSl: string[] | undefined;
}

const tables = self.__nexusSl ?? [];
delete self.__nexusSl;
const parent = location.ancestorOrigins[0];
const host = location.hostname || (parent ? new URL(parent).hostname : '');
for (const [name, ...args] of callsFor(tables, host)) {
  try {
    SCRIPTLETS[name]?.(...args);
  } catch {
    // One rule failing must not stop the others or disturb the page.
  }
}
