'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Widget } from '@/components/widgets';
import type { WidgetType } from '@/lib/widgets/registry';

type Theme = 'concept' | 'example' | 'warning' | 'recap' | 'default';

interface Slide {
  id: string;
  title: string;
  bullets: string[];
  speakerNotes: string;
  theme?: Theme;
  svg?: string;
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
interface Branding {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  footerText: string | null;
}

type Phase = 'intro' | 'slide' | 'quiz' | 'results';

const THEME_BG: Record<Theme, string> = {
  default: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
  concept: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
  example: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
  warning: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
  recap:   'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
};

export default function LessonPlayer({
  lessonId,
  categoryName,
  content,
  branding,
}: {
  lessonId: string;
  categoryName: string;
  content: Content;
  branding: Branding;
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

  function onSlideEnd() {
    if (slideIdx === content.slides.length - 1) gotoQuiz();
    else setSlideIdx(slideIdx + 1);
  }

  const styleVars = { '--brand': branding.primaryColor } as React.CSSProperties;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50" style={styleVars}>
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            {branding.logoUrl && (
              <img
                src={branding.logoUrl}
                alt=""
                className="h-7"
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            )}
            <a href="/learn" className="text-slate-500 hover:text-slate-900 text-sm">
              ← New
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

      <main className="flex-1 flex flex-col">
        {phase === 'intro' && (
          <div className="max-w-3xl mx-auto px-6 py-10 w-full">
            <Intro content={content} onStart={gotoSlides} branding={branding} />
          </div>
        )}
        {phase === 'slide' && (
          <SlideStage
            key={content.slides[slideIdx].id}
            slide={content.slides[slideIdx]}
            slideIdx={slideIdx}
            slideCount={content.slides.length}
            branding={branding}
            onPrev={() => setSlideIdx(Math.max(0, slideIdx - 1))}
            onPrevSlideStart={() => {
              if (slideIdx === 0) return;
              setSlideIdx(slideIdx - 1);
            }}
            onNext={() =>
              slideIdx === content.slides.length - 1 ? gotoQuiz() : setSlideIdx(slideIdx + 1)
            }
            onEnd={gotoQuiz}
            onAudioEnded={onSlideEnd}
          />
        )}
        {phase === 'quiz' && (
          <div className="max-w-3xl mx-auto px-6 py-10 w-full">
            <QuizView
              question={content.quiz[quizIdx]}
              value={answers[content.quiz[quizIdx].id]}
              onChange={(v) =>
                setAnswers((a) => ({ ...a, [content.quiz[quizIdx].id]: v }))
              }
              onPrev={quizIdx === 0 ? undefined : () => setQuizIdx(quizIdx - 1)}
              onNext={
                quizIdx === content.quiz.length - 1 ? submitQuiz : () => setQuizIdx(quizIdx + 1)
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
          </div>
        )}
        {phase === 'results' && results && (
          <div className="max-w-3xl mx-auto px-6 py-10 w-full">
            <Results content={content} results={results} feedback={feedback} answers={answers} />
          </div>
        )}
      </main>

      {branding.footerText && (
        <footer className="text-center text-xs text-slate-400 py-2">{branding.footerText}</footer>
      )}
    </div>
  );
}

function Intro({
  content,
  onStart,
  branding,
}: {
  content: Content;
  onStart: () => void;
  branding: Branding;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">{branding.brandName}</div>
      <h1 className="text-3xl font-semibold mb-6">{content.title}</h1>
      <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
        You will learn
      </h2>
      <ul className="mb-8 space-y-1.5 text-slate-700 text-left max-w-md mx-auto">
        {content.objectives.map((o, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-[color:var(--brand)] mt-0.5">→</span>
            <span>{o}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={onStart}
        style={{ backgroundColor: branding.primaryColor }}
        className="rounded-md text-white py-2.5 px-6 text-sm font-medium hover:brightness-110"
      >
        Start lesson →
      </button>
    </div>
  );
}

function SlideStage({
  slide,
  slideIdx,
  slideCount,
  branding,
  onPrev,
  onPrevSlideStart,
  onNext,
  onEnd,
  onAudioEnded,
}: {
  slide: Slide;
  slideIdx: number;
  slideCount: number;
  branding: Branding;
  onPrev: () => void;
  onPrevSlideStart: () => void;
  onNext: () => void;
  onEnd: () => void;
  onAudioEnded: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [rate, setRate] = useState(1);

  const theme: Theme = (slide.theme as Theme) || 'default';
  const bg = THEME_BG[theme] ?? THEME_BG.default;

  // Load narration MP3 once per slide.
  useEffect(() => {
    let cancelled = false;
    setAudioLoading(true);
    setAudioError('');
    setAudioUrl(null);
    setProgress(0);
    setIsPlaying(false);

    fetch('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: slide.speakerNotes }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error ?? `Narration failed (${r.status})`);
        }
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setAudioLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setAudioError(e.message);
        setAudioLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slide.id, slide.speakerNotes]);

  // Free the blob URL when slide changes.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Auto-play when ready.
  useEffect(() => {
    if (!audioUrl || !audioRef.current) return;
    audioRef.current.playbackRate = rate;
    audioRef.current.play().catch(() => {
      /* browser blocked autoplay; user can hit Play */
    });
  }, [audioUrl, rate]);

  // Bullet reveal driven by audio progress.
  const totalBullets = slide.bullets.length;
  const visibleBullets = Math.max(1, Math.ceil(progress * totalBullets));

  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a || !a.duration || !isFinite(a.duration)) return;
    setProgress(Math.min(1, a.currentTime / a.duration));
  }, []);

  function play() {
    audioRef.current?.play().catch(() => {});
  }
  function pause() {
    audioRef.current?.pause();
  }
  function restartSlide() {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    setProgress(0);
    audioRef.current.play().catch(() => {});
  }
  function changeRate(delta: number) {
    setRate((r) => {
      const next = Math.max(0.5, Math.min(2, +(r + delta).toFixed(2)));
      if (audioRef.current) audioRef.current.playbackRate = next;
      return next;
    });
  }

  return (
    <div className="flex-1 flex flex-col" style={{ background: bg }}>
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-6xl bg-white/85 backdrop-blur rounded-3xl shadow-xl border border-white/60 p-8 sm:p-12 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center min-h-[60vh]">
          <div>
            <h2 className="text-3xl sm:text-4xl font-semibold mb-6 text-slate-900">{slide.title}</h2>
            <ul className="space-y-3">
              {slide.bullets.map((b, i) => (
                <li
                  key={i}
                  className={`flex gap-3 transition-all duration-700 ease-out ${
                    i < visibleBullets
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 -translate-x-3'
                  }`}
                >
                  <span
                    className="mt-2 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: branding.primaryColor }}
                  />
                  <span className="text-lg text-slate-800 leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-center">
            {slide.svg ? (
              <div
                className="w-full max-w-md transition-opacity duration-1000"
                style={{ opacity: progress > 0.05 ? 1 : 0.2 }}
                dangerouslySetInnerHTML={{ __html: sanitiseSvg(slide.svg) }}
              />
            ) : (
              <DefaultIllustration theme={theme} primary={branding.primaryColor} />
            )}
          </div>
        </div>
      </div>

      <PlayerBar
        slideIdx={slideIdx}
        slideCount={slideCount}
        isPlaying={isPlaying}
        rate={rate}
        progress={progress}
        loading={audioLoading}
        error={audioError}
        onPrevSlide={onPrevSlideStart}
        onRestart={restartSlide}
        onPlay={play}
        onPause={pause}
        onNext={onNext}
        onEnd={onEnd}
        onSlower={() => changeRate(-0.25)}
        onFaster={() => changeRate(0.25)}
        primary={branding.primaryColor}
      />

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={onTimeUpdate}
          onEnded={() => {
            setIsPlaying(false);
            setProgress(1);
            onAudioEnded();
          }}
        />
      )}
    </div>
  );
}

function PlayerBar({
  slideIdx,
  slideCount,
  isPlaying,
  rate,
  progress,
  loading,
  error,
  onPrevSlide,
  onRestart,
  onPlay,
  onPause,
  onNext,
  onEnd,
  onSlower,
  onFaster,
  primary,
}: {
  slideIdx: number;
  slideCount: number;
  isPlaying: boolean;
  rate: number;
  progress: number;
  loading: boolean;
  error: string;
  onPrevSlide: () => void;
  onRestart: () => void;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onEnd: () => void;
  onSlower: () => void;
  onFaster: () => void;
  primary: string;
}) {
  const Btn = ({
    onClick,
    title,
    disabled,
    children,
    primaryAction,
  }: {
    onClick: () => void;
    title: string;
    disabled?: boolean;
    children: React.ReactNode;
    primaryAction?: boolean;
  }) => (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={
        'flex items-center justify-center w-10 h-10 rounded-full transition disabled:opacity-40 ' +
        (primaryAction
          ? 'text-white hover:brightness-110'
          : 'bg-white/70 hover:bg-white border border-slate-200 text-slate-700')
      }
      style={primaryAction ? { backgroundColor: primary } : undefined}
    >
      {children}
    </button>
  );

  return (
    <div className="bg-white/90 backdrop-blur border-t border-slate-200">
      <div className="h-1 bg-slate-200 relative">
        <div
          className="h-1 absolute left-0 top-0 transition-all duration-200"
          style={{ width: `${progress * 100}%`, background: primary }}
        />
      </div>
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Btn onClick={onPrevSlide} title="Back to start of previous slide" disabled={slideIdx === 0}>
            ⏮
          </Btn>
          <Btn onClick={onRestart} title="Back to start of this slide" disabled={loading}>
            ↺
          </Btn>
          {isPlaying ? (
            <Btn onClick={onPause} title="Pause" primaryAction>
              ⏸
            </Btn>
          ) : (
            <Btn onClick={onPlay} title="Play" disabled={loading} primaryAction>
              ▶
            </Btn>
          )}
          <Btn onClick={onNext} title="Forward to next slide">
            ⏭
          </Btn>
          <Btn onClick={onEnd} title="End — skip to quiz">
            ⏏
          </Btn>
        </div>

        <div className="flex items-center gap-2">
          <Btn onClick={onSlower} title="Slower" disabled={rate <= 0.5}>
            🐢
          </Btn>
          <span className="text-xs font-mono text-slate-500 w-10 text-center">{rate.toFixed(2)}×</span>
          <Btn onClick={onFaster} title="Faster" disabled={rate >= 2}>
            🐇
          </Btn>
        </div>

        <div className="text-xs text-slate-500 hidden sm:block">
          {error ? <span className="text-red-600">{error}</span> : <>AI narration</>}
        </div>
      </div>
    </div>
  );
}

function DefaultIllustration({ theme, primary }: { theme: Theme; primary: string }) {
  // A minimal decorative graphic so a slide without an SVG still feels visual.
  return (
    <svg viewBox="0 0 240 240" className="w-64 h-64 opacity-80">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={primary} stopOpacity="0.15" />
          <stop offset="100%" stopColor={primary} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {theme === 'warning' ? (
        <polygon points="120,20 220,210 20,210" fill="url(#g1)" stroke={primary} strokeWidth="2" />
      ) : theme === 'recap' ? (
        <circle cx="120" cy="120" r="90" fill="url(#g1)" stroke={primary} strokeWidth="2" />
      ) : theme === 'example' ? (
        <rect x="30" y="30" width="180" height="180" rx="14" fill="url(#g1)" stroke={primary} strokeWidth="2" />
      ) : (
        <g fill="url(#g1)" stroke={primary} strokeWidth="2">
          <circle cx="80" cy="120" r="60" />
          <circle cx="160" cy="120" r="60" />
        </g>
      )}
    </svg>
  );
}

/** Strip <script>, javascript: refs, on*= handlers from inline SVG. */
function sanitiseSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<\?xml[^>]*\?>/g, '');
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
