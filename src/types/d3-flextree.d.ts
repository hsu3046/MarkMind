/**
 * Minimal ambient types for d3-flextree (the package ships no .d.ts).
 * flextree extends d3-hierarchy with variable per-node sizes — the
 * Reingold–Tilford tidy tree generalized to non-uniform node bounding boxes.
 * https://github.com/Klortho/d3-flextree
 */
declare module 'd3-flextree' {
    export interface FlextreeNode<Datum> {
        data: Datum;
        /** breadth-axis (sibling) coordinate, centered. */
        x: number;
        /** depth-axis coordinate (cumulative). */
        y: number;
        depth: number;
        parent: FlextreeNode<Datum> | null;
        children?: FlextreeNode<Datum>[];
        each(cb: (node: FlextreeNode<Datum>) => void): this;
    }

    export interface FlextreeLayout<Datum> {
        (root: FlextreeNode<Datum>): FlextreeNode<Datum>;
        hierarchy(data: Datum, children?: (d: Datum) => Datum[] | null | undefined): FlextreeNode<Datum>;
    }

    export function flextree<Datum>(options?: {
        children?: (d: Datum) => Datum[] | null | undefined;
        nodeSize?: (node: FlextreeNode<Datum>) => [number, number];
        spacing?: number | ((a: FlextreeNode<Datum>, b: FlextreeNode<Datum>) => number);
    }): FlextreeLayout<Datum>;
}
