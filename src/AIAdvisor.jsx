import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Brain, FileText, Loader2, MessageSquare } from 'lucide-react';
import Markdown from 'react-markdown';
import usePortfolioStore from './portfolioStore';
import { apiClient, apiErrorMessage } from './api';
import AIBookPanel from './components/AIBookPanel';
import { EXAMPLE_QUESTIONS, QUESTION_MAX, ratedForStickiness } from './utils/askTheBook';

// The AI tab (docs/plans/tier-1.md, WP3): Ask the book and the brief, both
// answered on the whole book as the server renders it (utils/book.cjs), which
// "What the AI is given" shows. Answers live in the store, so a tab switch
// keeps them. Netlify can publish this page before Render deploys the API, so
// the tab asks /api/health for ask-the-book before it offers Ask or Brief.

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
    </CardContent>
  </Card>
);

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
  } = usePortfolioStore();
  // checking, ready or unavailable
  const [api, setApi] = useState('checking');
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState({ ask: false, brief: false });

  const hasData = Array.isArray(clients) && clients.length > 0;
  const rated = ratedForStickiness(clients);

  useEffect(() => {
    let current = true;
    apiClient.get('/api/health')
      .then((health) => {
        if (!current) return;
        setApi(Array.isArray(health?.features) && health.features.includes('ask-the-book') ? 'ready' : 'unavailable');
      })
      .catch(() => { if (current) setApi('unavailable'); });
    return () => { current = false; };
  }, []);

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
    } catch (err) {
      console.error(`AI ${kind} error:`, err);
      setAiError(apiErrorMessage(err));
    } finally {
      setPending((p) => ({ ...p, [kind]: false }));
    }
  };

  if (!hasData) {
    return (
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
    </div>
  );
};

export default AIAdvisor;
