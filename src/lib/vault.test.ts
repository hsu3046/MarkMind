import { describe, it, expect } from 'vitest';
import { buildIndex, resolveTarget, buildGraph, type VaultFile } from './vault';

const files: VaultFile[] = [
    { path: 'Hub.md', name: 'Hub.md', content: '# Hub\n- [[Goals]]\n- [[Team/Roster]]\n- [[Missing Note]]\n- [text](notes/Detail.md)' },
    { path: 'Goals.md', name: 'Goals.md', content: '# Goals\nlinks back [[Hub]]' },
    { path: 'Team/Roster.md', name: 'Roster.md', content: '# Roster' },
    { path: 'notes/Detail.md', name: 'Detail.md', content: '# Detail' },
    { path: 'archive/Goals.md', name: 'Goals.md', content: '# Old Goals' }, // name collision with Goals.md
];

describe('vault resolution', () => {
    const index = buildIndex(files);

    it('resolves a wikilink by unique name', () => {
        expect(resolveTarget('Missing Note', true, 'Hub.md', index)).toBeNull();
        expect(resolveTarget('Hub', true, 'Goals.md', index)?.path).toBe('Hub.md');
    });

    it('resolves a path-qualified wikilink', () => {
        expect(resolveTarget('Team/Roster', true, 'Hub.md', index)?.path).toBe('Team/Roster.md');
    });

    it('resolves a markdown link relative to the linking file', () => {
        expect(resolveTarget('notes/Detail.md', false, 'Hub.md', index)?.path).toBe('notes/Detail.md');
    });

    it('disambiguates name collisions by shortest path', () => {
        // "Goals" matches both Goals.md and archive/Goals.md → prefer shorter path
        expect(resolveTarget('Goals', true, 'Hub.md', index)?.path).toBe('Goals.md');
    });

    it('prefers the same directory on collision', () => {
        // from archive/, "Goals" should resolve to archive/Goals.md
        expect(resolveTarget('Goals', true, 'archive/Other.md', index)?.path).toBe('archive/Goals.md');
    });
});

describe('vault graph', () => {
    it('builds nodes for files + ghosts for unresolved links', () => {
        const g = buildGraph(files);
        const real = g.nodes.filter((n) => !n.ghost).map((n) => n.id).sort();
        expect(real).toEqual(['Goals.md', 'Hub.md', 'Team/Roster.md', 'archive/Goals.md', 'notes/Detail.md']);
        const ghost = g.nodes.find((n) => n.ghost);
        expect(ghost?.label).toBe('Missing Note');
    });

    it('creates edges for resolved + ghost links', () => {
        const g = buildGraph(files);
        const has = (s: string, t: string) => g.edges.some((e) => e.source === s && e.target === t);
        expect(has('Hub.md', 'Goals.md')).toBe(true);
        expect(has('Hub.md', 'Team/Roster.md')).toBe(true);
        expect(has('Hub.md', 'notes/Detail.md')).toBe(true);
        expect(has('Hub.md', 'ghost:missing note')).toBe(true);
        expect(has('Goals.md', 'Hub.md')).toBe(true);
    });
});
