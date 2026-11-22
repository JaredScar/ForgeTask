import test from 'node:test';
import assert from 'node:assert/strict';
import { heuristicWorkflowFromPrompt } from './ai-heuristic';

void test('a short prompt asks for more detail instead of guessing', () => {
  const draft = heuristicWorkflowFromPrompt(' hi ');
  assert.equal(draft.name, 'Need more detail');
  assert.equal(draft.confidence, 0.2);
  assert.equal(draft.nodes[0]?.['kind'], 'time_schedule');
  assert.equal(draft.nodes[1]?.['kind'], 'show_notification');
});

void test('weekday morning plus an app becomes a schedule and an open action', () => {
  const draft = heuristicWorkflowFromPrompt('every weekday at 9am open Outlook');
  assert.equal(draft.source, 'heuristic');
  assert.equal(draft.nodes[0]?.['kind'], 'time_schedule');
  assert.equal((draft.nodes[0]?.['config'] as { cron: string }).cron, '0 9 * * 1-5');
  assert.equal(draft.nodes[1]?.['kind'], 'open_application');
  assert.equal((draft.nodes[1]?.['config'] as { path: string }).path, 'outlook.exe');
  assert.ok(draft.confidence > 0.5);
});

void test('idle plus mute picks the idle trigger and audio action', () => {
  const draft = heuristicWorkflowFromPrompt('when I am idle for 10 min mute the volume');
  assert.equal(draft.nodes[0]?.['kind'], 'idle_trigger');
  assert.equal((draft.nodes[0]?.['config'] as { idleSeconds: number }).idleSeconds, 600);
  assert.equal(draft.nodes[1]?.['kind'], 'audio_control');
});

void test('an unrecognized prompt still returns one trigger and one action', () => {
  const draft = heuristicWorkflowFromPrompt('do something useful with the widgets please');
  assert.equal(draft.nodes.length, 2);
  assert.equal(draft.nodes[0]?.['node_type'], 'trigger');
  assert.equal(draft.nodes[1]?.['node_type'], 'action');
  assert.ok(draft.confidence < 0.5);
});
