export type SlideMasterRole = 'title' | 'content' | 'section';
export type MasterTextPosition = 'bottom-left' | 'bottom-center' | 'bottom-right';
export type MasterElementStyle = 'minimal' | 'muted' | 'accent' | 'inverse';

export interface SlideMasterTextSpec {
  enabled?: boolean;
  includeOn?: SlideMasterRole[];
  position?: MasterTextPosition;
  style?: MasterElementStyle;
}

export interface SlideMasterSpec {
  slideNumber?: SlideMasterTextSpec;
  footer?: SlideMasterTextSpec & {
    text?: string;
  };
  date?: SlideMasterTextSpec & {
    text?: string;
  };
}

const MASTER_ROLES: SlideMasterRole[] = ['title', 'content', 'section'];
const POSITIONS: MasterTextPosition[] = ['bottom-left', 'bottom-center', 'bottom-right'];
const STYLES: MasterElementStyle[] = ['minimal', 'muted', 'accent', 'inverse'];

export const DEFAULT_SLIDE_MASTER_SPEC: Required<Pick<SlideMasterSpec, 'slideNumber'>> = {
  slideNumber: {
    enabled: true,
    includeOn: ['content'],
    position: 'bottom-right',
    style: 'muted',
  },
};

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : undefined;
}

function roleList(value: unknown): SlideMasterRole[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is SlideMasterRole => MASTER_ROLES.includes(item as SlideMasterRole));
  return out.length > 0 ? Array.from(new Set(out)).slice(0, 3) : undefined;
}

function shortText(value: unknown, max = 60): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return Array.from(trimmed).slice(0, max).join('');
}

function normalizeTextSpec(value: unknown): SlideMasterTextSpec | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const spec: SlideMasterTextSpec = {};
  const enabled = boolOrUndefined(obj.enabled);
  const includeOn = roleList(obj.includeOn);
  const position = enumValue(obj.position, POSITIONS);
  const style = enumValue(obj.style, STYLES);
  if (enabled !== undefined) spec.enabled = enabled;
  if (includeOn) spec.includeOn = includeOn;
  if (position) spec.position = position;
  if (style) spec.style = style;
  return Object.keys(spec).length > 0 ? spec : undefined;
}

function normalizeLabeledTextSpec(value: unknown): (SlideMasterTextSpec & { text?: string }) | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const spec: SlideMasterTextSpec & { text?: string } = normalizeTextSpec(obj) ?? {};
  const text = shortText(obj.text);
  if (text) spec.text = text;
  return Object.keys(spec).length > 0 ? spec : undefined;
}

export function normalizeSlideMasterSpec(value: unknown): SlideMasterSpec | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const slideNumber = normalizeTextSpec(obj.slideNumber);
  const footer = normalizeLabeledTextSpec(obj.footer);
  const date = normalizeLabeledTextSpec(obj.date);
  const spec: SlideMasterSpec = {};
  if (slideNumber) spec.slideNumber = slideNumber;
  if (footer?.text || footer?.enabled !== undefined) spec.footer = footer;
  if (date?.text || date?.enabled !== undefined) spec.date = date;
  return Object.keys(spec).length > 0 ? spec : undefined;
}

export function resolveSlideMasterSpec(spec?: SlideMasterSpec): SlideMasterSpec {
  const footer = spec?.footer
    ? {
        position: 'bottom-left' as const,
        style: 'muted' as const,
        ...spec.footer,
        enabled: spec.footer.enabled ?? Boolean(spec.footer.text),
      }
    : undefined;
  const date = spec?.date
    ? {
        position: 'bottom-center' as const,
        style: 'muted' as const,
        ...spec.date,
        enabled: spec.date.enabled ?? Boolean(spec.date.text),
      }
    : undefined;
  return {
    slideNumber: {
      ...DEFAULT_SLIDE_MASTER_SPEC.slideNumber,
      ...(spec?.slideNumber ?? {}),
    },
    footer,
    date,
  };
}

export function masterSpecIncludes(spec: SlideMasterTextSpec | undefined, role: SlideMasterRole): boolean {
  if (!spec?.enabled) return false;
  return (spec.includeOn ?? ['content']).includes(role);
}
