import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Brain, ChevronDown, ChevronUp, FileText, History, Loader2, MessageSquare } from 'lucide-react';
import Markdown from 'react-markdown';
import usePortfolioStore from './portfolioStore';
import { apiClient, apiErrorMessage } from './api';
import AIBookPanel from './components/AIBookPanel';
import { EXAMPLE_QUESTIONS, QUESTION_MAX, ratedForStickiness } from './utils/askTheBook';
import { answerTitle, formatCost, monthLine } from './utils/recentAnswers';

// The AI tab (docs/plans/tier-1.md, WP3): Ask the book and the brief, both
// answered on the whole book as the server renders it (utils/book.cjs), which
// "What the AI is given" shows. Answers live in the store, so a tab switch
// keeps them. Netlify can publish this page before Render deploys the API, so
// the tab asks /api/health for ask-the-book before it offers Ask or Brief,
// and for ai-answers (WP4) before it shows Recent answers: every partner's
// saved answers, newest first, with this month's count and estimated cost.

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

const AnswerCard = ({ title, icon: Icon, result, testId }) => (
  <Card data-testid={testId}>
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2">
        <Icon className="h-5 w-5" />
        {title}
        <Badge variant="outline" className="text-xs font-normal">
          {new Date(result.timestamp).toLocaleString()}
        </Badge>
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      {result.question && (
        <p className="whitespace-pre-wrap rounded-md border-l-4 border-muted bg-muted/30 px-3 py-2 text-sm" data-testid={`${testId}-question`}>
          {result.question}
        </p>
      )}
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
    </CardContent>
  </Card>
);

// A saved answer opened from the list: who asked and when, the answer as the
// tab renders one, and what it cost.
const SavedAnswer = ({ answer }) => (
  <div className="space-y-3 border-t px-3 py-3" data-testid="saved-answer">
    {answer.kind === 'ask' && answer.question && (
      <p className="whitespace-pre-wrap rounded-md border-l-4 border-muted bg-muted/30 px-3 py-2 text-sm">{answer.question}</p>
    )}
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
  </div>
);

// Recent answers (WP4): every partner's saved answers, newest first. A row
// opens its answer in place; "Older answers" loads the next page.
const RecentAnswers = () => {
  const { aiAnswers, fetchOlderAiAnswers, toggleAiAnswer } = usePortfolioStore();
  const { items, hasMore, loaded, loadingOlder, error, summary, details, openId } = aiAnswers;

  return (
    <Card data-testid="recent-answers">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <History className="h-5 w-5" />
          Recent answers
        </CardTitle>
        {summary && (
          <p className="text-sm text-muted-foreground" data-testid="answers-month">
            {monthLine(summary)}. Estimated from list prices; the Anthropic Console is the bill.
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
          <p className="text-sm text-muted-foreground">No answers yet. Every answer the AI gives is saved here for all the partners.</p>
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
                      <span className="block text-xs text-muted-foreground">
                        {when(item.created_at)} · {item.asked_by_username || 'a former account'}
                        {item.refused ? ' · declined' : ''}
                        {item.truncated ? ' · cut off' : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                      <span data-testid="answer-row-cost">{formatCost(item.cost_usd)}</span>
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>
                  {open && (details[item.id]
                    ? <SavedAnswer answer={details[item.id]} />
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
    setAiResult,
    setAiError,
    setCurrentView,
    fetchAiAnswers,
  } = usePortfolioStore();
  // checking, ready or unavailable
  const [api, setApi] = useState('checking');
  // Whether this API saves answers and lists them (ai-answers, WP4)
  const [answersApi, setAnswersApi] = useState(false);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState({ ask: false, brief: false });

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
      })
      .catch(() => { if (current) setApi('unavailable'); });
    return () => { current = false; };
  }, []);

  // The saved answers, each time the tab opens: other partners may have asked since
  useEffect(() => {
    if (answersApi) fetchAiAnswers();
  }, [answersApi, fetchAiAnswers]);

  const run = async (kind) => {
    const asked = question.trim();
    if (kind === 'ask' && !asked) return;
    setPending((p) => ({ ...p, [kind]: true }));
    setAiError(null);
    try {
      const data = kind === 'ask'
        ? await apiClient.post('/ai/ask', { question: asked })
        : await apiClient.post('/ai/brief', {});
      if (!data.success) throw new Error(data.error || 'The AI request failed.');
      setAiResult(kind, data);
      // Clear the box only if it still holds the question just answered
      if (kind === 'ask') setQuestion((text) => (text.trim() === asked ? '' : text));
      // The answer just given heads the saved list, with this month's new total
      if (answersApi) fetchAiAnswers();
    } catch (err) {
      console.error(`AI ${kind} error:`, err);
      setAiError(apiErrorMessage(err));
    } finally {
      setPending((p) => ({ ...p, [kind]: false }));
    }
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
        {answersApi && <RecentAnswers />}
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
                what the book can't tell you. Each question stands alone: the AI does not see earlier answers.
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

      {results.ask && <AnswerCard title="Answer" icon={MessageSquare} result={results.ask} testId="ask-answer" />}
      {results.brief && <AnswerCard title="Brief" icon={FileText} result={results.brief} testId="brief-answer" />}

      {/* Every partner's saved answers (WP4), only from an API that saves them */}
      {answersApi && <RecentAnswers />}
    </div>
  );
};

export default AIAdvisor;
