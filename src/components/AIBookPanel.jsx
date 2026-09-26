import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronDown, ChevronUp, FileText, Loader2 } from 'lucide-react';
import { apiClient, apiErrorMessage } from '../api';

// "What the AI is given" (docs/plans/tier-1.md, WP2; T4): the book exactly as
// the server renders it for the AI (utils/book.cjs, GET /api/ai/book), with
// its size. Collapsed until a partner opens it; each opening asks /api/health
// for ai-book first (Netlify can publish this page before Render deploys the
// API) and then fetches the book, so it is never stale.

const NOT_UPDATED = 'The API has not been updated yet.';
const CHARS_PER_TOKEN = 4; // the server's estimate (CHARS_PER_TOKEN in utils/book.cjs)
const count = (n) => Number(n || 0).toLocaleString('en-US');

const AIBookPanel = () => {
  const [open, setOpen] = useState(false);
  // idle, loading, unavailable, error or ready
  const [status, setStatus] = useState('idle');
  const [book, setBook] = useState(null);
  const [error, setError] = useState(null);
  const request = useRef(0);

  // Answers that arrive after the panel closed, reopened or unmounted are dropped
  useEffect(() => () => { request.current += 1; }, []);

  const load = async () => {
    const mine = ++request.current;
    setStatus('loading');
    setError(null);
    const health = await apiClient.get('/api/health').catch(() => null);
    if (mine !== request.current) return;
    if (!Array.isArray(health?.features) || !health.features.includes('ai-book')) {
      setStatus('unavailable');
      return;
    }
    try {
      const data = await apiClient.get('/api/ai/book');
      if (mine !== request.current) return;
      setBook(data);
      setStatus('ready');
    } catch (err) {
      if (mine !== request.current) return;
      console.error('Could not load the book the AI is given:', err);
      setError(apiErrorMessage(err, 'Could not load the book.'));
      setStatus('error');
    }
  };

  const toggle = () => {
    if (open) {
      request.current += 1;
      setOpen(false);
      return;
    }
    setOpen(true);
    load();
  };

  return (
    <Card data-testid="ai-book-panel">
      <CardHeader>
        <CardTitle>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={open}
            aria-controls="ai-book-body"
            onClick={toggle}
          >
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              What the AI is given
            </span>
            {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent id="ai-book-body" className="space-y-3">
          {status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading the book…
            </div>
          )}
          {status === 'unavailable' && (
            <Alert><AlertDescription>{NOT_UPDATED}</AlertDescription></Alert>
          )}
          {status === 'error' && (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          )}
          {status === 'ready' && book && (
            <>
              <p className="text-sm font-medium">Client notes are never sent to the AI.</p>
              <p className="text-sm text-muted-foreground" data-testid="ai-book-stats">
                Reporting year {book.reportingYear} · {count(book.clientCount)} {book.clientCount === 1 ? 'client' : 'clients'} ·{' '}
                {count(book.chars)} characters · about {count(book.estimatedTokens)} tokens (an estimate, at{' '}
                {CHARS_PER_TOKEN} characters per token)
              </p>
              <pre
                className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs leading-relaxed"
                data-testid="ai-book-text"
              >
                {book.text}
              </pre>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
};

export default AIBookPanel;
