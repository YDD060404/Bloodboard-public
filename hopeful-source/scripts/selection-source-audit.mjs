import {originalHeldDirectSource} from './held-direct-transform.mjs';
import {originalExactGeometrySource} from './exact-geometry-transform.mjs';
import {readFileSync} from 'node:fs';
import {originalReplyWindowSource} from './reply-window-transform.mjs';
import {originalRootRefinementSource} from './root-refinement-transform.mjs';
export function originalSelectionSource(source){
 source=originalRootRefinementSource(originalHeldDirectSource(originalExactGeometrySource(source)));
 source=originalReplyWindowSource(source);
 const changes=JSON.parse(readFileSync(new URL('./selection-adapter.json',import.meta.url))).changes;
 if(changes.every(({old,new:adapted})=>source.includes(old)&&!source.includes(adapted)))return source;
 for(const {old,new:adapted} of changes){if(source.split(adapted).length!==2)throw Error('Adapter provenance mismatch');source=source.replace(adapted,old);}
 return source;
}
