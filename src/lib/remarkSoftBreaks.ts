import type { Root } from 'mdast';

type MutableMdastNode = {
    type?: string;
    value?: string;
    children?: MutableMdastNode[];
    [key: string]: unknown;
};

function splitTextNode(node: MutableMdastNode): MutableMdastNode[] {
    if (typeof node.value !== 'string' || !node.value.includes('\n')) return [node];

    const parts = node.value.split('\n');
    const out: MutableMdastNode[] = [];
    parts.forEach((part, index) => {
        if (part) out.push({ ...node, value: part });
        if (index < parts.length - 1) out.push({ type: 'break' });
    });
    return out;
}

function transformSoftBreaks(parent: MutableMdastNode): void {
    if (!Array.isArray(parent.children)) return;

    const nextChildren: MutableMdastNode[] = [];
    for (const child of parent.children) {
        if (child.type === 'text') {
            nextChildren.push(...splitTextNode(child));
            continue;
        }
        transformSoftBreaks(child);
        nextChildren.push(child);
    }
    parent.children = nextChildren;
}

export function remarkSoftBreaks() {
    return (tree: Root) => {
        transformSoftBreaks(tree as MutableMdastNode);
    };
}
