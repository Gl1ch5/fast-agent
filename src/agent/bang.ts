// "!command" in the input box: run it yourself, without the model. The output goes into the
// conversation, so the next request can refer to it.
import { conv, agent } from './state.ts';
import { toolShell } from '../tools/shell.ts';
import { newCard, finishCard } from '../ui/cards.ts';
import { red } from '../ui/ansi.ts';

export async function runShell(cmd: string) {
  const ctrl = new AbortController();
  agent.ctrl = ctrl; agent.t0 = Date.now();
  const card = newCard(cmd);
  let r;
  try { r = await toolShell({ command: cmd }, ctrl.signal, card); }
  catch (e: any) { r = { text: `error: ${e.message}`, err: true, show: red(e.message) }; }
  finishCard(card, r);
  agent.ctrl = null;
  conv.history.push({ role: 'user', text: `[I ran \`${cmd}\` myself]\n${r.text}` });
}
