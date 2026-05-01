'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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

interface ThemePalette {
  bg: string;        // page background
  accent: string;    // accent shapes / bullet chips
  accentSoft: string;
  ribbon: string;    // top corner ribbon
}
const THEMES: Record<Theme, ThemePalette> = {
  default: {
    bg:         'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 60%, #94a3b8 100%)',
    accent:     '#0f172a',
    accentSoft: '#cbd5e1',
    ribbon:     '#475569',
  },
  concept: {
    bg:         'linear-gradient(135deg, #dbeafe 0%, #93c5fd 60%, #2563eb 100%)',
    accent:     '#1d4ed8',
    accentSoft: '#bfdbfe',
    ribbon:     '#1e40af',
  },
  example: {
    bg:         'linear-gradient(135deg, #d1fae5 0%, #6ee7b7 60%, #059669 100%)',
    accent:     '#047857',
    accentSoft: '#a7f3d0',
    ribbon:     '#065f46',
  },
  warning: {
    bg:         'linear-gradient(135deg, #fef3c7 0%, #fcd34d 60%, #d97706 100%)',
    accent:     '#b45309',
    accentSoft: '#fde68a',
    ribbon:     '#92400e',
  },
  recap: {
    bg:         'linear-gradient(135deg, #ede9fe 0%, #c4b5fd 60%, #7c3aed 100%)',
    accent:     '#6d28d9',
    accentSoft: '#ddd6fe',
    ribbon:     '#5b21b6',
  },
};
const THEME_LABEL: Record<Theme, string> = {
  default: 'Overview',
  concept: 'Concept',
  example: 'Example',
  warning: 'Watch out',
  recap: 'Recap',
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
  const [cpd, setCpd] = useState<any>(null);
  // Capture the moment the learner opened the lesson, for CPD duration.
  const viewStartedAt = useRef<string>(new Date().toISOString());

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
      viewStartedAt: viewStartedAt.current,
    };
    const res = await fetch('/api/grade', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    setResults(data.results ?? []);
    setFeedback(data.feedback ?? '');
    setCpd(data.cpd ?? null);
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
            <Results
              content={content}
              results={results}
              feedback={feedback}
              answers={answers}
              cpd={cpd}
            />
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
  const palette = THEMES[theme] ?? THEMES.default;

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
    <div className="flex-1 flex flex-col relative overflow-hidden" style={{ background: palette.bg }}>
      {/* Decorative background shapes for visual interest. */}
      <div
        className="absolute -top-32 -right-32 w-[420px] h-[420px] rounded-full blur-3xl opacity-40"
        style={{ background: palette.accent }}
      />
      <div
        className="absolute -bottom-40 -left-32 w-[380px] h-[380px] rounded-full blur-3xl opacity-30"
        style={{ background: palette.accentSoft }}
      />

      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative z-10">
        <div className="w-full max-w-6xl bg-white/95 backdrop-blur rounded-3xl shadow-2xl border border-white/60 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] min-h-[64vh] overflow-hidden">
          {/* Left column: title + bullets, with theme-coloured ribbon */}
          <div className="relative p-8 sm:p-12">
            <div
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full text-white mb-5"
              style={{ background: palette.ribbon }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full bg-white/80"
                aria-hidden
              />
              {THEME_LABEL[theme]}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold mb-7 text-slate-900 leading-tight">
              {slide.title}
            </h2>
            <ul className="space-y-4">
              {slide.bullets.map((b, i) => (
                <li
                  key={i}
                  className={`flex gap-3 items-start transition-all duration-700 ease-out ${
                    i < visibleBullets ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3'
                  }`}
                >
                  <span
                    className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-semibold shadow-sm"
                    style={{ background: palette.accent }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-lg text-slate-800 leading-relaxed pt-0.5">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right column: visual — SVG diagram, or themed default illustration */}
          <div
            className="relative flex items-center justify-center p-8 sm:p-12 overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${palette.accentSoft}55, ${palette.accent}22)`,
            }}
          >
            {/* Subtle decorative chevrons in corners */}
            <div
              className="absolute top-0 right-0 w-32 h-32 -mt-12 -mr-12 rounded-full opacity-30"
              style={{ background: palette.accent }}
            />
            <div
              className="absolute bottom-0 left-0 w-24 h-24 -mb-10 -ml-10 rounded-full opacity-20"
              style={{ background: palette.ribbon }}
            />

            {slide.svg ? (
              <div
                className="w-full max-w-md transition-opacity duration-1000 relative z-10"
                style={{ opacity: progress > 0.05 ? 1 : 0.3 }}
                dangerouslySetInnerHTML={{ __html: sanitiseSvg(slide.svg) }}
              />
            ) : (
              <div className="relative z-10">
                <DefaultIllustration theme={theme} palette={palette} />
              </div>
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

function DefaultIllustration({ theme, palette }: { theme: Theme; palette: ThemePalette }) {
  // A more visually rich placeholder graphic when the LLM didn't emit an SVG.
  // Use the slide's own theme palette so it feels deliberate, not generic.
  const uid = `dl-${theme}`;
  return (
    <svg viewBox="0 0 280 280" className="w-72 h-72 drop-shadow-md">
      <defs>
        <linearGradient id={`${uid}-grad1`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.accent} stopOpacity="0.85" />
          <stop offset="100%" stopColor={palette.ribbon} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${uid}-grad2`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.accentSoft} stopOpacity="0.95" />
          <stop offset="100%" stopColor={palette.accent} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {theme === 'warning' ? (
        <g>
          <polygon points="140,30 250,240 30,240" fill={`url(#${uid}-grad1)`} />
          <polygon points="140,80 215,225 65,225" fill={`url(#${uid}-grad2)`} opacity="0.7" />
          <text x="140" y="200" textAnchor="middle" fontSize="80" fontWeight="700" fill="white">!</text>
        </g>
      ) : theme === 'recap' ? (
        <g>
          <circle cx="140" cy="140" r="110" fill={`url(#${uid}-grad1)`} />
          <circle cx="140" cy="140" r="75" fill={`url(#${uid}-grad2)`} />
          <circle cx="140" cy="140" r="35" fill="white" opacity="0.9" />
          <circle cx="140" cy="140" r="14" fill={palette.accent} />
        </g>
      ) : theme === 'example' ? (
        <g>
          <rect x="40" y="40" width="200" height="200" rx="22" fill={`url(#${uid}-grad1)`} />
          <rect x="70" y="80" width="140" height="14" rx="7" fill="white" opacity="0.85" />
          <rect x="70" y="110" width="100" height="14" rx="7" fill="white" opacity="0.7" />
          <rect x="70" y="140" width="160" height="14" rx="7" fill="white" opacity="0.85" />
          <rect x="70" y="170" width="80" height="14" rx="7" fill="white" opacity="0.7" />
          <circle cx="220" cy="200" r="22" fill="white" />
          <path d="M210 200 l8 8 l16 -16" stroke={palette.accent} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : theme === 'concept' ? (
        <g>
          <circle cx="100" cy="140" r="80" fill={`url(#${uid}-grad2)`} />
          <circle cx="180" cy="140" r="80" fill={`url(#${uid}-grad1)`} opacity="0.9" />
          <circle cx="140" cy="80" r="60" fill={palette.accentSoft} opacity="0.8" />
          <circle cx="140" cy="140" r="20" fill="white" />
        </g>
      ) : (
        <g>
          <rect x="30" y="60" width="100" height="160" rx="12" fill={`url(#${uid}-grad1)`} />
          <rect x="150" y="100" width="100" height="120" rx="12" fill={`url(#${uid}-grad2)`} />
          <rect x="60" y="40" width="100" height="60" rx="12" fill={palette.accentSoft} opacity="0.85" />
          <circle cx="200" cy="60" r="22" fill="white" opacity="0.9" />
        </g>
      )}
    </svg>
  );
}

function CpdEntryCard({ cpd }: { cpd: any }) {
  const [isEthics, setIsEthics] = useState<boolean>(!!cpd?.isEthics);
  const [savingEthics, setSavingEthics] = useState(false);

  const completedAt = cpd?.completedAt ? new Date(cpd.completedAt) : null;
  const startedAt = cpd?.viewStartedAt ? new Date(cpd.viewStartedAt) : null;
  const durationMin =
    completedAt && startedAt
      ? Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 60000))
      : null;

  async function toggleEthics(next: boolean) {
    setIsEthics(next);
    setSavingEthics(true);
    await fetch(`/api/cpd?id=${cpd.attemptId ?? ''}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEthics: next }),
    }).catch(() => {});
    setSavingEthics(false);
  }

  return (
    <div className="bg-white border border-emerald-200 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-emerald-700">CPD logged</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Saved against your account — view all under "My CPD".
          </p>
        </div>
        <a href="/my-cpd" className="text-xs text-brand-600 hover:underline">
          View log →
        </a>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Topic area</dt>
          <dd className="text-slate-800">{cpd.topicArea ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">IES 8 category</dt>
          <dd className="text-slate-800">
            {cpd.ies8Number != null ? `${cpd.ies8Number}. ${cpd.ies8Label}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Duration</dt>
          <dd className="text-slate-800">{durationMin != null ? `${durationMin} min` : '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-400">Completed</dt>
          <dd className="text-slate-800">{completedAt ? completedAt.toLocaleString('en-GB') : '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-slate-400">Course summary</dt>
          <dd className="text-slate-800">{cpd.cpdSummary ?? '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isEthics}
              onChange={(e) => toggleEthics(e.target.checked)}
              disabled={savingEthics}
            />
            <span>This counts as Ethics CPD</span>
            {savingEthics && <span className="text-xs text-slate-400">saving...</span>}
          </label>
        </div>
      </dl>
    </div>
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
  cpd,
}: {
  content: Content;
  results: GradeResult[];
  feedback: string;
  answers: Record<string, any>;
  cpd: any;
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

      {cpd && <CpdEntryCard cpd={cpd} />}

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
