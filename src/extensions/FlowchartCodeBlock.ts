import { CodeBlock } from '@tiptap/extension-code-block';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FlowchartCodeBlockNodeView } from '../components/FlowchartRichBlock';

export const FlowchartCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FlowchartCodeBlockNodeView);
  },
});
