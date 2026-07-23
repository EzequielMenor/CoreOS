import type { ReactNode } from 'react';
import { Text, type TextStyle } from 'react-native';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';

import { NoteSpacing, Typography } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface MarkdownViewProps {
  body: string;
  onNoteLinkPress?: (noteId: number) => void;
}

const NOTE_LINK_PREFIX = 'note://';

export function MarkdownView({ body, onNoteLinkPress }: MarkdownViewProps) {
  const theme = useTheme();

  const rules: RenderRules = {
    link: (
      node: ASTNode,
      children: ReactNode,
      _parent: ASTNode[],
      _styles: Record<string, TextStyle>,
    ) => {
      const href = node.attributes?.href ?? '';
      const isNoteLink = href.startsWith(NOTE_LINK_PREFIX);

      if (isNoteLink && onNoteLinkPress) {
        const rawId = href.slice(NOTE_LINK_PREFIX.length);
        const noteId = Number.parseInt(rawId, 10);
        if (Number.isFinite(noteId)) {
          return (
            <Text
              accessibilityRole="link"
              key={node.key}
              onPress={() => onNoteLinkPress(noteId)}
              style={styles.link(theme.notes.accent.primary)}
            >
              {children}
            </Text>
          );
        }
      }

      return (
        <Text key={node.key} style={styles.link(theme.notes.accent.primary)}>
          {children}
        </Text>
      );
    },
  };

  const markdownStyles = {
    body: {
      color: theme.notes.text.primary,
      fontSize: Typography.body.size,
      lineHeight: Typography.body.lineHeight,
    },
    heading1: {
      color: theme.notes.text.primary,
      fontSize: Typography.title.size,
      fontWeight: Typography.title.weight,
      lineHeight: Typography.title.lineHeight,
      marginBottom: NoteSpacing.sm,
      marginTop: NoteSpacing.md,
    },
    heading2: {
      color: theme.notes.text.primary,
      fontSize: Typography.subtitle.size,
      fontWeight: Typography.subtitle.weight,
      lineHeight: Typography.subtitle.lineHeight,
      marginBottom: NoteSpacing.xs,
      marginTop: NoteSpacing.md,
    },
    heading3: {
      color: theme.notes.text.primary,
      fontSize: Typography.body.size,
      fontWeight: Typography.title.weight,
      lineHeight: Typography.body.lineHeight,
      marginTop: NoteSpacing.sm,
    },
    paragraph: {
      color: theme.notes.text.primary,
      fontSize: Typography.body.size,
      lineHeight: Typography.body.lineHeight,
      marginBottom: NoteSpacing.sm,
    },
    strong: {
      color: theme.notes.text.primary,
      fontWeight: '700',
    },
    em: {
      color: theme.notes.text.primary,
      fontStyle: 'italic',
    },
    blockquote: {
      backgroundColor: theme.notes.bg.surface,
      borderLeftColor: theme.notes.accent.primary,
      borderLeftWidth: 3,
      color: theme.notes.text.secondary,
      fontStyle: 'italic',
      marginVertical: NoteSpacing.sm,
      paddingHorizontal: NoteSpacing.md,
      paddingVertical: NoteSpacing.xs,
    },
    bullet_list: {
      marginBottom: NoteSpacing.sm,
      marginVertical: NoteSpacing.xs,
    },
    ordered_list: {
      marginBottom: NoteSpacing.sm,
      marginVertical: NoteSpacing.xs,
    },
    list_item: {
      color: theme.notes.text.primary,
      marginVertical: NoteSpacing.xs,
    },
    code_block: {
      backgroundColor: theme.notes.bg.surface,
      borderColor: theme.notes.border.subtle,
      borderRadius: 6,
      borderWidth: 1,
      color: theme.notes.text.primary,
      fontFamily: 'monospace',
      fontSize: Typography.codeBlock.size,
      lineHeight: Typography.codeBlock.lineHeight,
      padding: NoteSpacing.sm,
    },
    code_inline: {
      backgroundColor: theme.notes.bg.surface,
      color: theme.notes.text.accent,
      fontFamily: 'monospace',
      fontSize: Typography.bodyMono.size,
    },
    fence: {
      backgroundColor: theme.notes.bg.surface,
      borderColor: theme.notes.border.subtle,
      borderRadius: 6,
      borderWidth: 1,
      color: theme.notes.text.primary,
      fontFamily: 'monospace',
      fontSize: Typography.codeBlock.size,
      lineHeight: Typography.codeBlock.lineHeight,
      padding: NoteSpacing.sm,
    },
    hr: {
      backgroundColor: theme.notes.border.subtle,
      height: 1,
      marginVertical: NoteSpacing.md,
    },
  } as const;

  return (
    <Markdown rules={rules} style={markdownStyles as never}>
      {body}
    </Markdown>
  );
}

const styles = {
  link: (color: string): TextStyle => ({
    color,
    fontSize: Typography.body.size,
    textDecorationLine: 'underline',
  }),
};