'use client';
import { useEffect, useRef, useState } from 'react';
import { Widget } from '@/components/widgets';
import type { WidgetType } from '@/lib/widgets/registry';

interface Slide {
  id: string;
  title: string;
  bullets: string[];
  speakerNotes: string;
}
interface QuizQuestion {
  id: string;
  prompt: string;
  widget: WidgetType;
  config: any;
  expectedAnswer: any;
  explanation: string;
}
interface Content {
  title: string;
  objectives: string[];
  slides: Slide[];
  quiz: QuizQuestion[];
}
interface GradeResult {
  questionId: string;
  correct: boolean;
  score: number;
  feedback: string;
}

type Phase = 'intro' | 'slide' | 'quiz' | 'results';

export default function LessonPlayer({
  lessonId,
  categoryName,
  content,
}: {
  lessonId: string;
  categoryName: string;
  content: Content;
}) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [slideIdx, setSlideIdx] = useState(0);
  const [quizIdx, setQuizIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [results, setResults] = useState<GradeResult[] | null>(null);
  const [feedback, setFeedback] = useState<string>('');
  const [gradeLoading, setGradeLoading] = useState(false);

  function gotoSlides() {
    setPhase('slide');
    setSlideIdx(0);
  }
  function gotoQuiz() {
    setPhase('quiz');
    setQuizIdx(0);
  }

  async function submitQuiz() {
    setGradeLoading(true);
    const payload = {
      lessonId,
      answers: content.quiz.map((q) => ({ questionId: q.id, answer: answers[q.id] })),
    };
    const res = await fetch('/api/grade', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    setResults(data.results ?? []);
    setFeedback(data.feedback ?? '');
    setGradeLoading(false);
    setPhase('results');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <a href="/learn" className="text-slate-500 hover:text-slate-900 text-sm">
              ← New lesson
            </a>
            <span className="text-slate-300">|</span>
            <span className="text-sm">
              <span className="text-slate-500">{categoryName}</span>{' '}
              <span className="font-medium">{content.title}</span>
            </span>
          </div>
          <span className="text-xs text-slate-400">
            {phase === 'slide' && `Slide ${slideIdx + 1} / ${content.slides.length}`}
            {phase === 'quiz' && `Question ${quizIdx + 1} / ${content.quiz.length}`}
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10">
        {phase === 'intro' && (
          <Intro content={content} onStart={gotoSlides} />
        )}
        {phase === 'slide' && (
          <SlideView
            slide={content.slides[slideIdx]}
            onPrev={slideIdx === 0 ? undefined : () => setSlideIdx(slideIdx - 1)}
            onNext={
              slideIdx === content.slides.length - 1
                ? gotoQuiz
                : () => setSlideIdx(slideIdx + 1)
            }
            nextLabel={slideIdx === content.slides.length - 1 ? 'Start quiz →' : 'Next →'}
          />
        )}
        {phase === 'quiz' && (
          <QuizView
            question={content.quiz[quizIdx]}
            value={answers[content.quiz[quizIdx].id]}
            onChange={(v) =>
              setAnswers((a) => ({ ...a, [content.quiz[quizIdx].id]: v }))
            }
            onPrev={quizIdx === 0 ? undefined : () => setQuizIdx(quizIdx - 1)}
            onNext={
              quizIdx === content.quiz.length - 1
                ? submitQuiz
                : () => setQuizIdx(quizIdx + 1)
            }
            nextLabel={
              gradeLoading
                ? 'Grading...'
                : quizIdx === content.quiz.length - 1
                ? 'Submit quiz'
                : 'Next →'
            }
            disabled={gradeLoading}
          />
        )}
        {phase === 'results' && results && (
          <Results content={content} results={results} feedback={feedback} answers={answers} />
        )}
      </main>
    </div>
  );
}

function Intro({ content, onStart }: { content: Content; onStart: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8">
      <h1 className="text-2xl font-semibold mb-3">{content.title}</h1>
      <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-2">
        You will learn
      </h2>
      <ul className="list-disc pl-5 mb-8 space-y-1 text-slate-700">
        {content.objectives.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
      </ul>
      <button
        onClick={onStart}
        className="rounded-md bg-brand-600 text-white py-2 px-5 text-sm font-medium hover:bg-brand-700"
      >
        Start lesson →
      </button>
    </div>
  );
}

function SlideView({
  slide,
  onPrev,
  onNext,
  nextLabel,
}: {
  slide: Slide;
  onPrev?: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 min-h-[320px]">
        <h2 className="text-xl font-semibold mb-5">{slide.title}</h2>
        <ul className="list-disc pl-5 space-y-2 text-slate-800">
          {slide.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <NarrationPlayer text={slide.speakerNotes} key={slide.id} />

      <div className="flex justify-between pt-2">
        <button
          onClick={onPrev}
          disabled={!onPrev}
          className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={onNext}
          className="rounded-md bg-brand-600 text-white py-2 px-4 text-sm font-medium hover:bg-brand-700"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function QuizView({
  question,
  value,
  onChange,
  onPrev,
  onNext,
  nextLabel,
  disabled,
}: {
  question: QuizQuestion;
  value: any;
  onChange: (v: any) => void;
  onPrev?: () => void;
  onNext: () => void;
  nextLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-8">
        <p className="text-base text-slate-800 mb-5">{question.prompt}</p>
        <Widget
          widget={question.widget}
          config={question.config}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <div className="flex justify-between">
        <button
          onClick={onPrev}
          disabled={!onPrev || disabled}
          className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          onClick={onNext}
          disabled={disabled}
          className="rounded-md bg-brand-600 text-white py-2 px-4 text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function Results({
  content,
  results,
  feedback,
  answers,
}: {
  content: Content;
  results: GradeResult[];
  feedback: string;
  answers: Record<string, any>;
}) {
  const total = results.reduce((a, r) => a + r.score, 0);
  const max = content.quiz.length;
  const pct = Math.round((total / max) * 100);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
        <div className="text-sm text-slate-500 mb-1">You scored</div>
        <div className="text-4xl font-semibold">
          {total.toFixed(1)} / {max}
          <span className="text-base text-slate-500 font-normal ml-2">({pct}%)</span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <h3 className="font-semibold mb-3">Personalised feedback</h3>
        <div className="text-sm text-slate-700 whitespace-pre-wrap">{feedback}</div>
      </div>

      <div className="space-y-4">
        {content.quiz.map((q, i) => {
          const r = results.find((x) => x.questionId === q.id);
          if (!r) return null;
          const ok = r.score >= 0.99;
          return (
            <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-6">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-sm text-slate-500">Question {i + 1}</div>
                <div className={`text-sm font-medium ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {r.score.toFixed(1)} / 1
                </div>
              </div>
              <p className="font-medium mb-3">{q.prompt}</p>
              <Widget widget={q.widget} config={q.config} value={answers[q.id]} onChange={() => {}} disabled />
              {r.feedback && <div className="text-sm text-slate-600 mt-3">{r.feedback}</div>}
              <div className="text-sm text-slate-700 mt-3 border-t border-slate-100 pt-3">
                <strong className="text-slate-500 text-xs uppercase tracking-wide">Explanation:</strong> {q.explanation}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center pt-4">
        <a
          href="/learn"
          className="rounded-md bg-brand-600 text-white py-2 px-5 text-sm font-medium hover:bg-brand-700 inline-block"
        >
          New lesson →
        </a>
      </div>
    </div>
  );
}

function NarrationPlayer({ text }: { text: string }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAndPlay() {
    if (audioUrl) {
      audioRef.current?.play();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tts', { method: 'POST', body: JSON.stringify({ text }) });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? 'TTS failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      // Tiny delay so the audio element binds the new src.
      setTimeout(() => audioRef.current?.play(), 50);
    } catch (e: any) {
      setError(e.message ?? 'Could not load narration');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
      {!audioUrl ? (
        <button
          onClick={loadAndPlay}
          disabled={loading}
          className="rounded-md bg-slate-900 text-white text-xs px-3 py-1.5 hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? 'Loading narration...' : '▶ Listen'}
        </button>
      ) : (
        <audio ref={audioRef} src={audioUrl} controls className="flex-1 h-8" />
      )}
      <span className="text-xs text-slate-500">AI narration</span>
      {error && <span className="text-xs text-red-600 ml-auto">{error}</span>}
    </div>
  );
}
