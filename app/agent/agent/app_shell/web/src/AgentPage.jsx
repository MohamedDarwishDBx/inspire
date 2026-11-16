import { useEffect, useRef, useState } from 'react';
import Blocks, { ActionRow } from './AgentBlocks.jsx';
import { AgentSteps, ConfirmCard, StepsDetails } from './AgentParts.jsx';
import { PlainNote } from './ui.jsx';
import { AGENT_ACTION_IDS, APP_ACTION_IDS, askBody, briefingBlocks } from './agentBlocks.js';
import { actRecords, agentAsk, agentBriefing, agentFeedback, agentPrepare, agentThreadSave, agentThreads, agentTurn, agentWrite, getPage, undoRecords } from './api.js';

// The Agent page: a briefing of the records that matter most, a box to ask or act, and the answers as typed blocks.
// The planner runs on the server (shell_agent.py Agent, surface "agent"); every write goes through agent/prepare, a
// confirm card, and records/act, the same write the Work page makes.

const POLL_MS = 1200;
const GIVE_UP_MS = 120000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function AgentPage({ app, page, onRecord, themeKey }) {
  const [briefing, setBriefing] = useState(null);
  const [briefError, setBriefError] = useState('');
  const [text, setText] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const [hold, setHold] = useState(false);
  const [charts, setCharts] = useState(null);
  const alive = useRef(true);
  const [saved, setSaved] = useState({ threads: [], note: '' });
  const threadId = useRef('');

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reloadThreads = () => agentThreads(page.id).then((t) => setSaved({ threads: t.threads || [], note: t.note || '' })).catch((e) => setSaved((s) => ({ ...s, note: e.message })));
  useEffect(() => { threadId.current = ''; reloadThreads(); }, [page.id]);

  useEffect(() => {
    let live = true;
    setBriefing(null);
    setBriefError('');
    agentBriefing(page.id)
      .then((b) => { if (live) setBriefing(b); })
      .catch((e) => { if (live) setBriefError(e.message); });
    return () => { live = false; };
  }, [page.id]);

  const ticketActions = (briefing?.actions || []).filter((a) => AGENT_ACTION_IDS.includes(a));

  const patch = (id, change) => setThread((t) => t.map((x) => (x.id === id ? { ...x, ...change } : x)));
  const patchConfirm = (id, change) => setThread((t) => t.map((x) => (x.id === id ? { ...x, confirm: { ...x.confirm, ...change } } : x)));

  const write = async (c, update) => {
    update({ state: 'saving', error: '' });
    try {
      if (!c.route) { update({ state: 'saved', result: { written: [] } }); return; }
      const result = c.route === 'records/act' ? await actRecords(c.body) : { ...(await agentWrite(c.route, c.body)), app: true };
      update({ state: 'saved', result });
    } catch (e) {
      update({ state: 'ask', error: e.message });
    }
  };
  const undo = async (c, update) => {
    try {
      await undoRecords({ page: c.body.page, batch_id: c.result.batch_id });
      update({ state: 'undone' });
    } catch (e) {
      update({ error: e.message });
    }
  };
  const prepare = async (action, keys, values = {}) => {
    const { confirm } = await agentPrepare({ page: page.id, action, record_keys: keys, ...values });
    return { ...confirm, state: 'ask' };
  };
  const loadCharts = () => {
    if (charts) return;
    getPage(page.id, {}).then((d) => setCharts(d?.charts || {})).catch(() => setCharts({}));
  };

  const ask = async (question) => {
    const q = String(question || '').trim();
    if (!q) return;
    if (busy) { setHold(true); return; }
    setHold(false);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const history = thread.filter((x) => x.turn).map((x) => ({ question: x.question, answer: x.turn.answer || '' }));
    setBusy(true);
    setText('');
    setThread((t) => [...t, { id, question: q, turn: null, error: '' }]);
    try {
      let turn = await agentAsk(askBody(page.id, q, history));
      const until = Date.now() + GIVE_UP_MS;
      while (turn.state === 'running') {
        patch(id, { turn: { steps: turn.steps || [] } });
        await sleep(POLL_MS);
        if (!alive.current) return;
        if (Date.now() > until) throw new Error('The agent took longer than two minutes. Ask a narrower question.');
        turn = await agentTurn(turn.turn_id);
      }
      if (turn.state === 'failed') throw new Error(turn.error || 'The agent could not answer this question.');
      patch(id, { turn, confirm: turn.confirm ? { ...turn.confirm, state: 'ask' } : null });
      agentThreadSave({ page: page.id, turn_id: turn.turn_id, thread_id: threadId.current })
        .then((r) => { threadId.current = r.thread_id; reloadThreads(); })
        .catch((e) => setSaved((x) => ({ ...x, note: `Not saved: ${e.message}` })));
      if ((turn.blocks || []).some((b) => b.type === 'chart')) loadCharts();
    } catch (e) {
      patch(id, { error: e.message });
    } finally {
      setBusy(false);
    }
  };

  const ctxFor = (item) => ({
    page, app, charts, themeKey, ticketActions, statuses: briefing?.statuses || [],
    turnId: item?.turn?.turn_id || '',
    openRecord: (key) => onRecord?.(page.id, key),
    ask,
    prepare,
    confirm: (c, update) => write(c, update),
    undo: (c, update) => undo(c, update),
    rate: (rating) => item?.turn?.turn_id && agentFeedback(item.turn.turn_id, rating),
  });

  const briefCtx = ctxFor(null);
  const shown = briefing ? briefingBlocks(briefing) : [];

  return (
    <section className="agp" aria-label="Agent" data-agent-page={page.id}>
      <header className="agp-head">
        <h2>Agent</h2>
        <p>{page.question || page.title}</p>
      </header>

      <section className="agp-brief" aria-label="Briefing">
        <h3>What to do first</h3>
        {briefError && <PlainNote text={briefError} className="g-err" role="alert" />}
        {!briefing && !briefError && <p className="agp-meta">Loading the briefing</p>}
        {briefing && briefing.total === 0 && <p className="agp-meta">No open records on this use case.</p>}
        {briefing && shown.length > 0 && <Blocks blocks={shown} ctx={briefCtx} />}
        <div className="agp-app-actions" aria-label="Changes to this use case">
          <ActionRow keys={[]} actions={APP_ACTION_IDS} ctx={briefCtx} />
        </div>
        {briefing && briefing.total > 0 && (
          <p className="agp-meta">{briefing.total} open {briefing.total === 1 ? 'record' : 'records'}; the top {Math.min(3, briefing.total)} by value at stake.</p>
        )}
      </section>

      <form className="agp-ask" role="search" aria-label="Ask the agent" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input type="text" dir="auto" value={text} onChange={(e) => { setText(e.target.value); setHold(false); }} placeholder="Ask about this use case, or tell me what to do"
          aria-label="Ask the agent" />
        <button type="submit" className="btn btn--pri" disabled={!text.trim()}>Ask</button>
      </form>
      {hold && <p className="agp-meta" role="status">Wait for the current answer, then ask again</p>}

      <div className="agp-chips" role="group" aria-label="Suggested questions">
        {(briefing?.chips || []).map((c, i) => (
          <button key={`${i}-${c}`} type="button" className="sugg" disabled={busy} onClick={() => ask(c)}>{c}</button>
        ))}
      </div>

      <details className="agp-saved" aria-label="Saved conversations">
        <summary>Saved conversations ({saved.threads.length})</summary>
        {saved.note && <p className="agp-meta" role="note">{saved.note}</p>}
        <ul>
          {saved.threads.map((t) => (
            <li key={t.thread_id}>
              <details>
                <summary>{t.title || 'Conversation'} <small>{t.turns.length} {t.turns.length === 1 ? 'question' : 'questions'}</small></summary>
                {t.turns.map((turn, i) => (
                  <div key={i} className="agp-turn">
                    <p className="agp-q">{turn.question}</p>
                    {turn.blocks.length > 0 ? <Blocks blocks={turn.blocks} ctx={ctxFor(null)} /> : <p>{turn.answer}</p>}
                  </div>
                ))}
              </details>
            </li>
          ))}
        </ul>
      </details>

      <ol className="agp-thread" aria-label="Conversation">
        {thread.map((item) => (
          <li key={item.id} className="agp-turn" data-turn={item.turn?.turn_id || ''}>
            <p className="agp-q">{item.question}</p>
            {item.turn?.steps?.length > 0 && <StepsDetails steps={item.turn.steps} />}
            {!item.turn && !item.error && <p className="agp-meta">Reading your question</p>}
            {item.error && <PlainNote text={item.error} className="g-err" role="alert" />}
            {item.turn?.blocks && <Blocks blocks={item.turn.blocks} ctx={ctxFor(item)} />}
            {item.confirm && (
              <ConfirmCard confirm={item.confirm} write="work:agent"
                onConfirm={() => write(item.confirm, (p) => patchConfirm(item.id, p))}
                onCancel={() => patchConfirm(item.id, { state: 'cancelled' })}
                onUndo={() => undo(item.confirm, (p) => patchConfirm(item.id, p))} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
