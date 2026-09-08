import test from 'node:test';
import assert from 'node:assert/strict';
import { palacePreparation } from '../src/lib/palace/preparation.ts';
const bank = (count, status = null) => ({count, status});
test('a card-only note requests quiz and practice banks without regenerating cards', () => {
  assert.deepEqual(palacePreparation({study:bank(20,'ready'),quiz:bank(0),'practice-test':bank(0)}), {ready:false,pending:false,request:['quiz','practice-test']});
});
test('queued generation is awaited and never requested twice', () => {
  assert.deepEqual(palacePreparation({study:bank(20),quiz:bank(0,'queued'),'practice-test':bank(0,'generating')}), {ready:false,pending:true,request:[]});
});
test('a ready bank missing its rows refreshes instead of regenerating', () => {
  assert.deepEqual(palacePreparation({study:bank(20),quiz:bank(0,'ready'),'practice-test':bank(4)}), {ready:false,pending:false,request:[]});
});
test('a failed missing bank can be retried without touching successful banks', () => {
  assert.deepEqual(palacePreparation({study:bank(20),quiz:bank(10),'practice-test':bank(0,'failed')}), {ready:false,pending:false,request:['practice-test']});
});
test('all three available banks open the game immediately', () => {
  assert.deepEqual(palacePreparation({study:bank(20),quiz:bank(10),'practice-test':bank(4)}), {ready:true,pending:false,request:[]});
});
