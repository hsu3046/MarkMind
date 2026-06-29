import { CodeBlock } from '@tiptap/extension-code-block';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FlowchartCodeBlockNodeView } from '../components/FlowchartRichBlock';

function isInsideReadOnlyFlowchart(event: Event): boolean {
  return event.target instanceof Element
    && event.target.closest('.rich-flowchart-block') !== null;
}

export const FlowchartCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FlowchartCodeBlockNodeView, {
      stopEvent: ({ event }) => isInsideReadOnlyFlowchart(event),
    });
  },
});
