import { useEffect, useState } from 'react';
import { ChevronDown, FileText, Loader2, Sparkles } from 'lucide-react';
import type { SlideExportOptions, SlideTheme } from '../../lib/slideTheme';
import { isTauri } from '../../services/platform';

interface SlideExportPanelProps {
  content: string;
  available: boolean;
  busy: string | null;
  themes: SlideTheme[];
  options: SlideExportOptions;
  onOptionsChange: (next: SlideExportOptions) => void;
  onGenerateDraft: () => void;
  onExportDirect: () => void;
  onShowSettings: () => void;
}

const LANGUAGES = [
  { value: '', label: '문서와 동일' },
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

const DRAFT_PURPOSES = [
  { value: 'executive briefing for decision makers', label: '경영 보고' },
  { value: 'persuasive pitch deck', label: '설득 제안' },
  { value: 'teaching material', label: '강의 자료' },
  { value: 'interactive workshop deck', label: '워크숍' },
];

const DRAFT_STRUCTURES = [
  { value: 'choose the strongest narrative structure', label: '자동 구성' },
  { value: 'problem-solution structure', label: '문제-해결' },
  { value: 'agenda-driven structure', label: '목차형' },
  { value: 'storyline structure', label: '스토리라인' },
];

const DRAFT_DEPTHS = [
  { value: 'concise', label: '간결' },
  { value: 'standard', label: '표준' },
  { value: 'detailed', label: '상세' },
];

const COMMENT_MODES = [
  { value: 'add frequent reviewer comments and questions for gaps, assumptions, and choices', label: '코멘트 표시' },
  { value: 'do not add reviewer comments; produce a clean editable draft', label: '코멘트 없음' },
];

const REVISION_MODES = [
  { value: 'apply detailed instructions while preserving the current slide order and count unless explicitly requested', label: '지시 반영' },
  { value: 'strengthen emphasis and sharpen key messages without changing the deck structure', label: '강조' },
  { value: 'shorten and clean the existing draft while preserving meaning and slide order', label: '간결화' },
  { value: 'restructure the existing draft when it improves flow while preserving source facts', label: '재구성' },
];

const PPTX_LAYOUTS = [
  { value: 'auto content-aware layout mix with strong variety', label: '자동' },
  { value: 'prefer two-column and comparison layouts for parallel ideas', label: '2열 중심' },
  { value: 'use comparison, timeline, quote, and stat layouts when they fit', label: '비교/흐름' },
  { value: 'use clear section divider slides and rhythmic deck pacing', label: '섹션 리듬' },
];

const IMAGE_POLICIES = [
  { value: 'use source images only; do not add new image intent', label: '원문만' },
  { value: 'add image intent only when it materially improves the slide', label: '필요시' },
  { value: 'actively add ambient and supporting visuals to spacious body slides as well as cover and section slides', label: '적극 추가' },
];

const MARGIN_OPTIONS = [
  { value: 'wide margins with generous whitespace', label: '넓게' },
  { value: 'theme default balanced margins', label: '표준' },
  { value: 'compact margins for information-heavy decks', label: '적게' },
];

const FALLBACK_FONT_FAMILIES = [
  'Pretendard',
  'Apple SD Gothic Neo',
  'Noto Sans',
  'Noto Sans Display',
  'Helvetica Neue',
  'Arial',
  'Avenir Next',
  'Georgia',
  'Times New Roman',
  'Menlo',
];

const DENSITY_OPTIONS = [
  { value: 'minimal text with strong whitespace and visual hierarchy', label: '저밀도' },
  { value: 'balanced text density with readable slide capacity', label: '균형' },
  { value: 'information-dense but still readable slide composition', label: '고밀도' },
];

type SlideTask = 'draft' | 'pptx';

const SLIDE_DRAFT_MARKER_RE = /^\s*(?:<!--\s*markmind:slide-draft\b[^>]*-->|&lt;!--\s*markmind:slide-draft\b.*?--&gt;)\s*$/im;

export function SlideExportPanel({
  content,
  available,
  busy,
  themes,
  options,
  onOptionsChange,
  onGenerateDraft,
  onExportDirect,
  onShowSettings,
}: SlideExportPanelProps) {
  const [themeOpen, setThemeOpen] = useState(false);
  const [fontFamilies, setFontFamilies] = useState<string[]>([]);
  const [fontFamiliesLoading, setFontFamiliesLoading] = useState(false);
  const [task, setTask] = useState<SlideTask>('draft');
  const selectedTheme = themes.find((t) => t.id === options.themeId) ?? themes[0];
  const patch = (partial: Partial<SlideExportOptions>) => onOptionsChange({ ...options, ...partial });
  const empty = content.trim().length === 0;
  const isDraft = task === 'draft';
  const isExistingDraft = SLIDE_DRAFT_MARKER_RE.test(content);
  const draftLabel = isExistingDraft ? '슬라이드 초안 수정' : '슬라이드 초안';
  const draftButtonLabel = isExistingDraft ? '슬라이드 초안 수정' : '슬라이드 초안 만들기';
  const draftInstructionLabel = isExistingDraft ? '수정 지시' : '상세 지시';
  const draftInstructionPlaceholder = isExistingDraft
    ? '예: 3장의 메시지를 더 강하게, 마지막 장에 실행 계획 추가'
    : '예: 각 장 끝에 발표자 메모를 넣기';
  const preferredFonts = FALLBACK_FONT_FAMILIES.filter((font) => fontFamilies.includes(font));
  const otherFonts = fontFamilies.filter((font) => !FALLBACK_FONT_FAMILIES.includes(font));
  const fontOptions = Array.from(
    new Set([
      ...(options.fontFamily?.trim() ? [options.fontFamily.trim()] : []),
      ...preferredFonts,
      ...otherFonts,
      ...FALLBACK_FONT_FAMILIES,
    ]),
  );

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    setFontFamiliesLoading(true);
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<string[]>('list_installed_font_families'))
      .then((families) => {
        if (cancelled) return;
        setFontFamilies(families.filter((font) => font && !font.startsWith('.')));
      })
      .catch((err) => {
        console.warn('[slide_export] installed font list failed:', err);
      })
      .finally(() => {
        if (!cancelled) setFontFamiliesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ai-pptx-config">
      <div className="ai-pptx-task-group" role="radiogroup" aria-label="슬라이드 작업">
        <label className={`ai-pptx-task${task === 'draft' ? ' active' : ''}`}>
          <input
            type="radio"
            name="slide-task"
            value="draft"
            checked={task === 'draft'}
            onChange={() => setTask('draft')}
          />
          <span>
            <strong>{draftLabel}</strong>
          </span>
        </label>
        <label className={`ai-pptx-task${task === 'pptx' ? ' active' : ''}`}>
          <input
            type="radio"
            name="slide-task"
            value="pptx"
            checked={task === 'pptx'}
            onChange={() => setTask('pptx')}
          />
          <span>
            <strong>파워포인트 생성</strong>
          </span>
        </label>
      </div>

      {!isDraft && (
        <div className="ai-pptx-field">
          <span className="ai-pptx-label">테마</span>
          <button className="ai-pptx-theme-trigger" type="button" onClick={() => setThemeOpen(true)}>
            <span className="ai-pptx-theme-swatch" style={{ background: `#${selectedTheme.palette.accent}` }} />
            <span>
              <strong>{selectedTheme.name}</strong>
              <small>{selectedTheme.description}</small>
            </span>
            <ChevronDown size={14} />
          </button>
          {themeOpen && (
            <>
              <div className="ai-pptx-backdrop" onClick={() => setThemeOpen(false)} aria-hidden="true" />
              <div className="ai-pptx-theme-menu">
                {themes.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className={`ai-pptx-theme-option${theme.id === selectedTheme.id ? ' active' : ''}`}
                    onClick={() => {
                      patch({ themeId: theme.id });
                      setThemeOpen(false);
                    }}
                  >
                    <span className="ai-pptx-palette">
                      <i style={{ background: `#${theme.palette.title}` }} />
                      <i style={{ background: `#${theme.palette.bg}` }} />
                      <i style={{ background: `#${theme.palette.accent}` }} />
                      <i style={{ background: `#${theme.palette.accent2}` }} />
                    </span>
                    <span>
                      <strong>{theme.name}</strong>
                      <small>{theme.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {isDraft ? (
        <>
          <div className="ai-pptx-grid">
            <label className="ai-pptx-field">
              <span className="ai-pptx-label">대상</span>
              <input
                value={options.audience ?? ''}
                onChange={(e) => patch({ audience: e.target.value })}
                placeholder="예: 투자자"
              />
            </label>
            <label className="ai-pptx-field">
              <span className="ai-pptx-label">톤</span>
              <input
                value={options.tone ?? ''}
                onChange={(e) => patch({ tone: e.target.value })}
                placeholder="예: 설득력 있게"
              />
            </label>
          </div>

          {isExistingDraft ? (
            <div className="ai-pptx-field">
              <span className="ai-pptx-label">수정 방식</span>
              <div className="ai-pptx-segments">
                {REVISION_MODES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={item.value === (options.draftRevisionMode ?? 'apply detailed instructions while preserving the current slide order and count unless explicitly requested') ? 'active' : ''}
                    onClick={() => patch({ draftRevisionMode: item.value })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ai-pptx-grid">
              <div className="ai-pptx-field">
                <span className="ai-pptx-label">목적</span>
                <div className="ai-pptx-segments">
                  {DRAFT_PURPOSES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={item.value === (options.draftPurpose ?? 'executive briefing for decision makers') ? 'active' : ''}
                      onClick={() => patch({ draftPurpose: item.value })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ai-pptx-field">
                <span className="ai-pptx-label">구성 방식</span>
                <div className="ai-pptx-segments">
                  {DRAFT_STRUCTURES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={item.value === (options.draftStructure ?? 'choose the strongest narrative structure') ? 'active' : ''}
                      onClick={() => patch({ draftStructure: item.value })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="ai-pptx-grid">
            {!isExistingDraft && (
              <div className="ai-pptx-field">
                <span className="ai-pptx-label">상세도</span>
                <div className="ai-pptx-segments three">
                  {DRAFT_DEPTHS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={item.value === (options.draftDepth ?? 'standard') ? 'active' : ''}
                      onClick={() => patch({ draftDepth: item.value })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="ai-pptx-field">
              <span className="ai-pptx-label">코멘트</span>
              <div className="ai-pptx-segments">
                {COMMENT_MODES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={item.value === (options.draftReviewMode ?? 'add frequent reviewer comments and questions for gaps, assumptions, and choices') ? 'active' : ''}
                    onClick={() => patch({ draftReviewMode: item.value })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {isExistingDraft && (
              <label className="ai-pptx-field">
                <span className="ai-pptx-label">슬라이드 길이</span>
                <input
                  value={options.slideCountHint ?? ''}
                  onChange={(e) => patch({ slideCountHint: e.target.value })}
                  placeholder="예: 유지, 8장"
                />
              </label>
            )}
          </div>

          <div className={isExistingDraft ? 'ai-pptx-field' : 'ai-pptx-grid'}>
            {!isExistingDraft && (
              <label className="ai-pptx-field">
                <span className="ai-pptx-label">슬라이드 길이</span>
                <input
                  value={options.slideCountHint ?? ''}
                  onChange={(e) => patch({ slideCountHint: e.target.value })}
                  placeholder="예: 8-10"
                />
              </label>
            )}
            <div className="ai-pptx-field">
              <span className="ai-pptx-label">언어</span>
              <div className="ai-pptx-segments">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.value}
                    type="button"
                    className={lang.value === (options.language ?? '') ? 'active' : ''}
                    onClick={() => patch({ language: lang.value })}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="ai-pptx-grid">
            <div className="ai-pptx-field">
              <span className="ai-pptx-label">레이아웃</span>
              <div className="ai-pptx-segments">
                {PPTX_LAYOUTS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={item.value === (options.designLayout ?? 'auto content-aware layout mix with strong variety') ? 'active' : ''}
                    onClick={() => patch({ designLayout: item.value })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ai-pptx-field">
              <span className="ai-pptx-label">이미지</span>
              <div className="ai-pptx-segments three">
                {IMAGE_POLICIES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={item.value === (options.imagePolicy ?? 'add image intent only when it materially improves the slide') ? 'active' : ''}
                    onClick={() => patch({ imagePolicy: item.value })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ai-pptx-grid">
            <div className="ai-pptx-field">
              <span className="ai-pptx-label">여백</span>
              <div className="ai-pptx-segments three">
                {MARGIN_OPTIONS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={item.value === (options.marginPreference ?? 'theme default balanced margins') ? 'active' : ''}
                    onClick={() => patch({ marginPreference: item.value })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ai-pptx-field">
              <span className="ai-pptx-label">서체</span>
              <select
                value={options.fontFamily ?? ''}
                onChange={(e) => patch({ fontFamily: e.target.value || undefined })}
                disabled={fontFamiliesLoading && fontOptions.length === 0}
              >
                <option value="">테마 기본</option>
                {fontOptions.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="ai-pptx-field">
            <span className="ai-pptx-label">정보 밀도</span>
            <div className="ai-pptx-segments three">
              {DENSITY_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={item.value === (options.visualDensity ?? 'balanced text density with readable slide capacity') ? 'active' : ''}
                  onClick={() => patch({ visualDensity: item.value })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <label className="ai-pptx-field">
        <span className="ai-pptx-label">{isDraft ? draftInstructionLabel : '추가 지시'}</span>
        <textarea
          value={options.extraInstructions ?? ''}
          onChange={(e) => patch({ extraInstructions: e.target.value })}
          placeholder={isDraft ? draftInstructionPlaceholder : '예: 마지막 장에 실행 계획을 넣기'}
          rows={isDraft ? 5 : 4}
        />
      </label>

      {!available && (
        <div className="ai-pptx-authline">
          <span>{isDraft ? 'AI 초안 생성에는 모델 설정이 필요합니다' : '파워포인트 생성에는 모델 설정이 필요합니다'}</span>
          <button type="button" onClick={onShowSettings}>설정</button>
        </div>
      )}

      <div className="ai-pptx-actions">
        <button
          className="ai-btn primary"
          onClick={isDraft ? onGenerateDraft : onExportDirect}
          disabled={!available || !!busy || empty}
          title={isDraft ? draftButtonLabel : '파워포인트 생성'}
        >
          {busy ? <Loader2 size={14} className="spinning" /> : isDraft ? <Sparkles size={14} /> : <FileText size={14} />}
          {busy ? '작업 중...' : isDraft ? draftButtonLabel : '파워포인트 생성'}
        </button>
      </div>
      {busy && <div className="ai-pptx-busy">{busy}</div>}
    </div>
  );
}
