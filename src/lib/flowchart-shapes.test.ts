import { describe, expect, it } from 'vitest';
import type { FlowNodeType } from '../types/flowchart';
import {
  DEFAULT_FLOW_NODE_TYPE,
  getShapeDimensions,
  normalizeFlowNodeType,
  SHAPE_DIMENSIONS,
} from './flowchart-shapes';

describe('flowchart shape helpers', () => {
  it('falls back to process for unknown persisted node types', () => {
    const legacyType = 'legacy-task' as FlowNodeType;

    expect(DEFAULT_FLOW_NODE_TYPE).toBe('process');
    expect(normalizeFlowNodeType(legacyType)).toBe('process');
    expect(getShapeDimensions(legacyType)).toEqual(SHAPE_DIMENSIONS.process);
  });
});
