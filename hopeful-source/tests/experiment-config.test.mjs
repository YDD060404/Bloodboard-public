import test from 'node:test';import assert from 'node:assert/strict';
import {experimentSettings} from '../src/experiment-config.mjs';
test('B/C share comparison gates and differ only in finite endpoint value; D explicitly reverses fairness',()=>{
 const b=experimentSettings('B'),c=experimentSettings('C');
 for(const key of ['fairExternal','commonSelection','newLearning','immutableRC4'])assert.equal(b[key],c[key]);
 assert.equal(b.valueMode,'legacy-point');assert.equal(c.valueMode,'coordinated-terminal');
 const d=experimentSettings('D');assert.equal(d.commonSelection,false);assert.equal(d.fairExternal,false);assert.equal(d.newLearning,false);
 assert.equal(experimentSettings('A').immutableRC4,true);assert.throws(()=>experimentSettings('E'));
});
