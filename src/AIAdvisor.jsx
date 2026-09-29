import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Brain, ChevronDown, ChevronUp, CornerDownRight, EyeOff, FileText, History, Loader2, MessageSquare } from 'lucide-react';
import Markdown from 'react-markdown';
import usePortfolioStore from './portfolioStore';
import { apiClient } from './api';
import AIBookPanel from './components/AIBookPanel';
import { EXAMPLE_QUESTIONS, QUESTION_MAX, ratedForStickiness } from './utils/askTheBook';
import {
  answerTitle, FOLLOW_UP_MAX, followUpLine, formatCost, monthLine, rowNotes, savedTurnsBefore, turnsBefore,
} from './utils/recentAnswers';

// The AI tab (docs/plans/tier-1.md, WP3): Ask the book and the brief, both
// answered on the whole book as the server renders it (utils/book.cjs), which
// "What the AI is given" shows. Answers live in the store, so a tab switch
// keeps them. Netlify can publish this page before Render deploys the API, so
// the tab asks /api/health for ask-the-book before it offers Ask or Brief,
// and for ai-answers (WP4) before it shows Recent answers: every partner's
// saved answers, newest first, with this month's count and estimated cost.
// With ai-stream (WP5) an answer shows as it is written, "Thinking… n s"
// until its first words; without it the tab asks for JSON as before. The
// store owns the request either way (askStream), so a tab switch keeps it.
// With ai-threads (Tier 2 WP10, S14, S15) an answer that can be followed up
// offers "Ask a follow-up" (up to five in a thread; the card then shows the
// thread's earlier turns above the answer), a saved answer can be followed
// up from the list too, and any partner can hide an answer from the list,
// see the hidden ones and show one again; the list marks an answer given on
// an earlier book. Without it, none of these show.

const NOT_UPDATED = 'The API has not been updated yet; try again in a few minutes.';
const count = (n) => Number(n || 0).toLocaleString('en-US');

// One AI answer: the markdown body plus the "cut off" / "declined" notices.
// react-markdown at its defaults renders no raw HTML, so the model's output is
// text and markup only. A declined answer has no text (T10).
const AIAnswer = ({ text, truncated, refused, refusalCategory }) => (
  <div>
    {refused && (
      <div className="mb-3 flex items-center gap-2 text-sm text-amber-700">
        <AlertCircle className="h-4 w-4" />
        <span>
          The AI declined to answer this request.{refusalCategory ? ` (Category: ${refusalCategory}.)` : ''}
        </span>
      </div>
    )}
    <div className="ai-markdown text-sm">
      <Markdown>{text || ''}</Markdown>
    </div>
    {truncated && (
      <div className="mt-3 flex items-center gap-2 text-sm text-amber-700">
        <AlertCircle className="h-4 w-4" />
        <span>The response was cut off; ask a narrower question.</span>
      </div>
    )}
  </div>
);

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// A question as the tab quotes it above its answer
const Question = ({ text, testId }) => (
  <p className="whitespace-pre-wrap rounded-md border-l-4 border-muted bg-muted/30 px-3 py-2 text-sm" data-testid={testId}>
    {text}
  </p>
);

// A thread's earlier turns (WP10), oldest first, above the answer being shown:
// each question (the brief has none) and its answer
const ThreadTurns = ({ turns, testId }) => (
  <div className="space-y-4 border-b pb-4" data-testid={`${testId}-thread`}>
    {turns.map((turn, i) => (
      <div key={turn.id ?? i} className="space-y-2" data-testid={`${testId}-turn`}>
        {turn.question ? <Question text={turn.question} /> : <p className="text-xs font-medium text-muted-foreground">Brief</p>}
        <AIAnswer text={turn.answer} truncated={turn.truncated} refused={turn.refused} />
      </div>
    ))}
  </div>
);

// "Ask a follow-up" under an answer that can be followed up (WP10): a box and
// a button, which the store sends with the answer's id as parentId. The
// answer shows in the Ask card (in the brief's card for the brief's own
// thread), with the thread above it. A new answer in the card closes the box.
const FollowUp = ({ slot, parentId, turns, stream, testId, note }) => {
  const { aiStreaming, askStream } = usePortfolioStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => {
    setOpen(false);
    setText('');
  }, [parentId]);
  const pending = Boolean(aiStreaming[slot]);
  if (!open) {
    return (
      <Button variant="outline" size="sm" data-testid={`${testId}-followup`} onClick={() => setOpen(true)} disabled={pending}>
        <CornerDownRight className="mr-2 h-4 w-4" />
        Ask a follow-up
      </Button>
    );
  }
  const send = () => {
    const asked = text.trim();
    if (asked) askStream(slot, asked, { stream, parentId, turns });
  };
  return (
    <div className="space-y-2" data-testid={`${testId}-followup-form`}>
      <Textarea
        data-testid={`${testId}-followup-question`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={QUESTION_MAX}
        rows={2}
        placeholder="Ask about this answer. The AI sees the thread's earlier questions and answers."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" data-testid={`${testId}-followup-submit`} onClick={send} disabled={pending || !text.trim()}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CornerDownRight className="mr-2 h-4 w-4" />}
          {pending ? 'Asking…' : 'Ask the follow-up'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
    </div>
  );
};

// Under an answer, in a thread (WP10): the follow-up box when it can be
// followed up, or why not when the thread is full
const FollowUpOrLimit = ({ canFollowUp, followUp, ...props }) => {
  if (canFollowUp) return <FollowUp {...props} />;
  if (Number.isInteger(followUp) && followUp >= FOLLOW_UP_MAX) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`${props.testId}-followup-limit`}>
        This thread has its {FOLLOW_UP_MAX} follow-ups. Ask a new question to go on.
      </p>
    );
  }
  return null;
};

// Seconds since `startedAt`, ticking once a second while `active`
const useSeconds = (startedAt, active) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
};

// An answer being written (WP5): the question, then "Thinking… n s" until the
// first words, then the words so far. The store updates `text` about ten
// times a second, so this re-renders no faster. When the answer is done, the
// card gives way to the answer as saved (AnswerCard): a refusal's notice
// replaces whatever had streamed.
const LiveAnswer = ({ title, icon: Icon, live, testId }) => {
  const thinking = live.firstTextAt === null;
  const seconds = useSeconds(live.startedAt, thinking);
  return (
    <Card data-testid={`${testId}-live`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Icon className="h-5 w-5" />
          {title}
          <Badge variant="outline" className="text-xs font-normal">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Writing…
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {live.turns?.length > 0 && <ThreadTurns turns={live.turns} testId={testId} />}
        {live.question && <Question text={live.question} />}
        {thinking ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={`${testId}-thinking`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Thinking… {seconds} s
          </div>
        ) : (
          <div className="ai-markdown text-sm" data-testid={`${testId}-live-text`}>
            <Markdown>{live.text}</Markdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// `slot` is the card ('ask' or 'brief'); `threads` whether the API takes
// follow-ups (ai-threads); `stream` whether it streams (ai-stream)
const AnswerCard = ({ title, icon: Icon, result, testId, slot, threads, stream }) => {
  const line = followUpLine(result.followUp);
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Icon className="h-5 w-5" />
          {title}
          <Badge variant="outline" className="text-xs font-normal">
            {new Date(result.timestamp).toLocaleString()}
          </Badge>
          {line && (
            <Badge variant="secondary" className="text-xs font-normal" data-testid={`${testId}-followup-line`}>{line}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.turns?.length > 0 && <ThreadTurns turns={result.turns} testId={testId} />}
        {result.question && <Question text={result.question} testId={`${testId}-question`} />}
        <AIAnswer
          text={result.answer}
          truncated={result.truncated}
          refused={result.refused}
          refusalCategory={result.refusalCategory}
        />
        {result.saved === false && (
          <p className="text-xs text-amber-700" data-testid={`${testId}-not-saved`}>
            This answer could not be saved, so it will not appear under Recent answers. Copy anything you need from it now.
          </p>
        )}
        {threads && (
          <FollowUpOrLimit
            canFollowUp={result.canFollowUp === true && Number.isInteger(result.id)}
            followUp={result.followUp}
            slot={slot}
            parentId={result.id}
            turns={turnsBefore(result)}
            stream={stream}
            testId={testId}
          />
        )}
      </CardContent>
    </Card>
  );
};

// A saved answer opened from the list: who asked and when, the answer as the
// tab renders one, and what it cost. With ai-threads (WP10): the thread's
// earlier turns above it, a note when it was given on an earlier book or is
// hidden, Hide or Show again, and "Ask a follow-up", whose answer shows in the
// Ask card above with the thread.
const SavedAnswer = ({ answer, threads, stream }) => {
  const setAiAnswerHidden = usePortfolioStore((s) => s.setAiAnswerHidden);
  const [busy, setBusy] = useState(false);
  const toggleHidden = async () => {
    setBusy(true);
    try {
      await setAiAnswerHidden(answer.id, !answer.hidden_at);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 border-t px-3 py-3" data-testid="saved-answer">
      {threads && answer.thread?.length > 0 && <ThreadTurns turns={answer.thread} testId="saved-answer" />}
      {answer.kind === 'ask' && answer.question && <Question text={answer.question} />}
      <AIAnswer
        text={answer.answer}
        truncated={answer.truncated}
        refused={answer.refused}
        refusalCategory={answer.refusal_category}
      />
      <p className="text-xs text-muted-foreground" data-testid="saved-answer-meta">
        Asked by {answer.asked_by_username || 'a former account'} on {when(answer.created_at)}.
        {' '}Answered by {answer.served_by || answer.model}
        {answer.fell_back ? ` (after a fallback from ${answer.model})` : ''}.
        {' '}{count(answer.input_tokens)} tokens in, {count(answer.output_tokens)} out,
        {' '}{count(answer.cache_read_tokens)} read from the cache and {count(answer.cache_write_tokens)} written to it.
        {' '}Estimated cost: {formatCost(answer.cost_usd)}
        {answer.prices_read_on ? ` (list prices read on ${answer.prices_read_on})` : ''}.
      </p>
      {threads && answer.earlier_book === true && (
        <p className="text-xs text-amber-700" data-testid="saved-answer-earlier-book">
          Given on an earlier book: the book has changed since, so this answer may not match it, and it cannot be followed up.
        </p>
      )}
      {threads && answer.hidden_at && (
        <p className="text-xs text-muted-foreground" data-testid="saved-answer-hidden">
          Hidden by {answer.hidden_by_username || 'a former account'} on {when(answer.hidden_at)}.
        </p>
      )}
      {threads && (
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="ghost" size="sm" data-testid="saved-answer-hide" onClick={toggleHidden} disabled={busy}>
            <EyeOff className="mr-2 h-4 w-4" />
            {answer.hidden_at ? 'Show again' : 'Hide'}
          </Button>
          <div className="flex-1">
            <FollowUpOrLimit
              canFollowUp={answer.can_follow_up === true}
              followUp={answer.follow_up}
              slot="ask"
              parentId={answer.id}
              turns={savedTurnsBefore(answer)}
              stream={stream}
              testId="saved-answer"
              note="The answer shows under Ask, above."
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Recent answers (WP4): every partner's saved answers, newest first. A row
// opens its answer in place; "Older answers" loads the next page. With
// ai-threads (WP10), "Show hidden" lists the answers hidden from it instead.
const RecentAnswers = ({ threads = false, stream = false }) => {
  const { aiAnswers, fetchOlderAiAnswers, toggleAiAnswer, showHiddenAiAnswers } = usePortfolioStore();
  const { items, hasMore, loaded, loadingOlder, error, summary, details, openId, hidden } = aiAnswers;
  const showingHidden = threads && hidden;

  return (
    <Card data-testid="recent-answers">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <History className="h-5 w-5" />
          {showingHidden ? 'Hidden answers' : 'Recent answers'}
          {threads && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto font-normal"
              data-testid="answers-hidden-toggle"
              onClick={() => showHiddenAiAnswers(!hidden)}
            >
              <EyeOff className="mr-2 h-4 w-4" />
              {hidden ? 'Back to the answers' : 'Show hidden'}
            </Button>
          )}
        </CardTitle>
        {summary && (
          <p className="text-sm text-muted-foreground" data-testid="answers-month">
            {monthLine(summary)}. Estimated from list prices; the Anthropic Console is the bill.
            {threads ? ' Hidden answers count too.' : ''}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!loaded && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the saved answers…
          </div>
        )}
        {error && (
          <Alert variant="destructive" data-testid="answers-error"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        {loaded && items.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            {showingHidden
              ? 'No hidden answers.'
              : 'No answers yet. Every answer the AI gives is saved here for all the partners.'}
          </p>
        )}
        {items.length > 0 && (
          <ul className="divide-y rounded-md border" data-testid="answers-list">
            {items.map((item) => {
              const open = openId === item.id;
              return (
                <li key={item.id} data-testid="answer-row" data-answer-id={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
                    aria-expanded={open}
                    onClick={() => toggleAiAnswer(item.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" data-testid="answer-row-title">{answerTitle(item)}</span>
                      <span className="block text-xs text-muted-foreground" data-testid="answer-row-meta">
                        {[when(item.created_at), item.asked_by_username || 'a former account', ...rowNotes(item)].join(' · ')}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                      <span data-testid="answer-row-cost">{formatCost(item.cost_usd)}</span>
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>
                  {open && (details[item.id]
                    ? <SavedAnswer answer={details[item.id]} threads={threads} stream={stream} />
                    : (
                      <div className="flex items-center gap-2 border-t px-3 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Opening the answer…
                      </div>
                    ))}
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && (
          <Button variant="outline" size="sm" data-testid="answers-older" onClick={fetchOlderAiAnswers} disabled={loadingOlder}>
            {loadingOlder && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Older answers
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

const AIAdvisor = () => {
  const reportingYear = usePortfolioStore((s) => s.getReportingYear());
  const totalRevenue = usePortfolioStore((s) => s.getTotalRevenue());
  const {
    clients,
    aiResults: results,
    aiError: error,
    aiStreaming: inFlight,
    askStream,
    setCurrentView,
    fetchAiAnswers,
  } = usePortfolioStore();
  // checking, ready or unavailable
  const [api, setApi] = useState('checking');
  // Whether this API saves answers and lists them (ai-answers, WP4)
  const [answersApi, setAnswersApi] = useState(false);
  // Whether this API streams answers (ai-stream, WP5); JSON otherwise
  const [streamApi, setStreamApi] = useState(false);
  // Whether this API takes follow-ups and hides answers (ai-threads, Tier 2 WP10)
  const [threadsApi, setThreadsApi] = useState(false);
  const [question, setQuestion] = useState('');
  const pending = { ask: Boolean(inFlight.ask), brief: Boolean(inFlight.brief) };

  const hasData = Array.isArray(clients) && clients.length > 0;
  const rated = ratedForStickiness(clients);

  useEffect(() => {
    let current = true;
    apiClient.get('/api/health')
      .then((health) => {
        if (!current) return;
        const features = Array.isArray(health?.features) ? health.features : [];
        setApi(features.includes('ask-the-book') ? 'ready' : 'unavailable');
        setAnswersApi(features.includes('ai-answers'));
        setStreamApi(features.includes('ai-stream'));
        setThreadsApi(features.includes('ai-threads'));
      })
      .catch(() => { if (current) setApi('unavailable'); });
    return () => { current = false; };
  }, []);

  // The saved answers, each time the tab opens: other partners may have asked since
  useEffect(() => {
    if (answersApi) fetchAiAnswers();
  }, [answersApi, fetchAiAnswers]);

  // When an answer arrives, clear the box only if it still holds the question just answered
  const answeredQuestion = results.ask?.question;
  useEffect(() => {
    if (answeredQuestion) setQuestion((text) => (text.trim() === answeredQuestion ? '' : text));
  }, [answeredQuestion, results.ask]);

  // The store runs the request (askStream), so it outlives this tab; the
  // answer lands in the store and the saved list reloads there
  const run = (kind) => {
    const asked = question.trim();
    if (kind === 'ask' && !asked) return;
    askStream(kind, kind === 'ask' ? asked : null, { stream: streamApi });
  };

  if (!hasData) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Ask the book
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              The book has no clients yet. Import the sheet on Data Upload, then ask about the book here.
            </p>
            <Button variant="outline" onClick={() => setCurrentView('data-upload')}>
              Go to Data Upload
            </Button>
          </CardContent>
        </Card>
        {/* Answers saved on an earlier book stay readable after a reset */}
        {answersApi && <RecentAnswers threads={threadsApi} stream={streamApi} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header: what the AI has to work with */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Ask the book
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-muted-foreground">
            Ask a question about the whole book, or get the brief. The AI answers from the book as the server builds it,
            shown under "What the AI is given"; client notes are never sent.
          </p>
          <div className="grid grid-cols-1 gap-4 rounded-lg bg-muted/30 p-4 md:grid-cols-3">
            <div className="text-center">
              <p className="text-2xl font-bold">{count(clients.length)}</p>
              <p className="text-sm text-muted-foreground">Clients</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">${count(totalRevenue)}</p>
              <p className="text-sm text-muted-foreground">{reportingYear} revenue</p>
            </div>
            <div className="text-center" data-testid="ai-rated">
              <p className="text-2xl font-bold">{count(rated)} of {count(clients.length)}</p>
              <p className="text-sm text-muted-foreground">
                Rated for stickiness{rated < clients.length ? '; the rest count as unknown, never as safe' : ''}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* The book as the AI sees it (WP2) */}
      <AIBookPanel />

      {/* Ask and the brief */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Ask
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {api === 'checking' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking the API…
            </div>
          )}
          {api === 'unavailable' && (
            <Alert data-testid="ask-unavailable"><AlertDescription>{NOT_UPDATED}</AlertDescription></Alert>
          )}
          {api === 'ready' && (
            <>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_QUESTIONS.map((example) => (
                  <Button
                    key={example}
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="ask-example"
                    onClick={() => setQuestion(example)}
                  >
                    {example}
                  </Button>
                ))}
              </div>
              <div>
                <label htmlFor="ask-question" className="mb-2 block text-sm font-medium">
                  Your question
                </label>
                <Textarea
                  id="ask-question"
                  data-testid="ask-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={QUESTION_MAX}
                  rows={3}
                  placeholder="Ask anything the book can answer: loads, exposure, coverage, practice areas, revenue by year."
                />
                {question.length > QUESTION_MAX - 200 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {count(question.length)} of {count(QUESTION_MAX)} characters
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button data-testid="ask-submit" onClick={() => run('ask')} disabled={pending.ask || !question.trim()}>
                  {pending.ask ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-2 h-4 w-4" />}
                  {pending.ask ? 'Asking…' : 'Ask'}
                </Button>
                <Button data-testid="brief-submit" variant="outline" onClick={() => run('brief')} disabled={pending.brief}>
                  {pending.brief ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                  {pending.brief ? 'Writing the brief…' : 'Brief'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The brief covers who's carrying what, where the exposure is, coverage, what's worth a conversation, and
                what the book can't tell you.
                {threadsApi
                  ? ` A new question stands alone. "Ask a follow-up" under an answer sends the thread's earlier questions and answers with it, up to ${FOLLOW_UP_MAX} follow-ups on the same book.`
                  : ' Each question stands alone: the AI does not see earlier answers.'}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600" data-testid="ai-error">
              <AlertCircle className="h-4 w-4" />
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {inFlight.ask?.streamed
        ? <LiveAnswer title="Answer" icon={MessageSquare} live={inFlight.ask} testId="ask-answer" />
        : results.ask && (
          <AnswerCard title="Answer" icon={MessageSquare} result={results.ask} testId="ask-answer" slot="ask" threads={threadsApi} stream={streamApi} />
        )}
      {inFlight.brief?.streamed
        ? <LiveAnswer title="Brief" icon={FileText} live={inFlight.brief} testId="brief-answer" />
        : results.brief && (
          <AnswerCard title="Brief" icon={FileText} result={results.brief} testId="brief-answer" slot="brief" threads={threadsApi} stream={streamApi} />
        )}

      {/* Every partner's saved answers (WP4), only from an API that saves them */}
      {answersApi && <RecentAnswers threads={threadsApi} stream={streamApi} />}
    </div>
  );
};

export default AIAdvisor;
