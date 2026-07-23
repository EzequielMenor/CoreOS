// ponytail: this exists — stub vacío, prerrequisito de apply para H7 (plan B si react-native-markdown-display rompe con RN 0.86 Fabric).
// Renderiza el cuerpo markdown como texto plano en <Text>. apply debe rellenar el parseo del subset crítico
// (p, strong, em, code inline, code_block, ul/ol/li, h1-h3, blockquote, hr, link) antes de activarlo como fallback.
// Sustituir import en src/components/MarkdownView.tsx:
//   import Markdown from 'react-native-markdown-display';
//   // ↓ (rollback)
//   import { MarkdownViewFallback as Markdown } from './MarkdownView.fallback';
// Ver ADR-002 §"Plan B concreto si la lib rompe" en design.md.
import type { ReactNode } from 'react';
import { Text } from 'react-native';

export interface MarkdownViewFallbackProps {
  body: string;
  onNoteLinkPress?: (noteId: number) => void;
}

export function MarkdownViewFallback({ body }: MarkdownViewFallbackProps): ReactNode {
  return <Text>{body}</Text>;
}
